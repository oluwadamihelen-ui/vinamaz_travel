import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const OUTBOX = path.resolve(process.env.EMAIL_OUTBOX_DIR ?? ".data/outbox");
test.use({ extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9` } });

function latestEmailTo(to: string) {
  let files: string[] = [];
  try { files = readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).sort().reverse(); } catch { return null; }
  for (const f of files) {
    const m = JSON.parse(readFileSync(path.join(OUTBOX, f), "utf8"));
    if (m.to === to) return m as { text: string };
  }
  return null;
}

test("forgot password → emailed link → new password → sign in; link is single-use", async ({ page }) => {
  const email = `reset${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Reset Tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Phone number").fill("+2348030000000");
  await page.getByLabel("Password", { exact: true }).fill("original-pass-123");
  await page.getByLabel("Confirm password").fill("original-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Reset" })).toBeVisible();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/forgot-password/);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();

  // Unknown addresses get the identical response (no account enumeration).
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(`ghost${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();

  await expect.poll(() => latestEmailTo(email)).not.toBeNull();
  const link = latestEmailTo(email)!.text.match(/https?:\/\/\S+reset-password\?token=\S+/)![0];
  const url = new URL(link);

  await page.goto(url.pathname + url.search);
  await page.getByLabel("New password", { exact: true }).fill("new-secure-pass-456");
  await page.getByLabel("Confirm new password").fill("different-pass-456");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill("new-secure-pass-456");
  await page.getByLabel("Confirm new password").fill("new-secure-pass-456");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText("Your password has been updated")).toBeVisible();

  // Old password rejected, new one accepted.
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("original-pass-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Incorrect email or password/)).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("new-secure-pass-456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Reset" })).toBeVisible();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL("/");

  // Reusing the link fails.
  await page.goto(url.pathname + url.search);
  await expect(page.getByText("This reset link is invalid or has expired.")).toBeVisible();
});
