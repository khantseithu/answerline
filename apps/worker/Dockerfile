FROM node:25-bookworm-slim AS node

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /opt/pnpm \
    && curl -fsSL https://registry.npmjs.org/pnpm/-/pnpm-11.15.1.tgz \
       | tar -xz -C /opt/pnpm --strip-components=1 \
    && chmod +x /opt/pnpm/bin/pnpm.cjs \
    && ln -s /opt/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
    && uv sync --locked --no-dev

ENV UV_NO_SYNC=1
ENTRYPOINT ["/app/scripts/docker-worker.sh"]
CMD ["start"]
