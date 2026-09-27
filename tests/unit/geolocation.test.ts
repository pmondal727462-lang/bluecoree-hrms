import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLocation } from "../../src/lib/geolocation";

afterEach(() => vi.unstubAllGlobals());
describe("attendance geolocation", () => {
  it("requests a fresh high accuracy position only when called", async () => {
    const getCurrentPosition = vi.fn(
      (
        success: (position: {
          coords: { latitude: number; longitude: number; accuracy: number };
        }) => void,
        _failure: unknown,
        _options: PositionOptions,
      ) => success({ coords: { latitude: 12, longitude: 77, accuracy: 15 } }),
    );
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(await currentLocation()).toEqual({
      latitude: 12,
      longitude: 77,
      accuracy: 15,
    });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
  it.each([
    [1, "permission was denied"],
    [2, "unavailable"],
    [3, "timed out"],
  ])("explains GPS error %s", async (code, message) => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _success: unknown,
          failure: (error: { code: number }) => void,
        ) => failure({ code: Number(code) }),
      },
    });
    await expect(currentLocation()).rejects.toThrow(String(message));
  });
  it("explains the secure URL requirement", async () => {
    vi.stubGlobal("window", { isSecureContext: false });
    await expect(currentLocation()).rejects.toThrow("HTTPS");
  });
});
