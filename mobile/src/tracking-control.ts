import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";

export const trackingTask = "bluecoreehr-live-location";
export const trackingKey = "hrms.tracking";
export type TrackingState = {
  id: string;
  deviceId: string;
  expiresAt: string;
  intervalSeconds: number;
  lastSent: number;
};
export async function trackingState(): Promise<TrackingState | null> {
  const value = await SecureStore.getItemAsync(trackingKey);
  return value ? (JSON.parse(value) as TrackingState) : null;
}
export async function stopLocalTracking() {
  // Clear consent first, so a concurrently delivered OS callback sends nothing.
  await SecureStore.deleteItemAsync(trackingKey);
  if (await Location.hasStartedLocationUpdatesAsync(trackingTask))
    await Location.stopLocationUpdatesAsync(trackingTask);
}
