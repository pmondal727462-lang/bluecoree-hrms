import { Tabs } from "expo-router";
import { useApi } from "@/ui";

export default function TabsLayout() {
  const account = useApi<{ permissions: string[] }>("auth/me");
  const permissions = account.data?.permissions ?? [];
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#1f4e99", headerTintColor: "#1f4e99" }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="attendance" options={{ title: "Attendance", href: permissions.includes("attendance.self") ? "/attendance" : null }} />
      <Tabs.Screen name="leave" options={{ title: "Leave", href: permissions.includes("timeoff.self") ? "/leave" : null }} />
      <Tabs.Screen name="approvals" options={{ title: "Approvals", href: permissions.some((p) => ["timeoff.manage", "expenses.manage", "expenses.approve"].includes(p)) ? "/approvals" : null }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
