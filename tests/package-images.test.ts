import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { storePackageImage } from "@/lib/storage/package-images";
import { GET } from "@/app/api/package-images/[name]/route";
import { getPrivateStorage, setPrivateStorageForTests } from "@/lib/storage/private-documents";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const file = (bytes: Buffer, type = "image/png") => new File([new Uint8Array(bytes)], "x.png", { type });
const get = (name: string) => GET(new Request("http://x"), { params: Promise.resolve({ name }) });

beforeEach(() => setPrivateStorageForTests(undefined));

describe("package images (single private store)", () => {
  it("stores an image and serves it publicly from the package-images route only", async () => {
    const url = await storePackageImage(file(PNG));
    expect(url).toMatch(/^\/api\/package-images\/[0-9a-f-]{36}\.png$/);
    const res = await get(url.split("/").pop()!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
  it("cannot be used to read applicant documents or traverse paths", async () => {
    // A real document key exists in storage...
    const id = randomUUID();
    const key = `applications/ckabc123/${id}.pdf`;
    await getPrivateStorage().put(key, Buffer.from("%PDF-1.4 secret"), "application/pdf");
    for (const name of [
      `${id}.pdf`,
      `../applications/ckabc123/${id}.pdf`,
      "..%2Fapplications%2Fx.pdf", "not-a-uuid.png", "",
    ]) {
      expect((await get(name)).status).toBe(404);
    }
  });
  it("rejects spoofed, oversized and unsupported images", async () => {
    await expect(storePackageImage(file(Buffer.from("not an image")))).rejects.toThrow(/valid image/);
    await expect(storePackageImage(file(Buffer.alloc(5 * 1024 * 1024), "image/png"))).rejects.toThrow(/4MB/);
    await expect(storePackageImage(file(PNG, "application/pdf"))).rejects.toThrow(/JPG, PNG or WebP/);
  });
  it("surfaces storage failures with the real reason", async () => {
    setPrivateStorageForTests({
      put: async () => { throw new Error("Vercel Blob: boom"); },
      mode: "local", inspect: async () => null, get: async () => null, delete: async () => undefined,
    });
    await expect(storePackageImage(file(PNG))).rejects.toThrow(/boom/);
  });
});
