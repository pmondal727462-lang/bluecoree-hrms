import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { attendanceExportRows } from "@/lib/attendance-export";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("downloads all 210 records and preserves date, scope, search and branch filters", async () => {
  const records = Array.from({ length: 210 }, (_, id) => ({ id }));
  vi.mocked(api).mockImplementation(async (path) => {
    const q = new URLSearchParams(path.split("?")[1]);
    expect(q.get("scope")).toBe("company");
    expect(q.get("from")).toBe("2026-08-01");
    expect(q.get("to")).toBe("2026-08-31");
    expect(q.get("search")).toBe("Aarav");
    expect(q.get("branchId")).toBe("branch-1");
    expect(q.get("pageSize")).toBe("100");
    const offset = (Number(q.get("page")) - 1) * 100;
    return {
      items: records.slice(offset, offset + 100),
      total: 210,
      pageSize: 100,
    };
  });
  const filters = new URLSearchParams(
    "scope=company&from=2026-08-01&to=2026-08-31&search=Aarav&branchId=branch-1&page=5",
  );
  expect(await attendanceExportRows("attendance", filters)).toEqual(records);
  expect(api).toHaveBeenCalledTimes(3);
  expect(filters.get("page")).toBe("5");
});

it("uses the daily register endpoint and handles an empty report", async () => {
  vi.mocked(api).mockResolvedValue({ items: [], total: 0, pageSize: 100 });
  expect(
    await attendanceExportRows(
      "roster",
      new URLSearchParams("date=2026-08-01"),
    ),
  ).toEqual([]);
  expect(api).toHaveBeenCalledWith(
    "time/roster?date=2026-08-01&pageSize=100&page=1",
  );
});

it("refuses a partial report when a later page fails", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ items: [{ id: 1 }], total: 2 })
    .mockRejectedValueOnce(new Error("Forbidden"));
  await expect(
    attendanceExportRows("attendance", new URLSearchParams()),
  ).rejects.toThrow("Forbidden");
});

it("asks to retry when the record count changes between pages", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ items: [{ id: 1 }], total: 2 })
    .mockResolvedValueOnce({ items: [], total: 1 });
  await expect(
    attendanceExportRows("attendance", new URLSearchParams()),
  ).rejects.toThrow("Attendance changed");
});
