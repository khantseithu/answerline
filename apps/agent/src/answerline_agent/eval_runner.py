import asyncio
import inspect
import json
import sys
import time
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker
from livekit import rtc
from livekit.agents import Agent, AgentSession, RunContext, io, llm, stt, tts
from livekit.agents.metrics import LLMMetrics, ModelUsageCollector
from livekit.agents.utils import http_context
from pydantic import Field

from .after_hours import AfterHours
from .booking import Booking, Slot
from .call_events import model_usage_lines, parse_tool_args
from .capture_lead import LeadCaptureContext
from .config import AgentConfig, BookAppointmentTool, HttpTool, McpTool, TransferCallTool
from .eval_audio import degrade_caller_audio
from .eval_latency import agent_turn_stages
from .eval_pronunciation import check_entities, extract_entities, missing_pronunciations
from .eval_wer import word_error_rate
from .knowledge_tool import QUERY_DESCRIPTION, TOOL_DESCRIPTION, open_knowledge_tools
from .languages import language_instructions, localizes_messages, stt_language
from .native_booking import open_booking_provider
from .prompts import compose_instructions
from .providers import build_llm, build_llm_chain, build_stt, build_tts
from .publisher import CallEventPublisher
from .settings import Settings
from .tool_log import ToolLog
from .tools import build_configured_tools

REPO_ROOT = Path(__file__).resolve().parents[4]
EVAL_PHASE_TIMEOUT = 30


def _build_caller_tts(
    ref: str,
    provider_keys: dict[str, str] | None = None,
    *,
    language: str = "en",
    voice: str | None = None,
) -> tts.TTS:
    return build_tts(ref, provider_keys, language=language, voice=voice)


def _validate_wire_payload(payload: Any, schema_name: str) -> None:
    schema_path = REPO_ROOT / "packages" / "shared" / "schema" / schema_name
    schema = json.loads(schema_path.read_text())
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)


class _MockPublisher:
    async def publish_confirmed(self, event: object) -> None:
        return None


class _MockBooking:
    async def availability(self, start, end) -> list[Slot]:
        return []

    async def create(self, start, attendee) -> Booking:
        return Booking(id="eval-booking", start=start, end=start)

    async def cancel(self, booking_id: str) -> None:
        return None


class _MockTransfer:
    can_transfer = False
    timeout = 0

    async def transfer(self) -> None:
        return None


def _mock_tool(
    tool: llm.FunctionTool,
    name: str,
    result: Any,
    calls: list[dict[str, Any]],
) -> llm.FunctionTool:
    original = tool._func
    signature = inspect.signature(original)

    async def invoke(*args: Any, **kwargs: Any) -> Any:
        values = {key: value for key, value in kwargs.items() if key != "context"}
        context = kwargs.get("context") or (args[0] if args else None)
        function_call = getattr(context, "function_call", None)
        if not values and function_call is not None:
            values = parse_tool_args(function_call.arguments)
        calls.append({"name": name, "args": values})
        return result

    invoke.__name__ = name
    invoke.__annotations__ = getattr(original, "__annotations__", {})
    invoke.__signature__ = signature
    return llm.function_tool(invoke, name=name, description=tool.info.description)


def _build_mock_knowledge_tool() -> llm.FunctionTool:
    async def search_knowledge(
        context: RunContext,
        query: Annotated[str, Field(description=QUERY_DESCRIPTION)],
    ) -> str:
        return "No matching information was found in the knowledge base."

    return llm.function_tool(search_knowledge, description=TOOL_DESCRIPTION)


def build_mock_tools(
    config: AgentConfig,
    *,
    calls: list[dict[str, Any]],
    mocks: dict[str, Any] | None = None,
    settings: Settings | None = None,
    ensure_voicemail: bool = False,
) -> list[llm.FunctionTool]:
    if any(isinstance(spec, (HttpTool, McpTool)) for spec in config.tools):
        raise ValueError("HTTP and MCP tools are not supported by the current runtime")
    lead_context = LeadCaptureContext(
        publisher=_MockPublisher(), tenant="eval", agent="eval", room_name="eval"
    )
    booking_specs = [spec for spec in config.tools if isinstance(spec, BookAppointmentTool)]
    transfer_specs = [spec for spec in config.tools if isinstance(spec, TransferCallTool)]
    tools = build_configured_tools(
        config,
        settings,
        lead_context=lead_context,
        booking=_MockBooking() if booking_specs else None,
        transfer=_MockTransfer() if transfer_specs else None,
        ensure_voicemail=ensure_voicemail,
    )
    results = mocks or {}
    return [
        _mock_tool(
            tool,
            tool.info.name,
            results.get(tool.info.name, {"status": "mocked"}),
            calls,
        )
        for tool in tools
    ] + (
        [
            _mock_tool(
                _build_mock_knowledge_tool(),
                "search_knowledge",
                results.get("search_knowledge", "No matching information was found."),
                calls,
            )
        ]
        if config.knowledge and config.knowledge.sources
        else []
    )


