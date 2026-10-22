from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli
from livekit.plugins import silero

from .prompts import compose_instructions
from .providers import build_llm_chain, build_stt, build_tts
from .resolve import resolve_agent
from .settings import Settings

settings = Settings()
server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="answerline")
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    resolved = await resolve_agent(ctx.job.metadata, settings)
    config = resolved.config
    session = AgentSession(
        stt=build_stt(config.models.stt),
        llm=build_llm_chain(config.models),
        tts=build_tts(config.models.tts),
        vad=ctx.proc.userdata["vad"],
    )
    await session.start(
        room=ctx.room,
        agent=Agent(instructions=compose_instructions(config.instructions)),
    )
    await session.say(config.greeting)


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
