import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	comprefaceConfigured,
	comprefaceEnroll,
	comprefaceVerify,
} from "@/modules/face/compreface";

const sample = "data:image/jpeg;base64,YWJj";
const embedding = Array(128).fill(0.1);
let faces = 1;
let live = true;
let similarity = 0.95;
const request = vi.fn(async (url: URL, init: RequestInit) => {
	const body = JSON.parse(String(init.body));
	if (url.host === "live.example.com")
		return Response.json({ requestId: body.requestId, livenessPassed: live });
	if (url.pathname.endsWith("/detect"))
		return Response.json({
			result: Array.from({ length: faces }, () => ({
				embedding,
				box: { probability: 0.99 },
			})),
			plugins_versions: { calculator: "test-model" },
		});
	return Response.json({ result: [{ similarity }] });
});
beforeEach(() => {
	faces = 1;
	live = true;
	similarity = 0.95;
	request.mockClear();
	vi.stubGlobal("fetch", request);
	for (const [key, value] of Object.entries({
		COMPREFACE_URL: "https://face.example.com",
		COMPREFACE_DETECTION_KEY: "detection",
		COMPREFACE_VERIFICATION_KEY: "verification",
		FACE_LIVENESS_URL: "https://live.example.com",
		FACE_LIVENESS_KEY: "live",
	}))
		vi.stubEnv(key, value);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
describe("CompreFace adapter", () => {
	it("extracts a template and compares embeddings using separate service keys", async () => {
		const template = await comprefaceEnroll(sample);
		expect(template).not.toContain(sample);
		expect(await comprefaceVerify(template, sample)).toMatchObject({
			confidence: 0.95,
			livenessPassed: true,
		});
		const detection = request.mock.calls[1];
		expect(detection[1].headers).toMatchObject({ "x-api-key": "detection" });
		expect(JSON.parse(String(detection[1].body))).toEqual({ file: "YWJj" });
		const verification = request.mock.calls[4];
		expect(verification[0].pathname).toBe(
			"/api/v1/verification/embeddings/verify",
		);
		expect(verification[1].headers).toMatchObject({
			"x-api-key": "verification",
		});
		expect(JSON.parse(String(verification[1].body))).toEqual({
			source: embedding,
			targets: [embedding],
		});
	});
	it.each([0, 2])("rejects %s faces", async (count) => {
		faces = count;
		await expect(comprefaceEnroll(sample)).rejects.toThrow("exactly one");
	});
	it("does not equate face detection with liveness", async () => {
		live = false;
		await expect(comprefaceEnroll(sample)).rejects.toThrow("Liveness");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("requires a liveness service", async () => {
		vi.stubEnv("FACE_LIVENESS_KEY", "");
		expect(comprefaceConfigured()).toBe(false);
		await expect(comprefaceEnroll(sample)).rejects.toThrow(
			"must be configured",
		);
		expect(request).not.toHaveBeenCalled();
	});
	it("rejects unencrypted transport", async () => {
		vi.stubEnv("FACE_LIVENESS_URL", "http://live.example.com");
		await expect(comprefaceEnroll(sample)).rejects.toThrow("unavailable");
		expect(request).not.toHaveBeenCalled();
	});
	it("rejects invalid similarity", async () => {
		const template = await comprefaceEnroll(sample);
		similarity = 2;
		await expect(comprefaceVerify(template, sample)).rejects.toThrow();
	});
});