async def _build_live_tools(
    config: AgentConfig,
    settings: Settings,
    *,
    agent_slug: str,
    tenant_slug: str,
    provider_keys: dict[str, str] | None = None,
) -> tuple[list[llm.FunctionTool], list[Any]]:
    unsupported = [spec for spec in config.tools if isinstance(spec, (HttpTool, McpTool))]
    if unsupported:
        raise ValueError("HTTP and MCP tools are not supported by the current runtime")
    room_name = f"eval-{agent_slug}-{uuid4().hex}"
    closers = []
    try:
        after_hours = AfterHours(
            config.hours, config.name, settings, localize=localizes_messages(config)
        )
        needs_publisher = (
            any(
                getattr(spec, "builtin", None) in {"capture_lead", "voicemail"}
                for spec in config.tools
            )
            or after_hours.takes_voicemail
        )
        publisher = (
            CallEventPublisher(settings.redis_url, settings.redis_prefix)
            if needs_publisher
            else None
        )
        if publisher:
            closers.append(publisher.close)
        booking = await open_booking_provider(
            config, settings, agent_slug, room_name, tenant_slug=tenant_slug
        )
        if booking:
            closers.append(booking.close)
        if any(isinstance(spec, BookAppointmentTool) for spec in config.tools) and booking is None:
            raise ValueError(
                "live booking tool is unavailable; check database and agent configuration"
            )
        lead_context = (
            LeadCaptureContext(
                publisher=publisher,
                tenant=tenant_slug,
                agent=agent_slug,
                room_name=room_name,
            )
            if publisher
            else None
        )
        transfer_specs = [spec for spec in config.tools if isinstance(spec, TransferCallTool)]
        tools = build_configured_tools(
            config,
            settings,
            lead_context=lead_context,
            booking=booking,
            transfer=_MockTransfer() if transfer_specs else None,
            ensure_voicemail=after_hours.takes_voicemail,
        )
        knowledge_args = {"provider_keys": provider_keys} if provider_keys is not None else {}
        knowledge = await open_knowledge_tools(
            settings, agent_slug, ToolLog(), tenant_slug=tenant_slug, **knowledge_args
        )
        if knowledge:
            closers.append(knowledge.close)
            tools.extend(knowledge.tools)
        return tools, closers
    except Exception:
        for close in reversed(closers):
            await close()
        raise


def _evaluate_assertions(
    case: dict[str, Any],
    transcript: list[dict[str, str]],
    calls: list[dict],
    wer: float | None = None,
    reference_transcripts: list[str] | None = None,
) -> list[str]:
    expect = case.get("expect", {})
    agent_text = "\n".join(turn["text"] for turn in transcript if turn["role"] == "agent")
    failures = []
    for phrase in expect.get("mentions", []):
        if phrase.casefold() not in agent_text.casefold():
            failures.append(f"response does not mention {phrase!r}")
    for phrase in expect.get("not_mentions", []):
        if phrase.casefold() in agent_text.casefold():
            failures.append(f"response mentions forbidden phrase {phrase!r}")
    expected_tool = expect.get("tool_called")
    if expected_tool and not any(call["name"] == expected_tool for call in calls):
        failures.append(f"tool {expected_tool!r} was not called")
    expected_args = expect.get("tool_args", {})
    for tool_name, fields in expected_args.items():
        matching = [call for call in calls if call["name"] == tool_name]
        if not matching:
            failures.append(f"tool {tool_name!r} was not called for tool_args assertion")
            continue
        if not any(
            all(call["args"].get(key) == value for key, value in fields.items())
            for call in matching
        ):
            failures.append(f"tool {tool_name!r} was not called with expected arguments {fields!r}")
    max_wer = expect.get("max_wer")
    if max_wer is not None and wer is not None and wer > max_wer:
        failures.append(f"word error rate {wer:.4f} is over max_wer {max_wer}")
    if reference_transcripts is not None:
        for phrase in missing_pronunciations(expect.get("pronounces", []), reference_transcripts):
            failures.append(f"agent audio does not pronounce {phrase!r}")
    return failures


