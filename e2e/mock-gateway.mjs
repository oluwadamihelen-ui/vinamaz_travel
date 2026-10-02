// A stand-in for Paystack used only by the end-to-end tests: hosted checkout page + initialize/verify API +
// a signed webhook sent to the app after "payment". Run: node e2e/mock-gateway.mjs
import { createHmac } from "node:crypto";
import http from "node:http";

const PORT = 4010;
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? "sk_test_e2e";
const txs = new Map();
let nextId = 1000; // real gateways give every transaction a unique id; webhook de-duplication relies on it

const send = (res, status, body, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && url.pathname === "/transaction/initialize") {
    let raw = ""; for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    if (req.headers.authorization !== `Bearer ${SECRET}`) return send(res, 401, { status: false, message: "Invalid key" });
    txs.set(b.reference, { id: nextId++, amount: b.amount, currency: b.currency, callback: b.callback_url, paid: false });
    return send(res, 200, { status: true, data: { authorization_url: `http://127.0.0.1:${PORT}/checkout/${encodeURIComponent(b.reference)}`, access_code: "ac", reference: b.reference } });
  }
  let m = /^\/transaction\/verify\/(.+)$/.exec(url.pathname);
  if (m) {
    const ref = decodeURIComponent(m[1]); const t = txs.get(ref);
    if (!t) return send(res, 404, { status: false, message: "Transaction reference not found" });
    return send(res, 200, { status: true, data: { status: t.paid ? "success" : "abandoned", reference: ref, amount: t.amount, currency: t.currency, id: t.id } });
  }
  m = /^\/checkout\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const ref = decodeURIComponent(m[1]);
    return send(res, 200, `<!doctype html><title>Mock Paystack</title><h1>Mock Paystack checkout</h1><p>${ref}</p><a id="pay" href="/checkout/${encodeURIComponent(ref)}/pay">Pay now</a> <a id="cancel" href="${txs.get(ref)?.callback ?? "/"}">Cancel</a>`, "text/html");
  }
  m = /^\/checkout\/([^/]+)\/pay$/.exec(url.pathname);
  if (m) {
    const ref = decodeURIComponent(m[1]); const t = txs.get(ref);
    if (!t) return send(res, 404, "unknown");
    t.paid = true;
    // The real gateway notifies the merchant's server directly, racing the customer's redirect.
    setTimeout(async () => {
      const body = JSON.stringify({ event: "charge.success", data: { id: t.id, reference: ref, amount: t.amount, currency: t.currency, status: "success" } });
      const origin = new URL(t.callback).origin;
      try { await fetch(`${origin}/api/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", SECRET).update(body).digest("hex") }, body }); } catch { /* app may be down */ }
    }, 300);
    res.writeHead(302, { location: `${t.callback}&trxref=${encodeURIComponent(ref)}&reference=${encodeURIComponent(ref)}&status=success` });
    return res.end();
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock gateway on ${PORT}`));
