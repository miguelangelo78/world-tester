import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Load .env from the monorepo root
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, "..", "..", ".env") });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL") ?? "postgresql://postgres:postgres@localhost:5432/worldtester",
  },
});
