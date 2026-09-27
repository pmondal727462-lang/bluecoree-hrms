import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { setSignedOutHandler, signedIn } from "@/api";

// Keeps signed-out users on the login screen and opens the screen a push
// notification links to.
export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setSignedOutHandler(() => setAuthed(false));
    void signedIn().then((v) => {
      setAuthed(v);
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    // The token is checked on every navigation, so a fresh sign-in counts.
    void signedIn().then((now) => {
      setAuthed(now);
      const onLogin = segments[0] === "login";
      if (!now && !onLogin) router.replace("/login");
      if (now && onLogin) router.replace("/");
    });
  }, [ready, authed, segments, router]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const link = r.notification.request.content.data?.link;
      const map: Record<string, string> = {
        "/leave": "/leave",
        "/payslips": "/payslips",
        "/expenses": "/expenses",
        "/training": "/notifications",
        "/attendance": "/attendance",
      };
      if (typeof link === "string" && map[link]) router.push(map[link] as never);
    });
    return () => sub.remove();
  }, [router]);
  return (
    <Stack screenOptions={{ headerTintColor: "#1f4e99" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="payslips" options={{ title: "Payslips" }} />
      <Stack.Screen name="expenses" options={{ title: "Expenses" }} />
      <Stack.Screen name="documents" options={{ title: "Documents" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="helpdesk" options={{ title: "HR requests" }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
    </Stack>
  );
}
