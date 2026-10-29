import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to migrate current conditions.");

const migrationsDirectory = new URL("../database/migrations/", import.meta.url);
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const pool = new Pool({ connectionString });

try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );

  for (const name of migrationNames) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;

    const sql = await readFile(join(migrationsDirectory.pathname, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
