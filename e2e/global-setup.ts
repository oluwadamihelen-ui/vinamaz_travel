import { execSync } from "node:child_process";

// The generated Prisma client is ESM-only, so the fixture runs under tsx rather than inside Playwright's CJS loader.
export default function globalSetup() {
  execSync("npx tsx e2e/fixture.ts", { stdio: "inherit" });
}
