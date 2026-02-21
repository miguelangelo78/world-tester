import { execSync } from "child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/worldtester";

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Ensures the target database exists, creating it if necessary.
 * Connects to the default `postgres` maintenance DB to run CREATE DATABASE.
 */
async function ensureDatabaseExists(): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.slice(1); // strip leading "/"
  if (!dbName) return;

  const maintenanceUrl = new URL(connectionString);
  maintenanceUrl.pathname = "/postgres";

  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Ensures the database exists and schema is up to date before the app starts.
 * Runs `prisma db push` which is idempotent — safe to call every time.
 */
export async function setupDatabase(): Promise<void> {
  try {
    await ensureDatabaseExists();
  } catch {
    throw new Error(
      `Cannot connect to PostgreSQL. Check DATABASE_URL in .env.\n` +
      `Current: ${connectionString.replace(/\/\/.*@/, "//***@")}`,
    );
  }

  try {
    execSync("npx prisma db push", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: connectionString },
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`Failed to sync database schema:\n${stderr}`);
  }
}

export default prisma;
