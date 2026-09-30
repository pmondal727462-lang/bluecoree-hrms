// Store attendance completion only; camera images and templates never enter
// browser storage. Storage failure still preserves completion in this page.
const completed = new Set<string>();
export function faceLoginKey(userId: string, sessionId: string) {
	return `face-login:${userId}:${sessionId}`;
}
export function faceLoginCompleted(key: string) {
	if (completed.has(key)) return true;
	try {
		return sessionStorage.getItem(key) === "done";
	} catch {
		return false;
	}
}
export function completeFaceLogin(key: string) {
	completed.add(key);
	try {
		sessionStorage.setItem(key, "done");
	} catch {
		/* Retain the in-memory marker. */
	}
}
