import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://worldtester:worldtester@localhost:5432/worldtester";

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Ensures the database schema is up to date before the app starts.
 * Runs `prisma db push` which is idempotent — safe to call every time.
 */
export async function setupDatabase(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    throw new Error(
      `Cannot connect to database. Check DATABASE_URL in .env.\n` +
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
