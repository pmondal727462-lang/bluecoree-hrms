import { afterEach, describe, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import {
  putFile,
  readFileBytes,
  deleteFile,
  signedUrl,
  redeemSignedUrl,
  storageDriver,
} from "../../src/lib/storage";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Private cloud files", () => {
  it("stores privately and redeems only valid signed downloads", async () => {
    vi.stubEnv("STORAGE_ENDPOINT", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    vi.stubEnv("JWT_SECRET", "test-signing-secret");
    blob.put.mockResolvedValue({});
    blob.get.mockImplementation(async () => ({
      statusCode: 200,
      stream: new Response("employee letter").body,
    }));
    const result = await putFile(
      "company1",
      Buffer.from("employee letter"),
      "text/plain",
    );
    expect(storageDriver()).toBe("blob");
    expect(blob.put).toHaveBeenCalledWith(result.key, expect.any(Buffer), {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/plain",
    });
    const url = await signedUrl(result.key, {
      fileName: "letter.txt",
      contentType: "text/plain",
    });
    expect(url).toMatch(/^\/api\/files\//);
    const token = url.slice("/api/files/".length);
    expect((await redeemSignedUrl(token)).bytes.toString()).toBe(
      "employee letter",
    );
    blob.get.mockClear();
    await expect(redeemSignedUrl(token + "tampered")).rejects.toThrow(
      "File not found",
    );
    expect(blob.get).not.toHaveBeenCalled();
    await deleteFile(result.key);
    expect(blob.del).toHaveBeenCalledWith(result.key);
  });
  it("reports missing blobs and refuses Vercel local-disk uploads", async () => {
    vi.stubEnv("STORAGE_ENDPOINT", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test");
    blob.get.mockResolvedValue(null);
    await expect(readFileBytes("company1/missing")).rejects.toThrow(
      "File not found",
    );
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL", "1");
    await expect(
      putFile("company1", Buffer.from("test"), "text/plain"),
    ).rejects.toThrow("Private file storage is not configured");
  });
});
