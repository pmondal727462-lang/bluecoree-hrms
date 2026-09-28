import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

// Exercise the shipped browser module with persistent IndexedDB across reloads.
const source = readFileSync("public/offline/app.js", "utf8").replace(
  /void start\(\);\s*$/,
  "globalThis.ready = start(); globalThis.clock = {capture, sync, rows};",
);
function browser(storage: IDBFactory, online: boolean, send: typeof fetch) {
  const nodes = new Map<string, Record<string, unknown>>();
  const node = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, { textContent: "", append() {}, replaceChildren() {} });
    return nodes.get(id)!;
  };
  const navigator = {
    onLine: online,
    serviceWorker: { register: async () => ({ active: true }) },
  };
  const context = vm.createContext({
    indexedDB: storage,
    navigator,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval() {},
    fetch: send,
    window: { addEventListener() {} },
    document: {
      getElementById: node,
      createElement: () => ({ append() {} }),
      addEventListener() {},
      visibilityState: "visible",
    },
  });
  vm.runInContext(source, context);
  return { context, navigator, nodes };
}
describe("offline device queue", () => {
  it("survives a page reload without a network, keeps failed records, and syncs in order", async () => {
    const storage = new IDBFactory();
    const delivered: string[] = [];
    let reachable = true,
      failOut = true,
      wrongAccount = false;
    const send: typeof fetch = async (input, init) => {
      if (!reachable) throw new TypeError("Failed to fetch");
      const path = String(input);
      if (path.endsWith("auth/me"))
        return Response.json({
          data: {
            companyId: "company",
            userId: wrongAccount ? "someone-else" : "employee",
            permissions: ["attendance.self"],
          },
        });
      if (path.includes("offline-permit"))
        return Response.json({
          data: {
            companyId: "company",
            userId: "employee",
            employeeId: "e",
            employeeCode: "E1",
            name: "Test employee",
            timezone: "UTC",
            deviceId: new URL(path, "http://localhost").searchParams.get(
              "deviceId",
            ),
            permit: "opaque-permit",
            serverTime: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            checkedIn: false,
          },
        });
      const payload = JSON.parse(String(init?.body));
      if (payload.offline.direction === "OUT" && failOut)
        return Response.json(
          { message: "Temporary sync error" },
          { status: 503 },
        );
      delivered.push(payload.offline.direction);
      return Response.json({
        data: {
          checkIn: payload.offline.capturedAt,
          checkOut:
            payload.offline.direction === "OUT"
              ? payload.offline.capturedAt
              : null,
        },
      });
    };
    const first = browser(storage, true, send);
    await first.context.ready;
    first.navigator.onLine = false;
    reachable = false;
    await first.context.clock.capture("IN");
    const reloaded = browser(storage, false, send);
    await reloaded.context.ready;
    expect(
      (await reloaded.context.clock.rows()).map(
        (e: { direction: string }) => e.direction,
      ),
    ).toEqual(["IN"]);
    await reloaded.context.clock.capture("OUT");
    expect((await reloaded.context.clock.rows()).length).toBe(2);
    expect(delivered).toEqual([]);
    // An expired login / another signed-in account cannot receive these punches.
    reloaded.navigator.onLine = true;
    reachable = true;
    wrongAccount = true;
    await reloaded.context.clock.sync();
    expect(delivered).toEqual([]);
    wrongAccount = false;
    await reloaded.context.clock.sync();
    expect(delivered).toEqual(["IN"]);
    let rows = await reloaded.context.clock.rows();
    expect(rows[0].payload).toBeNull();
    expect(rows[1].status).toBe("PENDING");
    expect(rows[1].error).toBe("Temporary sync error");
    failOut = false;
    await reloaded.context.clock.sync();
    await reloaded.context.clock.sync();
    rows = await reloaded.context.clock.rows();
    expect(delivered).toEqual(["IN", "OUT"]);
    expect(
      rows.every(
        (e: { status: string; payload: unknown }) =>
          e.status === "SYNCED" && e.payload === null,
      ),
    ).toBe(true);
  });
});
