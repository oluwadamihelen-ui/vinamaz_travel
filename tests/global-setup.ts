import { execSync } from "node:child_process";

/** Applies migrations to the dedicated test database (never the dev/prod one). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://vinamaz:vinamaz@localhost:5432/vinamaz_test";
  if (!/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: "" } });
}
