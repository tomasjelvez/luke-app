import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Variables de entorno de prueba antes de que se importe src/config.ts.
    setupFiles: ["./tests/support/env.ts"],
    globalSetup: ["./tests/support/globalSetup.ts"],
    // Los tests de integración comparten la base de prueba: los corremos en serie.
    fileParallelism: false,
  },
});
