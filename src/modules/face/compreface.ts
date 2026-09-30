import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const vector = z.array(z.number().finite()).min(128).max(2048);
const templateSchema = z.object({
	provider: z.literal("compreface"),
	version: z.literal(1),
	model: z.string().min(1),
	embedding: vector,
});
const score = z.number().finite().min(0).max(1);
export function comprefaceConfigured() {
	return !!(
		process.env.COMPREFACE_URL &&
		process.env.COMPREFACE_DETECTION_KEY &&
		process.env.COMPREFACE_VERIFICATION_KEY &&
		process.env.FACE_LIVENESS_URL &&
		process.env.FACE_LIVENESS_KEY
	);
}
async function post(
	base: string | undefined,
	path: string,
	key: string | undefined,
	body: unknown,
	liveness = false,
) {
	try {
		if (!base || !key) throw new Error("Missing configuration");
		const url = new URL(`${base.replace(/\/$/, "")}${path}`);
		if (url.protocol !== "https:") throw new Error("HTTPS required");
		const response = await fetch(url, {
			method: "POST",
			redirect: "error",
			cache: "no-store",
			headers: {
				"content-type": "application/json",
				...(liveness
					? { authorization: `Bearer ${key}` }
					: { "x-api-key": key }),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) throw new Error("Service unavailable");
		return await response.json();
	} catch {
		throw new AppError(
			503,
			"Face verification service is unavailable or not configured.",
			"FACE_PROVIDER_UNAVAILABLE",
		);
	}
}
async function capture(sample: string) {
	if (!comprefaceConfigured())
		throw new AppError(
			503,
			"CompreFace and liveness services must be configured.",
			"FACE_PROVIDER_UNAVAILABLE",
		);
	if (
		!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(sample) ||
		sample.length > 350000
	)
		throw new AppError(422, "A camera JPEG sample is required.");
	const requestId = randomUUID();
	const live = z
		.object({ requestId: z.literal(requestId), livenessPassed: z.boolean() })
		.parse(
			await post(
				process.env.FACE_LIVENESS_URL,
				"/verify",
				process.env.FACE_LIVENESS_KEY,
				{ sample, requestId },
				true,
			),
		);
	if (!live.livenessPassed)
		throw new AppError(
			403,
			"Liveness verification failed.",
			"FACE_VERIFICATION_FAILED",
		);
	const detected = z
		.object({
			result: z.array(
				z.object({ embedding: vector, box: z.object({ probability: score }) }),
			),
			plugins_versions: z.object({ calculator: z.string().min(1) }),
		})
		.parse(
			await post(
				process.env.COMPREFACE_URL,
				"/api/v1/detection/detect?limit=0&det_prob_threshold=0.8&face_plugins=calculator&status=true",
				process.env.COMPREFACE_DETECTION_KEY,
				{ file: sample.split(",")[1] },
			),
		);
	if (detected.result.length !== 1 || detected.result[0].box.probability < 0.8)
		throw new AppError(
			422,
			"Show exactly one clear face to the camera.",
			"FACE_VERIFICATION_FAILED",
		);
	return {
		provider: "compreface" as const,
		version: 1 as const,
		model: detected.plugins_versions.calculator,
		embedding: detected.result[0].embedding,
	};
}
export async function comprefaceEnroll(sample: string) {
	return validated(async () => JSON.stringify(await capture(sample)));
}
export async function comprefaceVerify(template: string, sample: string) {
	return validated(async () => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(template);
		} catch {
			parsed = null;
		}
		const stored = templateSchema.safeParse(parsed);
		if (!stored.success)
			throw new AppError(
				422,
				"Please ask HR to reset your face registration for CompreFace.",
				"FACE_ENROLLMENT_REQUIRED",
			);
		const current = await capture(sample);
		if (
			stored.data.model !== current.model ||
			stored.data.embedding.length !== current.embedding.length
		)
			throw new AppError(
				422,
				"Face model changed. Please register your face again.",
				"FACE_ENROLLMENT_REQUIRED",
			);
		const result = z
			.object({ result: z.array(z.object({ similarity: score })).length(1) })
			.parse(
				await post(
					process.env.COMPREFACE_URL,
					"/api/v1/verification/embeddings/verify",
					process.env.COMPREFACE_VERIFICATION_KEY,
					{ source: stored.data.embedding, targets: [current.embedding] },
				),
			);
		return {
			confidence: result.result[0].similarity,
			livenessPassed: true,
			status: "SUCCESS" as const,
		};
	});
}
async function validated<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError(
			503,
			"Face service returned an invalid result.",
			"FACE_PROVIDER_UNAVAILABLE",
		);
	}
}
