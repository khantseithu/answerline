FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
COPY . .
RUN uv sync --locked --no-dev \
    && useradd --create-home --uid 10001 agent \
    && chown -R agent:agent /app
ENV UV_NO_SYNC=1
ENV AGENTS_DIR=/app/agents
ENV HF_HOME=/home/agent/.cache/huggingface
USER agent
RUN uv run -m livekit.agents download-files
ENTRYPOINT ["uv", "run", "answerline-agent"]
CMD ["start"]
