import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const sql = postgres(config.DATABASE_URL, { onnotice: () => {} });

export const db = drizzle(sql, { schema });

export async function closeDb() {
  await sql.end({ timeout: 5 });
}

export async function runMigrations() {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
