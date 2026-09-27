import { Text } from "react-native";
import { api } from "@/api";
import { Button, Card, Empty, Screen, s, useApi } from "@/ui";

type Notice = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export default function Notifications() {
  const { data, loading, reload } = useApi<{ items: Notice[]; unreadCount: number }>("v1/notifications");
  return (
    <Screen loading={loading} onRefresh={reload}>
      {!!data?.unreadCount && (
        <Button
          label={`Mark ${data.unreadCount} as read`}
          kind="outline"
          onPress={async () => {
            await api("v1/notifications/read", { method: "POST" });
            await reload();
          }}
        />
      )}
      {data?.items.length === 0 && <Empty text="No notifications." />}
      {data?.items.map((n) => (
        <Card key={n.id} title={`${n.readAt ? "" : "● "}${n.title}`}>
          {n.body ? <Text style={s.text}>{n.body}</Text> : null}
          <Text style={s.muted}>{new Date(n.createdAt).toLocaleString()}</Text>
        </Card>
      ))}
    </Screen>
  );
}
