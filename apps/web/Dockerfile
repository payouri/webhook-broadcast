# Build context is the repo root: `docker build -f apps/web/Dockerfile .`

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

FROM deps AS build
COPY . .
RUN pnpm --filter @webhook-broadcast/web run build

# Unprivileged variant: master process runs as uid 101 and listens on 8080
# rather than binding the privileged :80 as root.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# A template rather than a finished conf: the base image's entrypoint runs
# /docker-entrypoint.d/20-envsubst-on-templates.sh over /etc/nginx/templates/
# at start-up, rendering this into /etc/nginx/conf.d/default.conf. That is what
# lets a deployment move the listen port and the api upstream without rebuilding
# the image (issue #100).
#
# The rendering is the entrypoint's job, so this image must keep it: an override
# that replaces the entrypoint with a bare `nginx` never renders the template and
# silently falls back to the base image's stock default.conf, which serves the SPA
# with no /ingest proxying at all — a 200 HTML page where a producer expects its
# 202. Override the *command*, not the entrypoint.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# The defaults are the compose-network values the file used to hard-code, so
# `docker compose up` and `docker run` are unchanged.
#
# On ECS awsvpc every container in a task shares one network namespace: there is
# no `api` hostname to resolve, so API_UPSTREAM has to become a loopback address,
# and whichever of the two moves off 8080 sets its own port. Running the api on
# 8081 (PORT=8081) and leaving web where it is gives
# API_UPSTREAM=http://127.0.0.1:8081 with WEB_PORT untouched; WEB_PORT is there
# for the reverse arrangement, where the api keeps 8080 and web moves.
#
# API_UPSTREAM is a scheme://host:port with no path and no trailing slash — a URI
# part on `proxy_pass` inside a regex `location` is an nginx config error.
ENV WEB_PORT=8080
ENV API_UPSTREAM=http://api:8080

# envsubst replaces *every* variable it is handed, so restrict it to those two:
# nginx's own $host, $scheme, $http_accept, $uri and $proxy_add_x_forwarded_for
# have to reach the rendered config intact, not as empty strings.
ENV NGINX_ENVSUBST_FILTER="^(WEB_PORT|API_UPSTREAM)\$"

# Documents the default only; a deployment that moves WEB_PORT publishes that
# port instead.
EXPOSE 8080
