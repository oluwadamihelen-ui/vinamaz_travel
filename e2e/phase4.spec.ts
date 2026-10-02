import { expect, test, type Browser, type Page } from "@playwright/test";

const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin.e2e@example.com", password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const uid = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function ctx(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  return { context, page: await context.newPage() };
}

/** Register, apply to the paid package and submit. Ends on the payment page. */
async function submitPaidApplication(page: Page) {
  await page.goto("/register?next=/apply/e2e-paid");
  await page.getByLabel("Full name").fill("Pay Tester");
  await page.getByLabel("Email address").fill(`pay${uid()}@example.com`);
  await page.getByLabel("Phone number").fill("+2348030000000");
  await page.getByLabel("Password", { exact: true }).fill("a-long-password-123");
  await page.getByLabel("Confirm password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Begin application" }).click();
  await expect(page).toHaveURL(/\/client\/applications\/[^/]+\/apply/);
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
  await expect(page).toHaveURL(/\/client\/payments\/[^/]+\?submitted=1/);
}

async function signInAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("online payment: server-computed amount, hosted checkout, verified confirmation, receipt", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const client = await ctx(browser, baseURL);
  await submitPaidApplication(client.page);
  const page = client.page;

  // The amount is computed on the server from the package fees.
  await expect(page.getByText("Application submitted.")).toBeVisible();
  await expect(page.getByText(/155,000/).first()).toBeVisible();
  await expect(page.getByText("Package price")).toBeVisible();
  await expect(page.getByText("Service fee")).toBeVisible();
  await expect(page.getByText("Awaiting payment").first()).toBeVisible();
  const paymentUrl = page.url().split("?")[0]!;

  // Pay through the (mock) hosted checkout; we come back to our return page.
  await page.getByRole("button", { name: /with Paystack/ }).click();
  await expect(page.getByRole("heading", { name: "Mock Paystack checkout" })).toBeVisible();
  await page.getByRole("link", { name: "Pay now" }).click();
  await expect(page.getByRole("heading", { name: "Payment successful" })).toBeVisible({ timeout: 20_000 });

  // Receipt (PDF) is available to the owner.
  const paymentId = paymentUrl.split("/").pop()!;
  const receipt = await page.request.get(`/api/payments/${paymentId}/receipt`);
  expect(receipt.status()).toBe(200);
  expect(receipt.headers()["content-type"]).toBe("application/pdf");
  expect((await receipt.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Application advanced; payment history shows it; paying again is not possible.
  await page.goto("/client/payments");
  await expect(page.getByText("Paid").first()).toBeVisible();
  await page.goto(paymentUrl);
  await expect(page.getByText("Payment received")).toBeVisible();
  await expect(page.getByRole("button", { name: /with Paystack/ })).toHaveCount(0);

  // Staff see it as paid, and the application is at "Payment confirmed".
  const admin = await ctx(browser, baseURL);
  await signInAdmin(admin.page);
  await admin.page.goto(`/admin/payments/${paymentId}`);
  await expect(admin.page.getByText("Paid").first()).toBeVisible();
  await expect(admin.page.getByText("webhook success").first()).toBeVisible(); // the signed webhook was received and recorded
  await admin.page.getByRole("link", { name: /VNZ-\d{4}-\d{6}/ }).first().click();
  await expect(admin.page.getByText("Payment confirmed").first()).toBeVisible();
  await Promise.all([client.context.close(), admin.context.close()]);
});

test("returning from a gateway with a 'success' flag proves nothing; other clients can't see the payment", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const a = await ctx(browser, baseURL);
  await submitPaidApplication(a.page);
  const paymentId = a.page.url().split("?")[0]!.split("/").pop()!;
  const reference = (await a.page.getByText(/VNZ-PAY-/).first().textContent())!.match(/VNZ-PAY-[0-9A-Z]{10}/)![0];

  // A user (or attacker) crafts the return URL with success flags without ever paying.
  await a.page.goto(`/client/payments/return?payment=${reference}&status=success&trxref=${reference}&reference=${reference}`);
  await expect(a.page.getByRole("heading", { name: "Payment successful" })).toHaveCount(0);
  await expect(a.page.getByRole("heading", { name: /Confirming your payment|Payment not completed/ })).toBeVisible();
  await a.page.goto(`/client/payments/${paymentId}`);
  await expect(a.page.getByText("Awaiting payment").first()).toBeVisible();

  // Another client cannot open it, check it or fetch its receipt.
  const b = await ctx(browser, baseURL);
  await submitPaidApplication(b.page);
  expect((await b.page.goto(`/client/payments/${paymentId}`))?.status()).toBe(404);
  await b.page.goto(`/client/payments/return?payment=${reference}`);
  await expect(b.page.getByText("We couldn’t find that payment.")).toBeVisible();
  expect((await b.page.request.get(`/api/payments/${paymentId}/receipt`)).status()).toBe(404);
  expect((await b.page.request.get(`/api/payments/${paymentId}/proof`)).status()).toBe(404);
  await Promise.all([a.context.close(), b.context.close()]);
});

