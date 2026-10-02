import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Transport-agnostic email sender. Swap implementations without touching callers. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class ResendProvider implements EmailProvider {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) {
    this.client = new Resend(apiKey);
  }
  async send(m: EmailMessage) {
    const { error } = await this.client.emails.send({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    if (error) throw new Error(`Resend rejected the email: ${error.message}`);
  }
}

/** Local development / e2e: write each email to a JSON file instead of sending it. */
class FileOutboxProvider implements EmailProvider {
  constructor(private readonly dir: string) {}
  async send(m: EmailMessage) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(m, null, 2));
  }
}

class UnconfiguredProvider implements EmailProvider {
  async send(): Promise<void> {
    throw new Error("Email is not configured (set RESEND_API_KEY and EMAIL_FROM).");
  }
}

let instance: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (instance) return instance;
  const key = process.env.RESEND_API_KEY;
  if (key) return (instance = new ResendProvider(key, process.env.EMAIL_FROM ?? "Vinamaz Travels <onboarding@resend.dev>"));
  if (process.env.EMAIL_OUTBOX_DIR) return (instance = new FileOutboxProvider(path.resolve(process.env.EMAIL_OUTBOX_DIR)));
  if (process.env.NODE_ENV !== "production") return (instance = new FileOutboxProvider(path.resolve(".data/outbox")));
  return (instance = new UnconfiguredProvider());
}

/** Test seam. */
export function setEmailProviderForTests(provider: EmailProvider | undefined) {
  instance = provider;
}

/**
 * Send an email without ever throwing into the caller: a mail failure must not roll back or
 * fail the business operation that triggered it. Failures are logged (no message bodies).
 */
export async function sendEmailSafely(message: EmailMessage): Promise<boolean> {
  try {
    await getEmailProvider().send(message);
    return true;
  } catch (error) {
    console.error(`[email] failed to send "${message.subject}":`, error instanceof Error ? error.message : error);
    return false;
  }
}