def _speech_failure_summary(stage: str, error: BaseException) -> str:
    status_code = getattr(error, "status_code", None)
    status = f" (status {status_code})" if isinstance(status_code, int) else ""
    return f"{stage} failed: {type(error).__name__}{status}"[:120]


async def _judge(
    provider: llm.LLM,
    rubric: str,
    transcript: list[dict[str, str]],
    calls: list[dict[str, Any]],
) -> tuple[bool, str, list[dict[str, Any]]]:
    prompt = json.dumps(
        {"rubric": rubric, "transcript": transcript, "tool_calls": calls}, ensure_ascii=False
    )
    chat = llm.ChatContext(
        items=[
            llm.ChatMessage(
                role="user",
                content=[
                    "Evaluate the conversation against the rubric. Return only JSON with a boolean "
                    "`passed` and string `reason`. If evidence is insufficient, set passed false.\n"
                    + prompt
                ],
            )
        ]
    )
    collector = ModelUsageCollector()
    provider.on("metrics_collected", collector)
    chunks = []
    stream = None
    try:
        stream = provider.chat(chat_ctx=chat)
        async for chunk in stream:
            if chunk.delta and chunk.delta.content:
                chunks.append(chunk.delta.content)
    finally:
        try:
            if stream:
                await stream.aclose()
        finally:
            provider.off("metrics_collected", collector)
    usage_lines = model_usage_lines(collector.flatten()) or []
    try:
        result = json.loads("".join(chunks))
    except json.JSONDecodeError:
        return False, "judge returned invalid JSON", usage_lines
    if not isinstance(result, dict) or not isinstance(result.get("passed"), bool):
        return False, "judge response must contain a boolean passed field", usage_lines
    reason = result.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        return False, "judge response must contain a non-empty reason", usage_lines
    return result["passed"], reason, usage_lines


class _CapturedAudioOutput(io.AudioOutput):
    def __init__(self) -> None:
        super().__init__(
            label="eval playback", capabilities=io.AudioOutputCapabilities(pause=False)
        )
        self.frame_count = 0
        self.frames: list[rtc.AudioFrame] = []

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        self.frame_count += 1
        self.frames.append(frame)
        await super().capture_frame(frame)

    def take_frames(self) -> list[rtc.AudioFrame]:
        frames, self.frames = self.frames, []
        return frames

    def flush(self) -> None:
        super().flush()
        self.on_playback_finished(playback_position=0, interrupted=False)

    def clear_buffer(self) -> None:
        super().clear_buffer()
        self.on_playback_finished(playback_position=0, interrupted=True)


async def _synthesize_caller_audio(
    provider: tts.TTS, text: str
) -> tuple[list[rtc.AudioFrame], list[dict[str, Any]]]:
    collector = ModelUsageCollector()
    provider.on("metrics_collected", collector)
    stream = provider.synthesize(text)
    frames = []
    try:
        async for chunk in stream:
            frames.append(chunk.frame)
    finally:
        try:
            await stream.aclose()
        finally:
            provider.off("metrics_collected", collector)
    if not frames:
        raise ValueError("caller TTS returned no audio frames")
    last_frame = frames[-1]
    frames.append(
        rtc.AudioFrame.create(
            last_frame.sample_rate, last_frame.num_channels, last_frame.sample_rate // 2
        )
    )
    return frames, model_usage_lines(collector.flatten()) or []


async def _recognize_caller_audio(
    provider: stt.STT, frames: list[rtc.AudioFrame]
) -> tuple[str, list[dict[str, Any]]]:
    collector = ModelUsageCollector()
    provider.on("metrics_collected", collector)
    try:
        result = await provider.recognize(frames)
    finally:
        provider.off("metrics_collected", collector)
    transcript = " ".join(alternative.text for alternative in result.alternatives).strip()
    return transcript, model_usage_lines(collector.flatten()) or []


def _needs_reference_stt(
    case: dict[str, Any], agent_audio: list[tuple[str, list[rtc.AudioFrame]]], agent_name: str
) -> bool:
    return bool(case.get("expect", {}).get("pronounces")) or any(
        extract_entities(text, agent_name) for text, _frames in agent_audio
    )


