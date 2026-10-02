import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));

import { put } from "@vercel/blob";
import { storePackageImage } from "@/lib/storage/package-images";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const file = (bytes: Buffer, type = "image/png") => new File([new Uint8Array(bytes)], "x.png", { type });

beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = "test-token"; vi.mocked(put).mockReset(); });
afterEach(() => { delete process.env.BLOB_READ_WRITE_TOKEN; });

describe("storePackageImage", () => {
  it("stores valid images publicly and returns the blob url", async () => {
    vi.mocked(put).mockResolvedValue({ url: "https://abc.public.blob.vercel-storage.com/package-images/x.png" } as never);
    expect(await storePackageImage(file(PNG))).toContain("public.blob.vercel-storage.com");
    expect(vi.mocked(put).mock.calls[0]![2]).toMatchObject({ access: "public" });
  });
  it("surfaces the real storage failure instead of a generic error", async () => {
    vi.mocked(put).mockRejectedValue(new Error("Vercel Blob: Cannot use public access on a private store"));
    await expect(storePackageImage(file(PNG))).rejects.toThrow(/Cannot use public access on a private store/);
  });
  it("rejects spoofed, oversized and unsupported images before touching storage", async () => {
    await expect(storePackageImage(file(Buffer.from("not an image")))).rejects.toThrow(/valid image/);
    await expect(storePackageImage(file(Buffer.alloc(5 * 1024 * 1024), "image/png"))).rejects.toThrow(/4MB/);
    await expect(storePackageImage(file(PNG, "application/pdf"))).rejects.toThrow(/JPG, PNG or WebP/);
    expect(put).not.toHaveBeenCalled();
  });
});
