# One image, three commands (server | worker | migrate) — docs/adr/0008-process-topology-deploy.md.
# Build context is the repo root: `docker build -f apps/api/Dockerfile .`

# --- deps: manifests + lockfile only, so source edits keep the install cached ---
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

# --- build: tsdown inlines the workspace packages, externalises third-party deps ---
FROM deps AS build
COPY . .
RUN pnpm --filter @webhook-broadcast/api run build

# --- prune: production-only node_modules for the api package alone ---
FROM build AS prune
RUN pnpm --filter @webhook-broadcast/api --prod --legacy deploy /prod

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime
WORKDIR /app
ENV NODE_ENV=production

# dist holds the three bundled entrypoints; node_modules holds only the
# externalised runtime deps (bullmq loads its Lua scripts from its own package
# directory, so it must stay on disk rather than be inlined).
COPY --from=prune --chown=node:node /prod/node_modules ./node_modules
COPY --from=prune --chown=node:node /prod/dist ./apps/api/dist
# migrate.mjs resolves this path from the process cwd (/app).
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh
RUN chmod 555 /entrypoint.sh

USER node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["server"]
