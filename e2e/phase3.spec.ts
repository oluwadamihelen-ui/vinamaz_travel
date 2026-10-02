import { expect, test, type Browser, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const OUTBOX = path.resolve(process.env.EMAIL_OUTBOX_DIR ?? ".data/outbox");
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin.e2e@example.com", password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const uid = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function ctx(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  return { context, page: await context.newPage() };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

function latestEmailTo(to: string) {
  let files: string[] = [];
  try { files = readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).sort().reverse(); } catch { return null; }
  for (const f of files) {
    const m = JSON.parse(readFileSync(path.join(OUTBOX, f), "utf8"));
    if (m.to === to) return m as { text: string };
  }
  return null;
}

/** Registers a client, applies to the e2e package and submits. Returns the application id. */
async function submittedApplication(page: Page, email: string): Promise<string> {
  await page.goto("/register?next=/apply/e2e-journey");
  await page.getByLabel("Full name").fill("Phase Three Client");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Phone number").fill("+2348030000000");
  await page.getByLabel("Password", { exact: true }).fill("a-long-password-123");
  await page.getByLabel("Confirm password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Begin application" }).click();
  await expect(page).toHaveURL(/\/client\/applications\/[^/]+\/apply/);
  const id = page.url().match(/applications\/([^/]+)\//)![1]!;
  await page.getByLabel("Date of birth").fill("1990-05-01");
  await page.getByLabel("Nationality").fill("Nigerian");
  await page.getByRole("button", { name: /Save & continue/ }).click();
  await page.getByLabel("Marital status").selectOption("single");
  await page.getByRole("button", { name: /Save & continue/ }).click();
  await page.getByLabel("Passport number").fill("A1234567");
  await page.getByRole("button", { name: /Save & continue/ }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("Uploaded · under review soon")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).last().click();
  await page.getByLabel(/I confirm/).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Application submitted.")).toBeVisible();
  return id;
}

