import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts", "src/migrate.ts"],
  format: "esm",
  target: "node24",
  outDir: "dist",
  platform: "node",
  clean: true,
  // Inline the in-repo workspace packages (consumed as source per ADR 0006)
  // so the runtime image doesn't need their node_modules symlinks resolvable
  // post-bundle; third-party deps (bullmq, pg, drizzle-orm, ...) stay
  // external — bullmq in particular loads Lua scripts relative to its own
  // package directory at runtime and must not be inlined.
  deps: {
    alwaysBundle: [/^@webhook-broadcast\//],
  },
});
