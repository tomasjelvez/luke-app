import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test env vars, set before src/config.ts is imported.
    setupFiles: ["./tests/support/env.ts"],
    globalSetup: ["./tests/support/globalSetup.ts"],
    // Integration tests share the test database, so they run serially.
    fileParallelism: false,
  },
});
