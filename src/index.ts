import { serve } from "@hono/node-server";
import { Cron } from "croner";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDb, runMigrations } from "./db/client.js";
import { runNightly } from "./services/nightly.js";
import { bootstrapLegacyOwner } from "./services/users.js";

await runMigrations();
await bootstrapLegacyOwner();

// Every 15 minutes, check whether anyone is due for their nightly summary.
const nightly = new Cron("*/15 * * * *", { protect: true }, () =>
  runNightly().catch((err) => console.error("[nightly] failed", err)),
);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`luke-app listening on http://localhost:${info.port} (${config.PUBLIC_URL})`);
});

// Railway sends SIGTERM on redeploy: stop accepting connections and close the database.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[server] ${signal} received, shutting down…`);
    nightly.stop();
    server.close(() => void closeDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
