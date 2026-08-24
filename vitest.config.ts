import { configDefaults, defineConfig } from "vitest/config";

/**
 * Three projects in two ordered groups (issue #105).
 *
 * One `vitest run` used to mix testcontainers Postgres startups, docker-based
 * nginx template rendering, and jsdom React renders at default parallelism.
 * Sixteen container startups are a CPU spike, and the jsdom renders they
 * starved lost races they win easily on their own — a suite that went red for
 * reasons unrelated to the diff, then green on re-run.
 *
 * `sequence.groupOrder` keeps the two costs apart: everything in-process runs
 * and finishes before anything reaches for docker. Both groups then get the
 * timeouts their own work actually needs, rather than one global default
 * stretched to cover a container pull and a `getByRole` alike.
 *
 * Node stays the default environment; the jsdom files opt in through their own
 * `// @vitest-environment jsdom` docblock, as they always have.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "web",
          environment: "node",
          include: ["apps/web/test/**/*.test.tsx"],
          // Raises Testing Library's own async budget — see the file's comment.
          setupFiles: ["./apps/web/test/setup.jsdom.ts"],
          // Strictly above the 5000ms `asyncUtilTimeout` the setup file sets,
          // so a wait that never resolves fails as a Testing Library error
          // naming the missing element, not as an opaque Vitest timeout.
          testTimeout: 15000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
          // Spread the defaults rather than replacing them: dropping
          // `**/node_modules/**` collects the contract package's tests a
          // second time through the pnpm workspace symlink under
          // `packages/db/node_modules`. The one addition is docker-gated, so
          // it belongs to the second group with the rest.
          exclude: [...configDefaults.exclude, "apps/web/test/nginxConfigTemplate.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/test/**/*.test.ts", "apps/web/test/nginxConfigTemplate.test.ts"],
          // A `docker run` is not a function call: the nginx template tests
          // spawn one per case, and the api suite starts a Postgres container
          // per file inside `beforeAll`. The default 5000ms/10000ms budgets
          // are thin for a cold image and a migration run on a loaded host.
          testTimeout: 30000,
          hookTimeout: 120000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
