import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../../src/app/api/[...path]/route";

describe("retired biometric device endpoints", () => {
  it.each(["biometric/devices", "biometric/push", "biometric/hikvision/old-token", "biometric/mappings"])("refuses %s without authenticating or contacting a device", async (route) => {
    for (const [method, handler] of [["GET", GET], ["POST", POST]] as const) {
      const response = await handler(new NextRequest(`http://localhost:3000/api/${route}`, { method }), { params: Promise.resolve({ path: route.split("/") }) });
      expect(response.status).toBe(404);
      expect((await response.json()).message).toBe("Endpoint not found.");
    }
  });
});
