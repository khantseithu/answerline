from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import silero

from .config import load_agent_config
from .providers import build_llm_chain, build_stt, build_tts
from .settings import Settings

settings = Settings()
server = AgentServer()


@server.rtc_session(agent_name="answerline")
async def entrypoint(ctx: JobContext) -> None:
    config = load_agent_config(settings.agent_config)
    session = AgentSession(
        stt=build_stt(config.models.stt),
        llm=build_llm_chain(config.models),
        tts=build_tts(config.models.tts),
        vad=silero.VAD.load(),
    )
    await session.start(room=ctx.room, agent=Agent(instructions=config.instructions))
    await session.say(config.greeting)


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
