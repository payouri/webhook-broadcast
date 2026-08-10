import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default is Node; web test files opt into jsdom via a
    // `// @vitest-environment jsdom` docblock (they're the only
    // browser-facing package).
    environment: "node",
    include: ["apps/**/test/**/*.test.{ts,tsx}", "packages/**/test/**/*.test.{ts,tsx}"],
  },
});
