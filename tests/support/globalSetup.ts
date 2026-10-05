import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const TEST_URL = process.env.DATABASE_URL ?? "postgres://luke:luke@localhost:5433/luke_test";

/** Crea la base de prueba (si no existe) y aplica las migraciones. */
export default async function setup() {
  const url = new URL(TEST_URL);
  const dbName = url.pathname.slice(1);
  const admin = postgres({ ...parse(url), database: "postgres" });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (exists.length === 0) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const sql = postgres(TEST_URL, { onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}

function parse(url: URL) {
  return { host: url.hostname, port: Number(url.port || 5432), username: url.username, password: url.password };
}
