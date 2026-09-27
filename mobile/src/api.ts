import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// API client for the HRMS mobile endpoints (/api/v1). Tokens live in the
// device keystore; an expired access token is refreshed once and retried.
const base = `${(Constants.expoConfig?.extra?.apiUrl as string).replace(/\/$/, "")}/api`;
const keys = { access: "hrms.access", refresh: "hrms.refresh" };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
type Envelope<T> = { success: boolean; data?: T; message?: string; errorCode?: string };

let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

async function refresh() {
  const refreshToken = await SecureStore.getItemAsync(keys.refresh);
  if (!refreshToken) return false;
  const res = await fetch(`${base}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as Envelope<{ accessToken: string; refreshToken: string }>;
  if (!body.data) return false;
  await SecureStore.setItemAsync(keys.access, body.data.accessToken);
  await SecureStore.setItemAsync(keys.refresh, body.data.refreshToken);
  return true;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  retried = false,
): Promise<T> {
  const token = await SecureStore.getItemAsync(keys.access);
  const res = await fetch(`${base}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  // Sign-in failures are answers, not expired sessions.
  const auth = path.startsWith("v1/auth/");
  if (res.status === 401 && !auth && !retried && (await refresh()))
    return api<T>(path, init, true);
  if (res.status === 401 && !auth) {
    await signOut();
    throw new ApiError("Please sign in again.", 401, "UNAUTHENTICATED");
  }
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || !body.success)
    throw new ApiError(body.message ?? "Something went wrong.", res.status, body.errorCode);
  return body.data as T;
}

// Authenticated download URL with the bearer token, for PDFs.
export async function authorizedDownload(path: string) {
  return {
    uri: `${base}/${path}`,
    headers: { authorization: `Bearer ${(await SecureStore.getItemAsync(keys.access)) ?? ""}` },
  };
}

export async function signIn(
  companyCode: string,
  identifier: string,
  password: string,
  device: { deviceId: string; deviceName: string; platform: "android" | "ios"; appVersion: string },
  totp?: string,
) {
  const data = await api<{ accessToken: string; refreshToken: string }>("v1/auth/login", {
    method: "POST",
    body: { companyCode, identifier, password, device, ...(totp ? { totp } : {}) },
  });
  await SecureStore.setItemAsync(keys.access, data.accessToken);
  await SecureStore.setItemAsync(keys.refresh, data.refreshToken);
}
export async function signOut() {
  await SecureStore.deleteItemAsync(keys.access);
  await SecureStore.deleteItemAsync(keys.refresh);
  onSignedOut();
}
export const signedIn = async () => !!(await SecureStore.getItemAsync(keys.access));
