import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function submittedApplication(page: Page, name: string, email: string): Promise<string> {
  await page.goto("/register?next=/apply/e2e-journey");
  await page.getByLabel("Full name").fill(name);
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

test("messaging with attachments, notifications, dashboard and audit log", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const name = `Msg Client ${uid()}`;
  const email = `p5c${uid()}@example.com`;

  // client submits; welcome + submission notifications exist
  const client = await ctx(browser, baseURL);
  const appId = await submittedApplication(client.page, name, email);
  await client.page.goto("/client/notifications");
  await expect(client.page.getByText("Welcome to Vinamaz Travels")).toBeVisible();
  await expect(client.page.getByText(/Application VNZ-\d{4}-\d{6} received/)).toBeVisible();

  // client sends a message with an attachment through the direct-upload pipeline
  await client.page.goto(`/client/applications/${appId}#messages`);
  await client.page.getByLabel("Your message").fill("Hello, can you confirm my passport scan is readable?");
  await client.page.locator(`#att-${appId}`).setInputFiles({ name: "extra-id.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(client.page.getByText("extra-id.pdf").first()).toBeVisible();
  await client.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(client.page.getByRole("log", { name: "Messages" }).getByText("Hello, can you confirm my passport scan is readable?")).toBeVisible();
  const attachmentHref = await client.page.getByRole("log", { name: "Messages" }).getByRole("link", { name: /extra-id\.pdf/ }).getAttribute("href");
  expect(attachmentHref).toMatch(/^\/api\/messages\/attachments\//);
  expect((await client.context.request.get(attachmentHref!)).status()).toBe(200);

  // a different client can't reach the attachment or the conversation
  const other = await ctx(browser, baseURL);
  await submittedApplication(other.page, `Other ${uid()}`, `p5o${uid()}@example.com`);
  expect((await other.context.request.get(attachmentHref!)).status()).toBe(404);
  expect((await other.page.goto(`/client/applications/${appId}`))?.status()).toBe(404);
  const anon = await browser.newContext({ baseURL });
  expect((await anon.request.get(attachmentHref!)).status()).toBe(401);

  // staff: lands on the dashboard, sees the unread message everywhere
  const admin = await ctx(browser, baseURL);
  await signIn(admin.page, ADMIN.email, ADMIN.password);
  await admin.page.goto("/admin");
  await expect(admin.page).toHaveURL(/\/admin\/dashboard/);
  await expect(admin.page.getByRole("heading", { name: "Action required" })).toBeVisible();
  await expect(admin.page.getByText("Unread client messages")).toBeVisible();
  await expect(admin.page.getByRole("heading", { name: "Recent client messages" })).toBeVisible();
  await admin.page.goto("/admin/messages");
  await expect(admin.page.getByText(name).first()).toBeVisible();
  await expect(admin.page.getByText(/unread/).first()).toBeVisible();
  await admin.page.getByText(name).first().click();
  await expect(admin.page).toHaveURL(new RegExp(`${appId}\\?tab=messages`));
  await expect(admin.page.getByText("Hello, can you confirm my passport scan is readable?")).toBeVisible();
  expect((await admin.context.request.get(attachmentHref!)).status()).toBe(200);
  await admin.page.getByLabel("Your message").fill("Yes, your scan is clear. We will begin review shortly.");
  await admin.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(admin.page.getByRole("log", { name: "Messages" }).getByText("Yes, your scan is clear.")).toBeVisible();

  // client sees the reply, the unread cue on the dashboard card, and a notification
  await client.page.goto("/client/dashboard");
  await expect(client.page.getByRole("link", { name: /1 new message/ })).toBeVisible();
  await expect(client.page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();
  await client.page.goto(`/client/applications/${appId}#messages`);
  await expect(client.page.getByText("Yes, your scan is clear.")).toBeVisible();
  await expect(client.page.getByText("Vinamaz Travels").first()).toBeVisible();
  await client.page.goto("/client/notifications");
  await client.page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(client.page.getByText("You're all caught up.")).toBeVisible();

  // audit log (super admin) records the conversation
  await admin.page.goto("/admin/audit");
  await expect(admin.page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await admin.page.getByLabel("Action").selectOption("message.sent");
  await admin.page.getByRole("button", { name: "Apply filters" }).click();
  await expect(admin.page.getByText("message.sent").first()).toBeVisible();
});

test("a plain client can't open staff pages, and the public header adapts to the session", async ({ browser, baseURL }) => {
  const client = await ctx(browser, baseURL);
  await client.page.goto("/packages");
  await expect(client.page.getByRole("link", { name: "Create account" }).first()).toBeVisible();
  await submittedApplication(client.page, `Plain ${uid()}`, `p5p${uid()}@example.com`);
  for (const path of ["/admin/dashboard", "/admin/audit", "/admin/messages"]) {
    await client.page.goto(path);
    await expect(client.page).not.toHaveURL(new RegExp(path));
  }
  await client.page.goto("/packages");
  await expect(client.page.getByRole("link", { name: "My portal" })).toBeVisible();
});