async def _transcribe_agent_audio(
    provider: stt.STT, agent_audio: list[tuple[str, list[rtc.AudioFrame]]]
) -> tuple[list[str], list[dict[str, Any]]]:
    transcripts: list[str] = []
    usage: list[dict[str, Any]] = []
    for _text, frames in agent_audio:
        if not frames:
            transcripts.append("")
            continue
        heard, lines = await asyncio.wait_for(
            _recognize_caller_audio(provider, frames), EVAL_PHASE_TIMEOUT
        )
        transcripts.append(heard)
        usage.extend(lines)
    return transcripts, usage


def _score_pronunciation(
    agent_audio: list[tuple[str, list[rtc.AudioFrame]]], heard: list[str], agent_name: str
) -> dict[str, Any] | None:
    checked = 0
    missed: list[str] = []
    for (text, _frames), transcript in zip(agent_audio, heard, strict=True):
        turn_checked, turn_missed = check_entities(text, transcript, agent_name)
        checked += turn_checked
        missed.extend(turn_missed)
    if not checked:
        return None
    return {"checked": checked, "matched": checked - len(missed), "missed": missed}


async def run_case(
    config: AgentConfig,
    case: dict[str, Any],
    *,
    model_override: str | None = None,
    judge_model: str | None = None,
    stt_override: str | None = None,
    tts_override: str | None = None,
    caller_audio: dict[str, Any] | None = None,
    reference_stt: str | None = None,
    settings: Settings | None = None,
    llm_provider: llm.LLM | None = None,
    judge_provider: llm.LLM | None = None,
    mode: str = "text",
    live_tools: bool = False,
    context: dict[str, str] | None = None,
    provider_keys: dict[str, str] | None = None,
) -> dict[str, Any]:
    if mode not in {"text", "audio"}:
        raise ValueError(f"unsupported eval mode {mode!r}")
    turns = case["caller"] if isinstance(case["caller"], list) else [case["caller"]]
    if not turns or any(not isinstance(turn, str) or not turn.strip() for turn in turns):
        raise ValueError(f"eval case {case.get('name', '<unnamed>')!r} must have caller text turns")
    caller_audio = caller_audio or {}
    models = config.models.model_copy(deep=True)
    if model_override:
        models.llm.primary = model_override
        models.llm.fallback = []
    if stt_override:
        models.stt = stt_override
    if tts_override:
        models.tts = tts_override
    runtime_settings = settings or Settings()
    max_output_tokens = runtime_settings.eval_max_completion_tokens
    provider = llm_provider or build_llm_chain(
        models, provider_keys, max_output_tokens=max_output_tokens
    )
    after_hours = AfterHours(
        config.hours, config.name, runtime_settings, localize=localizes_messages(config)
    )
    calls: list[dict[str, Any]] = []
    if live_tools:
        if context is None:
            raise ValueError("liveTools requires agentSlug and tenantSlug context")
        runtime_settings = runtime_settings.model_copy(update={"tenant": context["tenantSlug"]})
        live_tool_args = {"provider_keys": provider_keys} if provider_keys is not None else {}
        tools, closers = await _build_live_tools(
            config,
            runtime_settings,
            agent_slug=context["agentSlug"],
            tenant_slug=context["tenantSlug"],
            **live_tool_args,
        )
    else:
        tools = build_mock_tools(
            config,
            calls=calls,
            mocks=case.get("mocks"),
            settings=runtime_settings,
            ensure_voicemail=after_hours.takes_voicemail,
        )
        closers = []
    transcript: list[dict[str, str]] = []
    usage: list[dict[str, Any]] = []
    audio_output = None
    stt_provider = None
    reference_stt_provider = None
    tts_provider = None
    caller_tts_provider = None
    session = None
    responses: list[str] = []
    response_metrics: list[dict] = []
    llm_durations: list[float] = []
    stage_latency: dict[str, list[int]] = {}
    speech_failures: list[str] = []
    turn_wers: list[float] = []
    agent_audio: list[tuple[str, list[rtc.AudioFrame]]] = []

    def on_item(event) -> None:
        if event.item.type == "message" and event.item.role == "assistant":
            if event.item.text_content:
                responses.append(event.item.text_content)
                response_metrics.append(dict(event.item.metrics))

    def on_llm_metrics(metrics) -> None:
        if isinstance(metrics, LLMMetrics):
            llm_durations.append(metrics.duration)

    def record_stages(stages: dict[str, int]) -> None:
        for stage, value in stages.items():
            stage_latency.setdefault(stage, []).append(value)

    if live_tools:

        def on_tools(event) -> None:
            for call, _output in event.zipped():
                calls.append({"name": call.name, "args": parse_tool_args(call.arguments)})

    agent = Agent(
        instructions=compose_instructions(
            config.instructions,
            language_instructions(config, config.language),
            after_hours.instructions(),
        ),
        tools=tools,
    )
    started = time.monotonic()
    try:
        if mode == "audio":
            audio_output = _CapturedAudioOutput()
            stt_provider = (
                build_stt(models.stt, provider_keys, language=stt_language(config, config.language))
                if provider_keys is not None
                else build_stt(models.stt, language=stt_language(config, config.language))
            )
            tts_provider = (
                build_tts(models.tts, provider_keys, language=config.language)
                if provider_keys is not None
                else build_tts(models.tts, language=config.language)
            )
            caller_tts_ref = caller_audio.get("tts") or models.tts
            caller_tts_args = (provider_keys,) if provider_keys is not None else ()
            caller_tts_provider = _build_caller_tts(
                caller_tts_ref,
                *caller_tts_args,
                language=config.language,
                voice=caller_audio.get("voice"),
            )
            session = AgentSession(
                llm=provider,
                tts=tts_provider,
            )
            session.output.audio = audio_output
        else:
            session = AgentSession(llm=provider)
        session.on("conversation_item_added", on_item)
        provider.on("metrics_collected", on_llm_metrics)
        if live_tools:
            session.on("function_tools_executed", on_tools)
        await session.start(agent=agent)
        greeting_text = config.greeting
        if after_hours.mode and after_hours.mode != "answer":
            greeting_text = runtime_settings.after_hours_voicemail_message.replace(
                "{name}", config.name
            )
        greeting = await session.say(greeting_text, allow_interruptions=False)
        if mode == "audio":
            await asyncio.wait_for(greeting.wait_for_playout(), EVAL_PHASE_TIMEOUT)
        else:
            await greeting.wait_for_playout()
        if error := greeting.exception():
            speech_failures.append(_speech_failure_summary("agent greeting", error))
        transcript.append({"role": "agent", "text": greeting_text})
        if audio_output:
            agent_audio.append((greeting_text, audio_output.take_frames()))
        for turn in turns:
            start = len(responses)
            llm_start = len(llm_durations)
            turn_stages: dict[str, int] = {}
            if mode == "audio":
                caller_frames, caller_usage = await asyncio.wait_for(
                    _synthesize_caller_audio(caller_tts_provider, turn),
                    EVAL_PHASE_TIMEOUT,
                )
                usage.extend(caller_usage)
                caller_frames = degrade_caller_audio(
                    caller_frames,
                    profile=caller_audio.get("profile", "clean"),
                    noise_snr_db=caller_audio.get("noiseSnrDb"),
                    seed=caller_audio.get("seed", 0),
                    padding_frames=1,
                )
                stt_started = time.monotonic()
                recognized, stt_usage = await asyncio.wait_for(
                    _recognize_caller_audio(stt_provider, caller_frames),
                    EVAL_PHASE_TIMEOUT,
                )
                turn_stages["sttMs"] = max(round((time.monotonic() - stt_started) * 1000), 0)
                usage.extend(stt_usage)
                if not recognized:
                    raise ValueError("caller STT returned an empty transcript")
                turn_wers.append(word_error_rate(turn, recognized))
                transcript.append({"role": "caller", "text": recognized})
                handle = session.generate_reply(user_input=recognized, input_modality="audio")
                await asyncio.wait_for(handle.wait_for_playout(), EVAL_PHASE_TIMEOUT)
            else:
                transcript.append({"role": "caller", "text": turn})
                handle = await session.generate_reply(user_input=turn, input_modality="text")
                await handle.wait_for_playout()
            if error := handle.exception():
                speech_failures.append(_speech_failure_summary("agent response", error))
            turn_stages.update(
                agent_turn_stages(response_metrics[start:], llm_durations[llm_start:])
            )
            record_stages(turn_stages)
            response = "\n".join(responses[start:]).strip()
            if response:
                transcript.append({"role": "agent", "text": response})
            if audio_output:
                agent_audio.append((response, audio_output.take_frames()))
        provider.off("metrics_collected", on_llm_metrics)
        wer = round(sum(turn_wers) / len(turn_wers), 4) if turn_wers else None
        reference_transcripts = None
        pronunciation = None
        reference_ms = 0
        if mode == "audio" and _needs_reference_stt(case, agent_audio, config.name):
            reference_ref = (
                reference_stt or runtime_settings.eval_reference_stt or config.models.stt
            )
            reference_language = stt_language(config, config.language)
            reference_stt_provider = (
                build_stt(reference_ref, provider_keys, language=reference_language)
                if provider_keys is not None
                else build_stt(reference_ref, language=reference_language)
            )
            reference_started = time.monotonic()
            reference_transcripts, reference_usage = await _transcribe_agent_audio(
                reference_stt_provider, agent_audio
            )
            reference_ms = round((time.monotonic() - reference_started) * 1000)
            usage.extend(reference_usage)
            pronunciation = _score_pronunciation(agent_audio, reference_transcripts, config.name)
        failures = speech_failures + _evaluate_assertions(
            case, transcript, calls, wer, reference_transcripts
        )
        usage.extend(model_usage_lines(session.usage.model_usage) or [])
        if case.get("expect", {}).get("judge"):
            judge_ref = judge_model or runtime_settings.eval_judge_model
            judge = judge_provider or (
                build_llm(judge_ref, provider_keys, max_output_tokens=max_output_tokens)
                if judge_ref
                else provider
            )
            passed, reason, judge_usage = await _judge(
                judge,
                case["expect"]["judge"],
                transcript,
                calls,
            )
            usage.extend(judge_usage)
            if not passed:
                failures.append(f"judge failed: {reason}")
        latency = max(int((time.monotonic() - started) * 1000) - reference_ms, 0)
        return {
            "caseName": case["name"],
            "passed": not failures,
            "failures": failures,
            "transcript": transcript,
            "latencyMs": latency,
            "costUsd": None,
            "modelUsage": usage,
            "wer": wer,
            "pronunciation": pronunciation,
            "stageLatency": stage_latency,
        }
    finally:
        provider.off("metrics_collected", on_llm_metrics)
        try:
            if session:
                await session.aclose()
        finally:
            try:
                for audio_provider in (
                    caller_tts_provider,
                    tts_provider,
                    stt_provider,
                    reference_stt_provider,
                ):
                    if audio_provider:
                        await audio_provider.aclose()
            finally:
                for close in reversed(closers):
                    await close()