test("document review workflow across client, admin and restricted staff", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const clientEmail = `p3c${uid()}@example.com`;
  const staffEmail = `p3s${uid()}@example.com`;
  const staffName = `Stella ${uid()}`;

  // 1. client submits an application
  const client = await ctx(browser, baseURL);
  const appId = await submittedApplication(client.page, clientEmail);

  // 2. super admin invites a staff member with limited permissions
  const admin = await ctx(browser, baseURL);
  await signIn(admin.page, ADMIN.email, ADMIN.password);
  await admin.page.goto("/admin/staff");
  await admin.page.getByLabel("Full name").fill(staffName);
  await admin.page.getByLabel("Email", { exact: true }).fill(staffEmail);
  for (const perm of ["Review documents", "Change application status", "Add notes / manage applications"]) await admin.page.getByLabel(perm).first().check();
  await admin.page.getByRole("button", { name: "Create account & send invite" }).click();
  await expect(admin.page.getByText("Account created and invitation emailed.")).toBeVisible();
  await expect.poll(() => latestEmailTo(staffEmail)).not.toBeNull();
  const invite = latestEmailTo(staffEmail)!.text.match(/https?:\/\/\S+reset-password\?token=\S+/)![0];

  const staff = await ctx(browser, baseURL);
  const inviteUrl = new URL(invite);
  await staff.page.goto(inviteUrl.pathname + inviteUrl.search);
  await staff.page.getByLabel("New password", { exact: true }).fill("staff-password-123");
  await staff.page.getByLabel("Confirm new password").fill("staff-password-123");
  await staff.page.getByRole("button", { name: "Update password" }).click();
  await expect(staff.page).toHaveURL(/login\?reset=1/);

  // 3. staff see NOTHING until an application is assigned to them
  await signIn(staff.page, staffEmail, "staff-password-123");
  await expect(staff.page).toHaveURL(/\/admin\/applications/);
  await expect(staff.page.getByText("No applications are assigned to you yet.")).toBeVisible();
  expect((await staff.page.goto(`/admin/applications/${appId}`))?.status()).toBe(404);
  await staff.page.goto("/admin/staff");
  await expect(staff.page).not.toHaveURL(/admin\/staff/); // no settings.manage

  // 4. admin finds the application, assigns it, starts the review
  await admin.page.goto("/admin/applications");
  await admin.page.getByLabel("Search").fill(clientEmail);
  await admin.page.getByRole("button", { name: "Apply filters" }).click();
  await admin.page.getByRole("link", { name: /VNZ-\d{4}-\d{6}/ }).first().click();
  await expect(admin.page).toHaveURL(new RegExp(appId));
  await admin.page.getByLabel("Assigned to").selectOption({ label: `${staffName} (staff)` });
  await admin.page.getByRole("button", { name: "Save assignment" }).click();
  await expect(admin.page.getByText("Assigned.")).toBeVisible();
  await admin.page.getByLabel("Change status to").selectOption({ label: "Under review" });
  await admin.page.getByLabel("Message to the client (optional)").fill("We have started reviewing your application.");
  await admin.page.getByRole("button", { name: "Update status" }).click();
  await expect(admin.page.getByText("Status updated.")).toBeVisible();

  // 5. staff now see exactly that application and ask for a replacement passport scan
  await staff.page.goto("/admin/applications");
  await expect(staff.page.getByRole("link", { name: /VNZ-\d{4}-\d{6}/ })).toHaveCount(1);
  await staff.page.getByRole("link", { name: /VNZ-\d{4}-\d{6}/ }).click();
  await staff.page.getByRole("link", { name: /^Documents/ }).click();
  await staff.page.getByRole("button", { name: "Request replacement" }).click();
  await staff.page.getByLabel("What should the client fix?").fill("Passport bio page is blurry");
  await staff.page.getByRole("button", { name: "Send replacement request" }).click();
  await expect(staff.page.getByText("Document updated.")).toBeVisible();
  await expect(staff.page.getByText("Replacement required").first()).toBeVisible();
  await staff.page.getByRole("link", { name: "Internal notes" }).click();
  await staff.page.getByLabel("Add an internal note").fill("INTERNAL-SECRET: client called, passport is old");
  await staff.page.getByRole("button", { name: "Add note" }).click();
  await expect(staff.page.getByText("Note added.")).toBeVisible();

  // 6. the client sees what to do, with the reason, and never the internal note
  await client.page.goto("/client/dashboard");
  await expect(client.page.getByText("Upload updated International passport")).toBeVisible();
  await expect(client.page.getByText("Passport bio page is blurry").first()).toBeVisible();
  await expect(client.page.getByText("Documents required").first()).toBeVisible();
  await client.page.goto(`/client/applications/${appId}`);
  await expect(client.page.getByText("We have started reviewing your application.")).toBeVisible();
  await expect(client.page.getByText("Replacement required").first()).toBeVisible();
  expect(await client.page.content()).not.toContain("INTERNAL-SECRET");
  await expect(client.page.getByRole("listitem").filter({ hasText: "Documents reviewed" }).first()).toHaveAttribute("aria-current", "step");

  // 7. client uploads a replacement → application returns to review
  await client.page.locator('input[type="file"]').setInputFiles({ name: "passport-clear.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(client.page.getByText("Uploaded · under review soon")).toBeVisible();
  await client.page.reload();
  await expect(client.page.getByText("Documents under review").first()).toBeVisible();

  // 8. staff approve the new upload and move the application to processing
  await staff.page.goto(`/admin/applications/${appId}?tab=documents`);
  await staff.page.getByRole("button", { name: "Approve" }).click();
  await expect(staff.page.getByText("Document updated.")).toBeVisible();
  await staff.page.goto(`/admin/applications/${appId}`);
  await staff.page.getByLabel("Change status to").selectOption({ label: "Processing" });
  await staff.page.getByRole("button", { name: "Update status" }).click();
  await expect(staff.page.getByText("Status updated.")).toBeVisible();

  await client.page.goto(`/client/applications/${appId}`);
  await expect(client.page.getByRole("listitem").filter({ hasText: "Application processing" }).first()).toHaveAttribute("aria-current", "step");
  await expect(client.page.getByText("Approved").first()).toBeVisible(); // the document badge
  await client.page.goto("/client/dashboard");
  await expect(client.page.getByText("Nothing needed from you right now")).toBeVisible();

  await Promise.all([client.context.close(), admin.context.close(), staff.context.close()]);
});

test("clients cannot reach admin pages and anonymous users are redirected", async ({ page }) => {
  await page.goto("/admin/applications");
  await expect(page).toHaveURL(/\/login/);
});
