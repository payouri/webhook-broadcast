// The web image's nginx config is rendered at start-up rather than baked in
// (issue #100): the base image's /docker-entrypoint.d/20-envsubst-on-templates.sh
// runs `envsubst` over /etc/nginx/templates/*.template. That buys deployability
// on an ECS awsvpc task, at the cost of a config that no longer exists until a
// container starts — so the invariants that used to be visible in a static file
// are asserted here instead.
//
// The dangerous one is the allow-list. `envsubst` substitutes every name it is
// handed, so nginx's own runtime variables ($host, $uri, ...) have to be kept
// out of NGINX_ENVSUBST_FILTER or they render as empty strings and the config
// silently loses header forwarding and the SPA fallback.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");

export const NGINX_TEMPLATE_PATH = resolve(webRoot, "nginx.conf.template");
export const WEB_DOCKERFILE_PATH = resolve(webRoot, "Dockerfile");
export const COMPOSE_PATH = resolve(repoRoot, "docker-compose.yml");

/** The runtime stage of apps/web/Dockerfile, as the rendering depends on it. */
export interface WebRuntimeImage {
  /** Fully qualified `FROM` ref of the runtime stage, digest included. */
  baseImage: string;
  /** `ENV` defaults declared in the runtime stage. */
  env: Record<string, string>;
  /** Where the template lands; the entrypoint only renders /etc/nginx/templates. */
  templateDestination: string;
  exposedPort: string;
}

/** A capture group the caller has already established must be there. */
function captured(match: RegExpExecArray | null, group: number, what: string): string {
  const value = match?.[group];
  if (value === undefined) {
    throw new Error(`apps/web/Dockerfile runtime stage: could not read ${what}`);
  }
  return value;
}

export function readWebRuntimeImage(
  dockerfile = readFileSync(WEB_DOCKERFILE_PATH, "utf8"),
): WebRuntimeImage {
  // Everything from the last `FROM` on: the deps and build stages declare their
  // own ENV/COPY lines and must not be mistaken for the runtime stage's.
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM ") + 1);

  const env: Record<string, string> = {};
  for (const match of runtimeStage.matchAll(/^ENV\s+([A-Z0-9_]+)=(.*)$/gm)) {
    const name = captured(match, 1, "an ENV name");
    // Dockerfile ENV quoting, and `\$` for a literal dollar the shell must not eat.
    env[name] = captured(match, 2, `the value of ENV ${name}`)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replaceAll("\\$", "$");
  }

  return {
    baseImage: captured(/^FROM\s+(\S+)/m.exec(runtimeStage), 1, "the runtime FROM"),
    env,
    templateDestination: captured(
      /^COPY\s+apps\/web\/nginx\.conf\.template\s+(\S+)/m.exec(runtimeStage),
      1,
      "the template's COPY destination",
    ),
    exposedPort: captured(/^EXPOSE\s+(\S+)/m.exec(runtimeStage), 1, "the EXPOSE port"),
  };
}

/** An `ENV` default the runtime stage is required to declare. */
export function requiredEnv(image: WebRuntimeImage, name: string): string {
  const value = image.env[name];
  if (value === undefined) {
    throw new Error(`apps/web/Dockerfile runtime stage: no ENV ${name}`);
  }
  return value;
}

export interface NginxTemplateVariables {
  /** `${NAME}` — the deployment-shaped values envsubst is meant to replace. */
  substituted: string[];
  /** `$name` — nginx's own runtime variables, which must survive rendering. */
  nginxRuntime: string[];
}

export function readNginxTemplateVariables(
  template = readFileSync(NGINX_TEMPLATE_PATH, "utf8"),
): NginxTemplateVariables {
  const namesMatching = (pattern: RegExp) =>
    [...template.matchAll(pattern)].flatMap((match) => match[1] ?? []);

  const substituted = new Set(namesMatching(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g));
  const nginxRuntime = new Set(namesMatching(/\$(?!\{)([A-Za-z_][A-Za-z0-9_]*)/g));

  return { substituted: [...substituted].sort(), nginxRuntime: [...nginxRuntime].sort() };
}

/**
 * Whether NGINX_ENVSUBST_FILTER admits `name`.
 *
 * The base image feeds the filter to awk as an ERE and substitutes only the
 * matching names. This evaluates it as a JS regex, which agrees with awk for
 * the anchored-alternation shape used here; the docker-backed test in
 * apps/web/test/nginxConfigTemplate.test.ts covers the real semantics.
 */
export function envsubstFilterAdmits(filter: string, name: string): boolean {
  return new RegExp(filter).test(name);
}

/** The `WEB_PORT` compose pins on the web service, if it pins one. */
export function readComposeWebPort(
  compose = readFileSync(COMPOSE_PATH, "utf8"),
): string | undefined {
  const webService = /^ {2}web:\n((?: {4}.*\n|\n)*)/m.exec(compose)?.[1];
  if (webService === undefined) {
    throw new Error("docker-compose.yml: no `web` service found");
  }
  return /^\s*WEB_PORT:\s*(\S+)/m.exec(webService)?.[1];
}

/**
 * The body of `location <header> { ... }` in the template, or undefined if the
 * template declares no such location.
 *
 * An assertion about one path space has to read the location that actually
 * serves it, not the whole file: searching the template for `proxy_pass` passes
 * just as happily when the only one sits in some other block.
 */
export function readLocationBody(
  header: string,
  template = readFileSync(NGINX_TEMPLATE_PATH, "utf8"),
): string | undefined {
  const opening = template.indexOf(`location ${header} {`);
  if (opening === -1) return undefined;

  const start = template.indexOf("{", opening);
  let depth = 0;
  for (let index = start; index < template.length; index += 1) {
    if (template[index] === "{") depth += 1;
    else if (template[index] === "}" && --depth === 0) {
      return template.slice(start + 1, index);
    }
  }
  throw new Error(`nginx.conf.template: \`location ${header}\` is never closed`);
}
