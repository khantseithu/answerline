from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli
from livekit.local_inference import init_eot
from livekit.plugins import silero

from .call_session import CallSessionEvents, wait_for_caller
from .prompts import compose_instructions
from .providers import build_llm_chain, build_stt, build_tts
from .publisher import CallEventPublisher
from .resolve import resolve_agent
from .settings import Settings
from .turns import build_turn_handling

settings = Settings()
server = AgentServer()


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
    )
    events = CallSessionEvents(
        session=session,
        publisher=CallEventPublisher(settings.redis_url, settings.redis_prefix),
        room_name=ctx.room.name,
        tenant=settings.tenant,
        agent=resolved.slug,
    )
    await session.start(
        room=ctx.room,
        agent=Agent(instructions=compose_instructions(config.instructions)),
    )
    events.started(await wait_for_caller(ctx))
    ctx.add_shutdown_callback(events.on_shutdown)
    await session.say(config.greeting)


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
