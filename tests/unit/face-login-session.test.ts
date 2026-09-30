import { afterEach, describe, expect, it, vi } from "vitest";
import {
	completeFaceLogin,
	faceLoginCompleted,
	faceLoginKey,
} from "@/lib/face-login-session";

afterEach(() => vi.unstubAllGlobals());
describe("employee login attendance completion", () => {
	it("recognizes a saved completion after a page reload", () => {
		const key = faceLoginKey("reload-user", "session");
		vi.stubGlobal("sessionStorage", {
			getItem: (stored: string) => (stored === key ? "done" : null),
		});
		expect(faceLoginCompleted(key)).toBe(true);
		expect(faceLoginCompleted(faceLoginKey("reload-user", "new-session"))).toBe(
			false,
		);
		expect(faceLoginCompleted(faceLoginKey("other-user", "session"))).toBe(
			false,
		);
	});
	it("remembers a successful punch even when browser storage is unavailable", () => {
		vi.stubGlobal("sessionStorage", {
			getItem() {
				throw new Error("blocked");
			},
			setItem() {
				throw new Error("blocked");
			},
		});
		const key = faceLoginKey("blocked-storage-user", "session");
		expect(faceLoginCompleted(key)).toBe(false);
		expect(() => completeFaceLogin(key)).not.toThrow();
		expect(faceLoginCompleted(key)).toBe(true);
	});
	it("persists only the completion marker", () => {
		const setItem = vi.fn();
		vi.stubGlobal("sessionStorage", { setItem });
		const key = faceLoginKey("stored-user", "session");
		completeFaceLogin(key);
		expect(setItem).toHaveBeenCalledExactlyOnceWith(key, "done");
	});
});
