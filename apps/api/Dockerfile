# One image, three commands (server | worker | migrate) — docs/adr/0008-process-topology-deploy.md.
# Build context is the repo root: `docker build -f apps/api/Dockerfile .`

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @webhook-broadcast/api run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copying the full workspace (not a pruned node_modules) trades image size
# for correctness on the first scaffold pass — pnpm's `deploy` command is
# the documented follow-up for a slimmer, single-package production image.
COPY --from=build /app /app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["server"]
