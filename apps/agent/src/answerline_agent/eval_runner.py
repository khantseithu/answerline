import asyncio
import inspect
import json
import sys
import time
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker
from livekit.agents import Agent, AgentSession, RunContext, llm
from pydantic import Field

from .after_hours import AfterHours
from .booking import Booking, Slot
from .call_events import model_usage_lines, parse_tool_args
from .capture_lead import LeadCaptureContext
from .config import AgentConfig, BookAppointmentTool, HttpTool, McpTool, TransferCallTool
from .knowledge_tool import QUERY_DESCRIPTION, TOOL_DESCRIPTION, open_knowledge_tools
from .native_booking import open_booking_provider
from .prompts import compose_instructions
from .providers import build_llm_chain
from .publisher import CallEventPublisher
from .settings import Settings
from .tool_log import ToolLog
from .tools import build_configured_tools

REPO_ROOT = Path(__file__).resolve().parents[4]


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
) -> tuple[list[llm.FunctionTool], list[Any]]:
    unsupported = [spec for spec in config.tools if isinstance(spec, (HttpTool, McpTool))]
    if unsupported:
        raise ValueError("HTTP and MCP tools are not supported by the current runtime")
    room_name = f"eval-{agent_slug}-{uuid4().hex}"
    closers = []
    try:
        after_hours = AfterHours(config.hours, config.name, settings)
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
        booking = await open_booking_provider(config, settings, agent_slug, room_name)
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
        knowledge = await open_knowledge_tools(settings, agent_slug, ToolLog())
        if knowledge:
            closers.append(knowledge.close)
            tools.extend(knowledge.tools)
        return tools, closers
    except Exception:
        for close in reversed(closers):
            await close()
        raise


