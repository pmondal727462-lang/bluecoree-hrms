import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#1f4e99", headerTintColor: "#1f4e99" }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="attendance" options={{ title: "Attendance" }} />
      <Tabs.Screen name="leave" options={{ title: "Leave" }} />
      <Tabs.Screen name="approvals" options={{ title: "Approvals" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
