from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli
from livekit.local_inference import init_eot
from livekit.plugins import silero

from .call_limits import SHUTDOWN_PROCESS_TIMEOUT, CallLifecycle, drain_timeout
from .call_session import CallSessionEvents, wait_for_caller
from .knowledge_tool import open_knowledge_tools
from .prompts import compose_instructions
from .providers import build_llm_chain, build_stt, build_tts
from .publisher import CallEventPublisher
from .recording import build_call_recording, start_with_notice
from .resolve import resolve_agent
from .settings import Settings
from .tool_log import ToolLog
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
    session = AgentSession(
        stt=build_stt(config.models.stt),
        llm=build_llm_chain(config.models),
        tts=build_tts(config.models.tts),
        vad=ctx.proc.userdata["vad"],
        turn_handling=build_turn_handling(settings),
        user_away_timeout=settings.idle_timeout_seconds or None,
    )
    tool_log = ToolLog()
    knowledge = await open_knowledge_tools(settings, resolved.slug, tool_log)
    if knowledge:
        ctx.add_shutdown_callback(lambda _reason: knowledge.close())
    recording = build_call_recording(ctx, config, settings.tenant)
    events = CallSessionEvents(
        session=session,
        publisher=CallEventPublisher(settings.redis_url, settings.redis_prefix),
        room_name=ctx.room.name,
        tenant=settings.tenant,
        agent=resolved.slug,
        recording_url=(lambda: recording.url) if recording else None,
        tool_log=tool_log,
    )
    await session.start(
        room=ctx.room,
        agent=Agent(
            instructions=compose_instructions(config.instructions),
            tools=knowledge.tools if knowledge else [],
        ),
    )
    lifecycle = CallLifecycle(session=session, events=events, job=ctx, settings=settings)
    caller = await wait_for_caller(ctx)
    events.started(caller)
    ctx.add_shutdown_callback(events.on_shutdown)
    lifecycle.watch_caller(ctx.room, caller)
    lifecycle.start()
    if recording:
        ctx.add_shutdown_callback(lambda _reason: recording.stop())
        await start_with_notice(recording, session, config.recording.notice)
    await session.say(config.greeting)


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
