import { serve } from "@hono/node-server";
import { Cron } from "croner";
import { app } from "./app.js";
import { config } from "./config.js";
import { runMigrations } from "./db/client.js";
import { runNightly } from "./services/nightly.js";

await runMigrations();

// Revisa cada 15 minutos si toca mandar el resumen nocturno.
new Cron("*/15 * * * *", { protect: true }, () =>
  runNightly().catch((err) => console.error("[nightly] falló", err)),
);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`luke-app escuchando en http://localhost:${info.port}`);
});
