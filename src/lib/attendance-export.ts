import { api } from "./api-client";

// Export every matching page, not just the visible table page.
export async function attendanceExportRows<T>(
  resource: "attendance" | "roster",
  filters: URLSearchParams,
): Promise<T[]> {
  const query = new URLSearchParams(filters);
  query.set("pageSize", "100");
  const rows: T[] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    query.set("page", String(page));
    const result = await api<{ items: T[]; total: number; pageSize: number }>(
      `time/${resource}?${query}`,
    );
    total ??= result.total;
    if (result.total !== total || (!result.items.length && rows.length < total))
      throw new Error(
        "Attendance changed during export. Please download the report again.",
      );
    rows.push(...result.items);
    if (rows.length >= total) return rows;
  }
}
