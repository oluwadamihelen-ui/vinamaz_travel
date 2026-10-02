import { expect, test, type Browser, type Page } from "@playwright/test";

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function newClient(browser: Browser, baseURL: string | undefined, name: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  const page = await context.newPage();
  await page.goto("/register?next=/apply/e2e-journey");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(`app${Date.now()}${Math.floor(Math.random() * 10000)}@example.com`);
  await page.getByLabel("Phone number").fill("+2348030000000");
  await page.getByLabel("Password", { exact: true }).fill("a-long-password-123");
  await page.getByLabel("Confirm password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Begin application" })).toBeVisible();
  return { context, page };
}

async function fillDetails(page: Page) {
  await expect(page.getByLabel("Full name (as shown on your passport)")).toHaveValue(/.+/); // prefilled from the account
  await page.getByLabel("Date of birth").fill("1990-05-01");
  await page.getByLabel("Nationality").fill("Nigerian");
}

test("full journey: start, save & resume, conditional fields, upload, review, submit", async ({ browser, baseURL }) => {
  const { context, page } = await newClient(browser, baseURL, "Journey Tester");
  await page.getByRole("button", { name: "Begin application" }).click();
  await expect(page).toHaveURL(/\/client\/applications\/.+\/apply/);
  await expect(page.getByText(/VNZ-\d{4}-\d{6}/).first()).toBeVisible();

  // Step 1: required fields are enforced when advancing, but progress is kept.
  await page.getByLabel("Nationality").fill("");
  await page.getByRole("button", { name: /Save & continue/ }).click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
  await fillDetails(page);
  await page.getByRole("button", { name: "Save & exit" }).click();
  await expect(page).toHaveURL(/\/client\/dashboard\?saved=1/);
  await expect(page.getByText("Your progress has been saved")).toBeVisible();

  // Resume from the dashboard.
  await page.getByRole("link", { name: /Continue application/ }).first().click();
  await expect(page.getByLabel("Nationality")).toHaveValue("Nigerian");
  await page.getByRole("button", { name: /Save & continue/ }).click();

  // Step 2: conditional field appears only when "Married" is chosen.
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
  await expect(page.getByLabel("Spouse name")).toHaveCount(0);
  await page.getByLabel("Marital status").selectOption("married");
  await expect(page.getByLabel("Spouse name")).toBeVisible();
  await page.getByLabel("Marital status").selectOption("single");
  await expect(page.getByLabel("Spouse name")).toHaveCount(0);
  await page.getByRole("button", { name: /Save & continue/ }).click();

  // Step 3: passport question
  await page.getByLabel("Passport number").fill("A1234567");
  await page.getByRole("button", { name: /Save & continue/ }).click();

  // Documents: cannot continue without the required document; invalid content is rejected.
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).last().click();
  await expect(page.getByText("Please upload this document")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
  await expect(page.getByRole("alert").filter({ hasText: /Unsupported file type/ })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("Uploaded · under review soon")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).last().click();

  // Review & submit
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByText("A1234567")).toBeVisible();
  await expect(page.getByText("passport.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Please confirm")).toBeVisible();
  await page.getByLabel(/I confirm/).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Application submitted.")).toBeVisible();
  await expect(page.getByText("Application submitted", { exact: true }).first()).toBeVisible(); // status badge
  await expect(page.getByRole("link", { name: "Continue application" })).toHaveCount(0);
  await context.close();
});

test("a client cannot open another client's application or document", async ({ browser, baseURL }) => {
  const a = await newClient(browser, baseURL, "Client Alpha");
  await a.page.getByRole("button", { name: "Begin application" }).click();
  await expect(a.page).toHaveURL(/\/client\/applications\/[^/]+\/apply/);
  const appUrl = a.page.url().replace(/\/apply.*/, "");
  const appId = appUrl.split("/").pop()!;
  await fillDetails(a.page);
  await a.page.getByRole("button", { name: /Save & continue/ }).click();
  await a.page.goto(`/client/applications/${appId}/apply?step=documents`);
  await a.page.locator('input[type="file"]').setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(a.page.getByText("Uploaded · under review soon")).toBeVisible();
  const docHref = await a.page.getByRole("link", { name: "passport.pdf" }).getAttribute("href");

  // Owner can download.
  const own = await a.page.request.get(docHref!);
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toContain("no-store");
  expect(own.headers()["content-disposition"]).toContain("attachment");

  const b = await newClient(browser, baseURL, "Client Bravo");
  const r1 = await b.page.goto(`/client/applications/${appId}`);
  expect(r1?.status()).toBe(404);
  const r2 = await b.page.goto(`/client/applications/${appId}/apply`);
  expect(r2?.status()).toBe(404);
  const r3 = await b.page.request.get(docHref!);
  expect(r3.status()).toBe(404);
  const r4 = await b.page.request.post(`/api/applications/${appId}/documents`, { multipart: { requirementKey: "international_passport", file: { name: "x.pdf", mimeType: "application/pdf", buffer: PDF } } });
  expect(r4.status()).toBe(404);

  // Anonymous access is refused.
  const anon = await browser.newContext({ baseURL });
  expect((await anon.request.get(docHref!)).status()).toBe(401);
  await Promise.all([a.context.close(), b.context.close(), anon.close()]);
});