test("webhooks reject bad signatures", async ({ request }) => {
  const res = await request.post("/api/webhooks/paystack", { data: { event: "charge.success", data: { reference: "VNZ-PAY-X-1" } }, headers: { "x-paystack-signature": "deadbeef" } });
  expect(res.status()).toBe(401);
  expect((await request.post("/api/webhooks/unknown", { data: {} })).status()).toBe(404);
});

test("bank transfer: admin adds an account, client uploads proof, staff confirm, partial refund", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await ctx(browser, baseURL);
  await signInAdmin(admin.page);
  await admin.page.goto("/admin/settings");
  const accountNumber = `0${Date.now()}`.slice(0, 10);
  const add = admin.page.locator("div.border-dashed");
  await add.getByLabel("Bank name").fill("Test Bank Plc");
  await add.getByLabel("Account name").fill("Vinamaz Travels Ltd");
  await add.getByLabel("Account number").fill(accountNumber);
  await add.getByRole("button", { name: "Add bank account" }).click();
  await expect(admin.page.getByText("Saved.").first()).toBeVisible();

  const client = await ctx(browser, baseURL);
  await submitPaidApplication(client.page);
  const page = client.page;
  const paymentId = page.url().split("?")[0]!.split("/").pop()!;
  await page.getByRole("button", { name: /Bank transfer/ }).click();
  await expect(page.getByText("Pay by bank transfer")).toBeVisible();
  await expect(page.getByText(accountNumber).first()).toBeVisible();

  // Validation: a non-receipt file is refused.
  await page.getByLabel("Name on the account you paid from").fill("Pay Tester");
  await page.getByLabel(/Transfer receipt/).setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
  await page.getByLabel(/Transfer receipt/).setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  await expect(page.getByText("Receipt submitted.")).toBeVisible();
  await expect(page.getByText("Awaiting confirmation").first()).toBeVisible();

  // Staff review and confirm.
  await admin.page.goto(`/admin/payments/${paymentId}`);
  await expect(admin.page.getByText("Transfer proof")).toBeVisible();
  await expect(admin.page.getByRole("link", { name: "receipt.pdf" })).toBeVisible();
  expect((await admin.page.request.get(`/api/payments/${paymentId}/proof`)).status()).toBe(200);
  await admin.page.getByRole("button", { name: "Confirm payment received" }).click();
  await expect(admin.page.getByRole("button", { name: "Confirm payment received" })).toHaveCount(0); // payment is now settled
  await expect(admin.page.getByText("Paid").first()).toBeVisible();

  await page.reload();
  await expect(page.getByText("Payment received")).toBeVisible();
  expect((await page.request.get(`/api/payments/${paymentId}/receipt`)).status()).toBe(200);

  // Super admin records a partial refund.
  await admin.page.reload();
  await admin.page.getByLabel(/^Amount/).fill("5000");
  await admin.page.getByLabel("Reason").fill("Goodwill refund of service fee");
  await admin.page.getByRole("button", { name: "Record refund" }).click();
  await expect(admin.page.getByText("Refund recorded.")).toBeVisible();
  await admin.page.reload();
  await expect(admin.page.getByText("Partially refunded").first()).toBeVisible();
  await Promise.all([client.context.close(), admin.context.close()]);
});
