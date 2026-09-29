import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { api, ApiError } from "./api";
import {
  stopLocalTracking,
  trackingKey,
  trackingState,
  trackingTask,
} from "./tracking-control";

// Defined at module scope: the OS can load this without mounting a screen.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  trackingTask,
  async ({ data, error }) => {
    if (error || !data) return;
    const state = await trackingState();
    if (!state) return;
    if (Date.parse(state.expiresAt) <= Date.now()) {
      await stopLocalTracking();
      return;
    }
    const position = data.locations[data.locations.length - 1];
    // Server timestamps represent live observations; never replay stale GPS as live.
    if (
      !position ||
      Date.now() - position.timestamp > 60000 ||
      position.mocked ||
      position.coords.accuracy == null ||
      Date.now() - state.lastSent < state.intervalSeconds * 1000
    )
      return;
    try {
      await api("time/field-tracking/location", {
        method: "POST",
        body: {
          sessionId: state.id,
          deviceId: state.deviceId,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        },
      });
      if ((await trackingState())?.id === state.id)
        await SecureStore.setItemAsync(
          trackingKey,
          JSON.stringify({ ...state, lastSent: Date.now() }),
        );
    } catch (e) {
      if (e instanceof ApiError && [401, 402, 403, 409].includes(e.status))
        await stopLocalTracking();
      // Temporary network failures retry with the next fresh OS location.
    }
  },
);

export async function startNativeTracking() {
  if (!(await TaskManager.isAvailableAsync()))
    throw new Error(
      "Install a native development or production build to use background tracking.",
    );
  if (!(await Location.requestForegroundPermissionsAsync()).granted)
    throw new Error("Allow location access to start tracking.");
  if (!(await Location.requestBackgroundPermissionsAsync()).granted)
    throw new Error(
      "Allow background location in device settings to continue.",
    );
  const deviceId = await SecureStore.getItemAsync("hrms.device");
  if (!deviceId) throw new Error("Sign in again to register this device.");
  const session = await api<{
    id: string;
    expiresAt: string;
    intervalSeconds: number;
  }>("time/field-tracking", {
    method: "POST",
    body: { deviceId, consent: true },
  });
  try {
    await SecureStore.setItemAsync(
      trackingKey,
      JSON.stringify({ ...session, deviceId, lastSent: 0 }),
    );
    await Location.startLocationUpdatesAsync(trackingTask, {
      accuracy: Location.Accuracy.High,
      timeInterval: session.intervalSeconds * 1000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "BlueCoreeHR live tracking",
        notificationBody:
          "Sharing work location with your company. Stop from Attendance.",
        killServiceOnDestroy: true,
      },
    });
  } catch (e) {
    await stopLocalTracking();
    await api(`time/field-tracking/${session.id}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    throw e;
  }
}

export async function stopNativeTracking() {
  const state = await trackingState();
  await stopLocalTracking();
  if (state) await api(`time/field-tracking/${state.id}`, { method: "DELETE" });
}
