let refreshing: Promise<boolean> | null = null;
export async function downloadApiFile(path: string, filename: string) {
  let response = await fetch(`/api/${path}`);
  if (response.status === 401) {
    await api("auth/refresh", { method: "POST" }, false);
    response = await fetch(`/api/${path}`);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "Report download failed.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 401 && retry && !path.startsWith("auth/")) {
    refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
      .then((r) => r.ok)
      .finally(() => {
        refreshing = null;
      });
    if (await refreshing) return api<T>(path, options, false);
    window.location.href = ["/admin", "/platform"].includes(
      window.location.pathname,
    )
      ? "/owner/login"
      : "/login";
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Request failed.");
  return result.data as T;
}