def _evaluate_assertions(
    case: dict[str, Any], transcript: list[dict[str, str]], calls: list[dict]
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
    return failures


async def _judge(
    provider: llm.LLM,
    model_ref: str,
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
    stream = provider.chat(chat_ctx=chat)
    chunks = []
    usage_lines = []
    async for chunk in stream:
        if chunk.delta and chunk.delta.content:
            chunks.append(chunk.delta.content)
        if chunk.usage:
            provider_name, _, model_name = model_ref.partition("/")
            if chunk.usage.prompt_tokens:
                usage_lines.append(
                    {
                        "stage": "llm",
                        "provider": provider_name,
                        "model": model_name,
                        "quantity": chunk.usage.prompt_tokens,
                        "unit": "input_tokens",
                    }
                )
            if chunk.usage.completion_tokens:
                usage_lines.append(
                    {
                        "stage": "llm",
                        "provider": provider_name,
                        "model": model_name,
                        "quantity": chunk.usage.completion_tokens,
                        "unit": "output_tokens",
                    }
                )
    await stream.aclose()
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


async def run_case(
    config: AgentConfig,
    case: dict[str, Any],
    *,
    model_override: str | None = None,
    settings: Settings | None = None,
    llm_provider: llm.LLM | None = None,
    mode: str = "text",
    live_tools: bool = False,
    context: dict[str, str] | None = None,
) -> dict[str, Any]:
    if mode != "text":
        raise ValueError("audio eval mode is not available yet")
    turns = case["caller"] if isinstance(case["caller"], list) else [case["caller"]]
    if not turns or any(not isinstance(turn, str) or not turn.strip() for turn in turns):
        raise ValueError(f"eval case {case.get('name', '<unnamed>')!r} must have caller text turns")
    models = config.models.model_copy(deep=True)
    if model_override:
        models.llm.primary = model_override
        models.llm.fallback = []
    provider = llm_provider or build_llm_chain(models)
    runtime_settings = settings or Settings()
    after_hours = AfterHours(config.hours, config.name, runtime_settings)
    calls: list[dict[str, Any]] = []
    if live_tools:
        if context is None:
            raise ValueError("liveTools requires agentSlug and tenantSlug context")
        runtime_settings = runtime_settings.model_copy(update={"tenant": context["tenantSlug"]})
        tools, closers = await _build_live_tools(
            config,
            runtime_settings,
            agent_slug=context["agentSlug"],
            tenant_slug=context["tenantSlug"],
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
    session = AgentSession(llm=provider)
    responses: list[str] = []

    def on_item(event) -> None:
        if event.item.type == "message" and event.item.role == "assistant":
            if event.item.text_content:
                responses.append(event.item.text_content)

    session.on("conversation_item_added", on_item)
    if live_tools:

        def on_tools(event) -> None:
            for call, _output in event.zipped():
                calls.append({"name": call.name, "args": parse_tool_args(call.arguments)})

        session.on("function_tools_executed", on_tools)
    agent = Agent(
        instructions=compose_instructions(config.instructions, after_hours.instructions()),
        tools=tools,
    )
    started = time.monotonic()
    try:
        await session.start(agent=agent)
        greeting_text = config.greeting
        if after_hours.mode and after_hours.mode != "answer":
            greeting_text = runtime_settings.after_hours_voicemail_message.replace(
                "{name}", config.name
            )
        greeting = await session.say(greeting_text, allow_interruptions=False)
        await greeting.wait_for_playout()
        transcript.append({"role": "agent", "text": greeting_text})
        for turn in turns:
            transcript.append({"role": "caller", "text": turn})
            start = len(responses)
            handle = await session.generate_reply(user_input=turn, input_modality="text")
            await handle.wait_for_playout()
            response = "\n".join(responses[start:]).strip()
            if response:
                transcript.append({"role": "agent", "text": response})
        failures = _evaluate_assertions(case, transcript, calls)
        usage = model_usage_lines(session.usage.model_usage) or []
        if case.get("expect", {}).get("judge"):
            passed, reason, judge_usage = await _judge(
                provider,
                models.llm.primary,
                case["expect"]["judge"],
                transcript,
                calls,
            )
            usage.extend(judge_usage)
            if not passed:
                failures.append(f"judge failed: {reason}")
        latency = max(int((time.monotonic() - started) * 1000), 0)
        return {
            "caseName": case["name"],
            "passed": not failures,
            "failures": failures,
            "transcript": transcript,
            "latencyMs": latency,
            "costUsd": None,
            "modelUsage": usage,
        }
    finally:
        try:
            await session.aclose()
        finally:
            for close in reversed(closers):
                await close()


async def run_suite(payload: dict[str, Any]) -> dict[str, Any]:
    _validate_wire_payload(payload, "eval-execution-input.schema.json")
    if payload.get("liveTools") and payload.get("context") is None:
        raise ValueError("liveTools requires agentSlug and tenantSlug context")
    if payload.get("mode", "text") != "text":
        raise ValueError("audio eval mode is not available yet")
    names = [case["name"] for case in payload["suite"]]
    if len(set(names)) != len(names):
        raise ValueError("eval case names must be unique")
    config = AgentConfig.model_validate(payload["agent"])
    results = [
        await run_case(
            config,
            case,
            model_override=payload.get("modelOverride"),
            settings=Settings(),
            mode=payload.get("mode", "text"),
            live_tools=payload.get("liveTools", False),
            context=payload.get("context"),
        )
        for case in payload["suite"]
    ]
    total = len(results)
    latencies = [result["latencyMs"] for result in results if result["latencyMs"] is not None]
    costs = [result["costUsd"] for result in results if result["costUsd"] is not None]
    passed = sum(result["passed"] for result in results)
    output = {
        "results": results,
        "aggregate": {
            "passed": passed,
            "total": total,
            "avgLatencyMs": round(sum(latencies) / len(latencies)) if latencies else None,
            "costUsd": sum(costs) if len(costs) == total else None,
        },
    }
    _validate_wire_payload(output, "eval-execution-output.schema.json")
    return output


async def main() -> None:
    try:
        payload = json.load(sys.stdin)
        output = await run_suite(payload)
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
