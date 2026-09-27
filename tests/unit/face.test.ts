import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrollFace, verifyFace } from "../../src/modules/face/service";
import { encrypt, decrypt } from "../../src/lib/crypto";

const sample = "data:image/jpeg;base64,dGVzdA==";
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("FACE_PROVIDER_URL", "https://face.example");
  vi.stubEnv("FACE_PROVIDER_KEY", "test-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function respond(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => Response.json({
    requestId: JSON.parse(init.body).requestId,
    template: "protected-template", confidence: 0.99, livenessPassed: true, status: "SUCCESS", ...overrides,
  })));
}
describe("face provider boundary", () => {
  it("encrypts templates and never persists the camera sample", async () => {
    respond();
    const result = await enrollFace(sample);
    expect(result).not.toContain("protected-template");
    expect(decrypt(result)).toEqual({ template: "protected-template" });
  });
  it.each([
    { status: "FAILED" }, { status: "SUSPICIOUS" }, { status: "REVIEW_REQUIRED" },
    { livenessPassed: false }, { confidence: 0.2 },
  ])("rejects an unacceptable match: %j", async (result) => {
    respond(result);
    await expect(verifyFace(encrypt({ template: "x" }), sample, 0.8, true)).rejects.toMatchObject({ status: 403 });
  });
  it.each([{ requestId: "replayed-result" }, { confidence: 2 }, { livenessPassed: "true" }])("rejects invalid provider output: %j", async (result) => {
    respond(result);
    await expect(enrollFace(sample)).rejects.toMatchObject({ status: 503 });
  });
  it("fails closed when the provider is absent", async () => {
    vi.stubEnv("FACE_PROVIDER_KEY", "");
    await expect(enrollFace(sample)).rejects.toMatchObject({ status: 503 });
  });
});
