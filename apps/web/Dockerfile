FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @answerline/web exec next build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/agents ./agents
COPY --from=build --chown=node:node /app/evals ./evals
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN mkdir -p /app/.data/knowledge && chown -R node:node /app/.data
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "server.js"]
