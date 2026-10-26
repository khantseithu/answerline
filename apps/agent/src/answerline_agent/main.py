from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli
from livekit.local_inference import init_eot
from livekit.plugins import silero

from .after_hours import AfterHours
from .call_limits import SHUTDOWN_PROCESS_TIMEOUT, CallLifecycle, drain_timeout
from .call_session import CallSessionEvents, wait_for_caller
from .capture_lead import LeadCaptureContext
from .config import TransferCallTool
from .knowledge_tool import open_knowledge_tools
from .languages import call_language, greeting_for, language_instructions
from .native_booking import open_booking_provider
from .prompts import compose_instructions
from .providers import build_llm_chain, build_stt, build_tts
from .publisher import CallEventPublisher
from .recording import build_call_recording, start_with_notice
from .resolve import resolve_agent
from .settings import Settings
from .telemetry import TracedAgent, configure_tracing, flush_tracing
from .tool_log import ToolLog
from .tools import build_configured_tools
from .transfer import CallTransfer
from .turns import build_turn_handling

settings = Settings()
server = AgentServer(
    drain_timeout=drain_timeout(settings),
    shutdown_process_timeout=SHUTDOWN_PROCESS_TIMEOUT,
)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()
    if settings.turn_detection == "local":
        init_eot()


server.setup_fnc = prewarm


@server.rtc_session(agent_name=settings.agent_name)
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    resolved = await resolve_agent(ctx.job.metadata, settings)
    config = resolved.config
    provider_keys = getattr(resolved, "provider_keys", None)
    language = call_language(config, getattr(resolved, "language", None))
    trace_provider = configure_tracing(settings, ctx.room.name, resolved.slug, resolved.tenant)
    if trace_provider is not None:

        async def flush_trace() -> None:
            await flush_tracing(trace_provider)

        ctx.add_shutdown_callback(flush_trace)
    agent_type = TracedAgent if trace_provider is not None else Agent
    publisher = CallEventPublisher(settings.redis_url, settings.redis_prefix)
    booking = await open_booking_provider(
        config, settings, resolved.slug, ctx.room.name, tenant_slug=resolved.tenant
    )
    if booking:
        ctx.add_shutdown_callback(lambda _reason: booking.close())
    transfer_spec = next(
        (spec for spec in config.tools if isinstance(spec, TransferCallTool)), None
    )
    transfer = CallTransfer(ctx, transfer_spec.to) if transfer_spec else None
    after_hours = AfterHours(config.hours, config.name, settings)
    tools = build_configured_tools(
        config,
        settings,
        lead_context=LeadCaptureContext(
            publisher=publisher,
            tenant=resolved.tenant,
            agent=resolved.slug,
            room_name=ctx.room.name,
        ),
        booking=booking,
        transfer=transfer,
        ensure_voicemail=after_hours.takes_voicemail,
    )
    session = AgentSession(
        stt=(
            build_stt(config.models.stt, provider_keys, language=language)
            if provider_keys is not None
            else build_stt(config.models.stt, language=language)
        ),
        llm=(
            build_llm_chain(config.models, provider_keys)
            if provider_keys is not None
            else build_llm_chain(config.models)
        ),
        tts=(
            build_tts(config.models.tts, provider_keys, language=language)
            if provider_keys is not None
            else build_tts(config.models.tts, language=language)
        ),
        vad=ctx.proc.userdata["vad"],
        turn_handling=build_turn_handling(settings, language),
        user_away_timeout=settings.idle_timeout_seconds or None,
    )
    tool_log = ToolLog()
    knowledge_args = {"provider_keys": provider_keys} if provider_keys is not None else {}
    knowledge = await open_knowledge_tools(
        settings, resolved.slug, tool_log, tenant_slug=resolved.tenant, **knowledge_args
    )
    if knowledge:
        ctx.add_shutdown_callback(lambda _reason: knowledge.close())
    recording = build_call_recording(ctx, config, resolved.tenant)
    events = CallSessionEvents(
        session=session,
        publisher=publisher,
        room_name=ctx.room.name,
        tenant=resolved.tenant,
        agent=resolved.slug,
        recording_url=(lambda: recording.url) if recording else None,
        recording_started_at=(lambda: recording.started_at) if recording else None,
        tool_log=tool_log,
    )
    await session.start(
        room=ctx.room,
        agent=agent_type(
            instructions=compose_instructions(
                config.instructions,
                language_instructions(config, language),
                after_hours.instructions(),
            ),
            tools=[*(knowledge.tools if knowledge else []), *tools],
        ),
    )
    lifecycle = CallLifecycle(session=session, events=events, job=ctx, settings=settings)
    caller = await wait_for_caller(ctx)
    if transfer:
        transfer.set_caller(caller)
    events.started(caller)
    ctx.add_shutdown_callback(events.on_shutdown)
    lifecycle.watch_caller(ctx.room, caller)
    lifecycle.start()
    if recording:
        ctx.add_shutdown_callback(lambda _reason: recording.stop())
        await start_with_notice(recording, session, config.recording.notice)
    await after_hours.greet(session, greeting_for(config, language), transfer)


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
