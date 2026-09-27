import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

// Registers this device's Expo push token with the HRMS server, which
// delivers leave, attendance, payslip, training and approval notices.
export async function registerForPush() {
  if (!Device.isDevice) return null;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "HR notifications",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted")
    status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api("v1/push-token", {
    method: "POST",
    body: { token, platform: Platform.OS === "ios" ? "ios" : "android" },
  });
  return token;
}
export async function unregisterPush(token: string | null) {
  if (token) await api("v1/push-token", { method: "DELETE", body: { token } }).catch(() => undefined);
}
