import { serve } from "@hono/node-server";
import { Cron } from "croner";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDb, runMigrations } from "./db/client.js";
import { runNightly } from "./services/nightly.js";

await runMigrations();

// Revisa cada 15 minutos si toca mandar el resumen nocturno.
const nightly = new Cron("*/15 * * * *", { protect: true }, () =>
  runNightly().catch((err) => console.error("[nightly] falló", err)),
);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`luke-app escuchando en http://localhost:${info.port}`);
});

// Railway manda SIGTERM al redeployar: dejamos de aceptar conexiones y cerramos la base.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[server] ${signal} recibido, cerrando…`);
    nightly.stop();
    server.close(() => void closeDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
