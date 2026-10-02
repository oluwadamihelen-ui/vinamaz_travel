import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startApplication } from "@/lib/services/applications";
import { openDocument, uploadDocument } from "@/lib/services/documents";
import { getPrivateStorage } from "@/lib/storage/private-documents";
import { PDF, PNG, makeActivePackage, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function setup() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const pkg = await makeActivePackage(admin);
  const client = await makeUser("CLIENT", "ada@x.com");
  const { id } = await startApplication(client, pkg.slug);
  return { admin, client, id };
}
const up = (client: Awaited<ReturnType<typeof makeUser>>, applicationId: string, over: Record<string, unknown> = {}) =>
  uploadDocument(client, { applicationId, requirementKey: "international_passport", filename: "passport.pdf", bytes: PDF, ...over });

async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  return Buffer.concat(chunks);
}

describe("uploadDocument validation", () => {
  it("stores a valid file privately and records it", async () => {
    const { client, id } = await setup();
    const doc = await up(client, id);
    expect(doc).toMatchObject({ status: "UPLOADED", isCurrent: true, mimeType: "application/pdf", uploadedById: client.id });
    expect(doc.storageKey).toMatch(/^applications\/[a-z0-9]+\/[0-9a-f-]{36}\.pdf$/);
    const obj = await getPrivateStorage().get(doc.storageKey);
    expect((await readAll(obj!.stream)).equals(PDF)).toBe(true);
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id } })).progressPercent).toBeGreaterThan(0);
  });
  it("rejects spoofed content, empty files, oversize files and unknown requirement keys", async () => {
    const { client, id } = await setup();
    await expect(up(client, id, { bytes: Buffer.from("MZ not a pdf"), filename: "passport.pdf" })).rejects.toThrow(/Unsupported file type/);
    await expect(up(client, id, { bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/);
    await expect(up(client, id, { bytes: Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]) })).rejects.toThrow(/too large/);
    await expect(up(client, id, { requirementKey: "../../etc/passwd" })).rejects.toThrow(/not part of this application/);
    expect(await db.applicationDocument.count()).toBe(0);
  });
  it("sanitises the stored filename", async () => {
    const { client, id } = await setup();
    const doc = await up(client, id, { filename: "../../Evil <script>name.exe" });
    expect(doc.originalFilename).toBe("Evil scriptname.pdf");
    expect(doc.storageKey).not.toContain("Evil");
  });
  it("honours per-requirement accepted formats", async () => {
    const { client, id } = await setup();
    // passport requirement accepts pdf/jpg/png by default; PNG should pass
    expect((await up(client, id, { bytes: PNG, filename: "p.png" })).mimeType).toBe("image/png");
  });
});

describe("replacement keeps history", () => {
  it("keeps exactly one current document and chains replacements", async () => {
    const { client, id } = await setup();
    const first = await up(client, id);
    const second = await up(client, id, { bytes: PNG, filename: "better.png" });
    const rows = await db.applicationDocument.findMany({ where: { applicationId: id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, isCurrent: false });
    expect(rows[1]).toMatchObject({ id: second.id, isCurrent: true, replacesId: first.id });
    // the old private file is still retrievable for audit purposes
    expect(await getPrivateStorage().get(first.storageKey)).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "document.replaced" } })).toBe(1);
  });
  it("a rejected document can be replaced, an approved one cannot", async () => {
    const { client, id } = await setup();
    const doc = await up(client, id);
    await db.applicationDocument.update({ where: { id: doc.id }, data: { status: "REPLACEMENT_REQUIRED", rejectionReason: "Blurry" } });
    const replacement = await up(client, id);
    expect(replacement.status).toBe("UPLOADED");
    await db.applicationDocument.update({ where: { id: replacement.id }, data: { status: "APPROVED" } });
    await expect(up(client, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("concurrent uploads leave a single current document", async () => {
    const { client, id } = await setup();
    await up(client, id);
    await Promise.allSettled([up(client, id), up(client, id), up(client, id)]);
    expect(await db.applicationDocument.count({ where: { applicationId: id, isCurrent: true } })).toBe(1);
  });
  it("no uploads once the application is in a locked status", async () => {
    const { client, id } = await setup();
    await db.visaApplication.update({ where: { id }, data: { status: "PROCESSING" } });
    await expect(up(client, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.visaApplication.update({ where: { id }, data: { status: "DOCUMENTS_REQUIRED" } });
    expect((await up(client, id)).status).toBe("UPLOADED");
  });
});

describe("openDocument authorization", () => {
  it("owner can open; staff need documents.view; downloads by staff are audited", async () => {
    const { client, id } = await setup();
    const doc = await up(client, id);
    expect((await openDocument(client, doc.id)).doc.id).toBe(doc.id);
    const nobody = await makeUser("STAFF", "s@x.com");
    await expect(openDocument(nobody, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reviewer = await makeUser("STAFF", "r@x.com", ["documents.view"]);
    expect((await openDocument(reviewer, doc.id)).object.size).toBe(PDF.length);
    expect(await db.auditLog.count({ where: { action: "document.downloaded", actorId: reviewer.id } })).toBe(1);
    await expect(openDocument(null, doc.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
