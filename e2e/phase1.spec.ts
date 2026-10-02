import { expect, test } from "@playwright/test";

const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin.e2e@example.com", password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123" };
// Each run uses its own client IP so the (per-IP) registration rate limiter does not interfere.
test.use({ extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
const unique = () => `e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;

test("public site: honest homepage, draft packages are hidden", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("right visa support");
  await expect(page.getByText(/guarantee/i).first()).toBeVisible(); // honest disclaimer present
  await expect(page.getByText(/100%/)).toHaveCount(0);
  await page.getByRole("link", { name: "Track my application" }).first().click();
  await expect(page).toHaveURL(/\/login\?next=\/client\/applications/);
  const res = await page.goto("/packages/china"); // seeded as DRAFT
  expect(res?.status()).toBe(404);
});

test("anonymous users are redirected away from portals", async ({ page }) => {
  await page.goto("/client/dashboard");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto("/admin/packages");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("client can register, sees only the client portal, and can sign out", async ({ page }) => {
  const id = unique();
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Ada Tester");
  await page.getByLabel("Email address").fill(`${id}@example.com`);
  await page.getByLabel("Phone number").fill("+2348030000000");
  await page.getByLabel("Password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/client\/dashboard/);
  await expect(page.getByRole("heading", { name: "Hello, Ada" })).toBeVisible();

  await page.goto("/admin/packages"); // clients cannot enter the staff portal
  await expect(page).toHaveURL(/\/client\/dashboard/);

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL("/");
});

test("registration rejects a duplicate email", async ({ browser, baseURL }) => {
  const email = `${unique()}@example.com`;
  const fill = async (page: import("@playwright/test").Page) => {
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Dup Tester");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Phone number").fill("+2348030000000");
    await page.getByLabel("Password").fill("a-long-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
  };
  const headers = { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.1.1` };
  const first = await browser.newContext({ baseURL, extraHTTPHeaders: headers });
  const p1 = await first.newPage();
  await fill(p1);
  await expect(p1.getByRole("heading", { name: "Hello, Dup" })).toBeVisible();
  const second = await browser.newContext({ baseURL, extraHTTPHeaders: headers });
  const p2 = await second.newPage();
  await fill(p2);
  await expect(p2.getByRole("alert").first()).toContainText(/already exists/i);
  await first.close();
  await second.close();
});

test("admin creates an active package, it appears publicly, then is deactivated", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/packages/);

  const name = `E2E Test Package ${unique()}`;
  await page.getByRole("link", { name: "New package" }).click();
  await page.getByLabel("Package name").fill(name);
  await page.getByLabel("Destination country").fill("Testland");
  await page.getByLabel("Short description").fill("A package created by the end-to-end test.");
  await page.getByLabel("What's included").fill("Document checklist\nApplication review");
  await page.getByLabel("Status").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Create package" }).click();
  await expect(page.getByText("Package saved.")).toBeVisible();

  await page.goto("/packages");
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.locator("article", { hasText: name }).getByRole("link", { name: "View details" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByText("Document checklist")).toBeVisible();
  await expect(page.getByText(/Package price/)).toHaveCount(0); // no price configured => not shown

  await page.goto("/admin/packages");
  await page.getByText(name, { exact: true }).locator("xpath=ancestor::div[contains(@class,'p-5')][1]").getByRole("button", { name: "Deactivate" }).click();
  await page.waitForTimeout(800);
  await page.goto("/packages");
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
});
