import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NGINX_TEMPLATE_PATH,
  envsubstFilterAdmits,
  readComposeWebPort,
  readLocationBody,
  readNginxTemplateVariables,
  readWebRuntimeImage,
  requiredEnv,
} from "../scripts/nginxTemplateContract.js";

const image = readWebRuntimeImage();
const template = readFileSync(NGINX_TEMPLATE_PATH, "utf8");
const variables = readNginxTemplateVariables(template);

describe("nginx.conf.template renders from the environment", () => {
  it("substitutes exactly the two deployment-shaped values", () => {
    expect(variables.substituted).toEqual(["API_UPSTREAM", "WEB_PORT"]);
  });

  it("gives every substituted name a compose-compatible default, so an unset env changes nothing", () => {
    expect(image.env.WEB_PORT).toBe("8080");
    expect(image.env.API_UPSTREAM).toBe("http://api:8080");
    for (const name of variables.substituted) {
      expect(image.env[name]).toBeDefined();
    }
  });

  it("copies the template where the entrypoint looks for it", () => {
    // Anywhere else and it is never rendered: the container comes up on the
    // base image's stock config, serving the SPA with no /ingest proxying.
    expect(image.templateDestination).toBe("/etc/nginx/templates/default.conf.template");
  });

  it("exposes the port WEB_PORT defaults to", () => {
    expect(image.exposedPort).toBe(image.env.WEB_PORT);
  });

  it("pins the same port in compose, so the listen port cannot desync from the healthcheck", () => {
    expect(readComposeWebPort()).toBe(image.env.WEB_PORT);
  });
});

describe("the machine endpoints reach the api, never the SPA shell", () => {
  // What this guards is worse than a 404 (issue #103): a path with no location
  // of its own falls through to `try_files` and nginx answers /index.html with
  // a 200. A monitor on /health then stays green while the api is dead, and
  // /ready — the only endpoint reporting datastore connectivity — becomes
  // indistinguishable from a healthy SPA.
  const machineEndpoints = ["~ ^/ingest(/|$)", "~ ^/(health|ready)$"];

  it.each(machineEndpoints)("`location %s` proxies to the api upstream", (header) => {
    const body = readLocationBody(header, template);
    expect(body, `nginx.conf.template declares no \`location ${header}\``).toBeDefined();
    expect(body).toContain("proxy_pass ${API_UPSTREAM};");
  });

  it.each(machineEndpoints)("`location %s` is exempt from the SPA fallback", (header) => {
    // The admin block earns its fallback by branching on `Accept: text/html`
    // (issue #42). These are machine endpoints: a producer or a monitor that
    // advertises text/html must still get the api's answer, so neither half of
    // that mechanism may appear here.
    const body = readLocationBody(header, template);
    expect(body).not.toContain("http_accept");
    expect(body).not.toContain("index.html");
  });
});

describe("NGINX_ENVSUBST_FILTER", () => {
  // An absent filter is not a neutral default: envsubst then substitutes every
  // name it knows, which is precisely the failure the tests below describe. The
  // empty pattern models that, matching everything.
  const filter = image.env.NGINX_ENVSUBST_FILTER ?? "";

  it("is declared, or envsubst would replace every name it knows", () => {
    expect(image.env.NGINX_ENVSUBST_FILTER).toBeDefined();
  });

  it("admits every substituted name", () => {
    for (const name of variables.substituted) {
      expect(envsubstFilterAdmits(filter, name)).toBe(true);
    }
  });

  it("keeps nginx's own runtime variables out, so they reach the rendered config intact", () => {
    // The failure this guards is silent: $host and friends would render as
    // empty strings, dropping header forwarding and the #42 SPA fallback.
    expect(variables.nginxRuntime).toContain("host");
    expect(variables.nginxRuntime).toContain("http_accept");
    for (const name of variables.nginxRuntime) {
      expect(envsubstFilterAdmits(filter, name)).toBe(false);
    }
  });

  it("is anchored, so it cannot admit a name that merely contains one of the two", () => {
    expect(envsubstFilterAdmits(filter, "MY_WEB_PORT")).toBe(false);
    expect(envsubstFilterAdmits(filter, "API_UPSTREAM_TIMEOUT")).toBe(false);
  });
});

/**
 * The checks above read the Dockerfile; these render the template with the real
 * base image, which is the only thing that can catch the entrypoint's substitution
 * semantics changing under a base-image bump. Skipped where docker cannot supply
 * that image, so the suite stays runnable offline.
 */
const docker = (...args: string[]) =>
  spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });

const baseImageAvailable = () => {
  if (docker("version", "--format", "{{.Server.Version}}").status !== 0) return false;
  if (docker("image", "inspect", image.baseImage).status === 0) return true;
  return docker("pull", "--quiet", image.baseImage).status === 0;
};

describe.runIf(baseImageAvailable())("the entrypoint's rendering of the template", () => {
  const render = (env: Record<string, string>) => {
    const envArgs = Object.entries({ ...image.env, ...env }).flatMap(([k, v]) => [
      "-e",
      `${k}=${v}`,
    ]);
    const result = docker(
      "run",
      "--rm",
      "-v",
      `${NGINX_TEMPLATE_PATH}:${image.templateDestination}:ro`,
      ...envArgs,
      "--entrypoint",
      "/bin/sh",
      image.baseImage,
      "-c",
      // The entrypoint only runs /docker-entrypoint.d/* when its command is
      // nginx; `nginx -v` gets the rendering done without needing the upstream
      // to resolve, which `nginx -t` would.
      "/docker-entrypoint.sh nginx -v >/dev/null 2>&1 && cat /etc/nginx/conf.d/default.conf",
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };

  it("replaces the two names and touches nothing else in the file", () => {
    // Byte-exact: any other name the entrypoint decided to substitute, or any
    // nginx runtime variable it blanked, shows up as a diff here.
    expect(render({})).toBe(
      template
        .replaceAll("${WEB_PORT}", requiredEnv(image, "WEB_PORT"))
        .replaceAll("${API_UPSTREAM}", requiredEnv(image, "API_UPSTREAM")),
    );
  });

  it("defaults to the compose values the config used to hard-code", () => {
    const rendered = render({});
    expect(rendered).toContain("listen 8080;");
    expect(rendered).toContain("proxy_pass http://api:8080;");
  });

  it("moves both values for a shared network namespace, as an ECS awsvpc task needs", () => {
    const rendered = render({ WEB_PORT: "9090", API_UPSTREAM: "http://127.0.0.1:8081" });
    expect(rendered).toContain("listen 9090;");
    expect(rendered).toContain("proxy_pass http://127.0.0.1:8081;");
    expect(rendered).not.toContain("http://api:8080");
  });

  it("leaves nginx's runtime variables in the rendered config", () => {
    const rendered = render({ WEB_PORT: "9090", API_UPSTREAM: "http://127.0.0.1:8081" });
    for (const name of variables.nginxRuntime) {
      expect(rendered).toContain(`$${name}`);
    }
  });
});