async def run_suite(
    payload: dict[str, Any], provider_keys: dict[str, str] | None = None
) -> dict[str, Any]:
    async with http_context.open():
        _validate_wire_payload(payload, "eval-execution-input.schema.json")
        if payload.get("liveTools") and payload.get("context") is None:
            raise ValueError("liveTools requires agentSlug and tenantSlug context")
        names = [case["name"] for case in payload["suite"]]
        if len(set(names)) != len(names):
            raise ValueError("eval case names must be unique")
        config = AgentConfig.model_validate(payload["agent"])
        results = [
            await run_case(
                config,
                case,
                model_override=payload.get("modelOverride"),
                judge_model=payload.get("judgeModel"),
                stt_override=payload.get("sttOverride"),
                tts_override=payload.get("ttsOverride"),
                caller_audio=payload.get("callerAudio"),
                reference_stt=payload.get("referenceStt"),
                settings=Settings(),
                mode=payload.get("mode", "text"),
                live_tools=payload.get("liveTools", False),
                context=payload.get("context"),
                provider_keys=provider_keys,
            )
            for case in payload["suite"]
        ]
        total = len(results)
        latencies = [result["latencyMs"] for result in results if result["latencyMs"] is not None]
        costs = [result["costUsd"] for result in results if result["costUsd"] is not None]
        wers = [result["wer"] for result in results if result["wer"] is not None]
        pronunciations = [
            result["pronunciation"] for result in results if result["pronunciation"] is not None
        ]
        checked = sum(item["checked"] for item in pronunciations)
        passed = sum(result["passed"] for result in results)
        output = {
            "results": results,
            "aggregate": {
                "passed": passed,
                "total": total,
                "avgLatencyMs": round(sum(latencies) / len(latencies)) if latencies else None,
                "avgWer": round(sum(wers) / len(wers), 4) if wers else None,
                "pronunciationScore": (
                    round(sum(item["matched"] for item in pronunciations) / checked, 4)
                    if checked
                    else None
                ),
                "costUsd": sum(costs) if len(costs) == total else None,
            },
        }
        _validate_wire_payload(output, "eval-execution-output.schema.json")
        return output


async def main() -> None:
    try:
        payload = json.load(sys.stdin)
        if "input" in payload:
            output = await run_suite(payload["input"], payload.get("providerKeys", {}))
        else:
            output = await run_suite(payload)
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
