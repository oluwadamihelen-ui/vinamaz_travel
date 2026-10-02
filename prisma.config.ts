import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate/studio) should use a direct, non-pooled connection when
// available (Neon). The application itself uses DATABASE_URL via a driver adapter.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
