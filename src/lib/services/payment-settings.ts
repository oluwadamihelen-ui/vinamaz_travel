import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { GATEWAY_METHODS, getGateway } from "@/lib/payments/registry";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { recordAudit } from "./audit";

const NAME = /^[\p{L}\p{N} .,&'()\/-]{2,120}$/u;

/** Which methods are configured (secrets present) and switched on. Never returns the secrets themselves. */
export async function getPaymentSettings(actor: Actor) {
  requirePermission(actor, "settings.manage");
  const [methods, banks] = await Promise.all([db.paymentMethodSetting.findMany(), db.bankAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })]);
  const enabled = new Map(methods.map((m) => [m.method, m.enabled]));
  const custom = new Map(methods.map((m) => [m.method, m.currencies]));
  return {
    gateways: GATEWAY_METHODS.map((m) => ({ method: m as PaymentMethod, label: getGateway(m)!.label, configured: getGateway(m)!.isConfigured(), enabled: enabled.get(m) ?? true, currencies: custom.get(m) ?? [], defaultCurrencies: getGateway(m)!.defaultCurrencies() })),
    bankTransferEnabled: enabled.get("BANK_TRANSFER") ?? true,
    banks,
  };
}

export async function setMethodEnabled(actor: Actor, method: PaymentMethod, enabled: boolean) {
  requirePermission(actor, "settings.manage");
  await db.paymentMethodSetting.upsert({ where: { method }, create: { method, enabled }, update: { enabled } });
  await recordAudit({ actorId: actor.id, action: "settings.payment_method_changed", entityType: "PaymentMethodSetting", entityId: method, metadata: { enabled } });
}

/** Currencies a gateway may be offered for. Empty list = the built-in defaults. */
export async function setMethodCurrencies(actor: Actor, method: PaymentMethod, raw: string) {
  requirePermission(actor, "settings.manage");
  if (method === "BANK_TRANSFER") throw new AppError("Bank transfer currencies come from the bank accounts you add.", "VALIDATION");
  const list = [...new Set(raw.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (list.some((c) => !/^[A-Z]{3}$/.test(c)) || list.length > 20) throw new AppError("Use 3-letter currency codes separated by commas, e.g. NGN, USD.", "VALIDATION", { currencies: ["Invalid currency list"] });
  await db.paymentMethodSetting.upsert({ where: { method }, create: { method, currencies: list }, update: { currencies: list } });
  await recordAudit({ actorId: actor.id, action: "settings.payment_currencies_changed", entityType: "PaymentMethodSetting", entityId: method, metadata: { currencies: list } });
}

export interface BankAccountInput { bankName: string; accountName: string; accountNumber: string; currency: string; instructions?: string; isActive: boolean }

function validateBank(i: BankAccountInput) {
  const errors: Record<string, string[]> = {};
  if (!NAME.test(i.bankName.trim())) errors.bankName = ["Enter the bank name"];
  if (!NAME.test(i.accountName.trim())) errors.accountName = ["Enter the account name"];
  if (!/^[0-9]{6,20}$/.test(i.accountNumber.trim().replace(/\s+/g, ""))) errors.accountNumber = ["Enter the account number (digits only)"];
  if (!/^[A-Za-z]{3}$/.test(i.currency.trim())) errors.currency = ["Use a 3-letter currency code"];
  if ((i.instructions ?? "").length > 500) errors.instructions = ["Too long (maximum 500 characters)"];
  if (Object.keys(errors).length) throw new AppError("Please fix the highlighted fields.", "VALIDATION", errors);
  return { bankName: i.bankName.trim(), accountName: i.accountName.trim(), accountNumber: i.accountNumber.trim().replace(/\s+/g, ""), currency: i.currency.trim().toUpperCase(), instructions: i.instructions?.trim() || null, isActive: i.isActive };
}

export async function saveBankAccount(actor: Actor, id: string | null, input: BankAccountInput) {
  requirePermission(actor, "settings.manage");
  const data = validateBank(input);
  const row = id ? await db.bankAccount.update({ where: { id }, data }) : await db.bankAccount.create({ data });
  // Bank details are what clients send money to: every change is audited.
  await recordAudit({ actorId: actor.id, action: id ? "settings.bank_account_updated" : "settings.bank_account_created", entityType: "BankAccount", entityId: row.id, metadata: { bankName: data.bankName, accountNumberLast4: data.accountNumber.slice(-4), currency: data.currency, isActive: data.isActive } });
  return row;
}

export async function deleteBankAccount(actor: Actor, id: string) {
  requirePermission(actor, "settings.manage");
  await db.bankAccount.delete({ where: { id } });
  await recordAudit({ actorId: actor.id, action: "settings.bank_account_deleted", entityType: "BankAccount", entityId: id });
}
