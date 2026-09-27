import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/api";
import { Button, Card, Empty, Field, Message, Row, Screen, colors, s, useApi } from "@/ui";

type Balance = { id: string; name: string; paid: boolean; entitled: number; pending: number; remaining: number; halfDayAllowed: boolean };
type Request = {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  leaveType: { name: string };
};

// Leave balance, request and history. Dates use YYYY-MM-DD.
export default function Leave() {
  const year = new Date().getFullYear();
  const balances = useApi<Balance[]>(`v1/leave-balances?year=${year}`);
  const list = useApi<{ items: Request[] }>("v1/leave?pageSize=50");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });
  const reload = () => void Promise.all([balances.reload(), list.reload()]);
  return (
    <Screen loading={balances.loading} onRefresh={reload}>
      <Card title="Balance">
        {balances.data?.map((b) => (
          <Row key={b.id} label={b.name} value={b.paid ? `${b.remaining} of ${b.entitled}` : "Unpaid"} />
        ))}
      </Card>
      <Card title="Request leave">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {balances.data?.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => setTypeId(b.id)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.primary,
                backgroundColor: typeId === b.id ? colors.primary : "#fff",
              }}
            >
              <Text style={{ color: typeId === b.id ? "#fff" : colors.primary }}>{b.name}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="From (YYYY-MM-DD)" value={start} onChangeText={setStart} />
        <Field label="To (YYYY-MM-DD)" value={end} onChangeText={setEnd} />
        <Field label="Reason" value={reason} onChangeText={setReason} multiline />
        <Message text={msg.text} error={msg.error} />
        <Button
          label="Submit request"
          disabled={!typeId || !start || !reason}
          onPress={async () => {
            try {
              await api("v1/leave", {
                method: "POST",
                body: { leaveTypeId: typeId, startDate: start, endDate: end || start, reason },
              });
              setMsg({ text: "Request submitted for approval." });
              setReason("");
              reload();
            } catch (e) {
              setMsg({ text: (e as Error).message, error: true });
            }
          }}
        />
      </Card>
      <Card title="My requests">
        {list.data?.items.length ? (
          list.data.items.map((r) => (
            <View key={r.id} style={{ gap: 2, paddingVertical: 4 }}>
              <Row label={r.leaveType.name} value={r.status} />
              <Text style={s.muted}>
                {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)} · {r.days} day(s)
              </Text>
              {r.status === "Pending" && (
                <Button
                  label="Cancel"
                  kind="outline"
                  onPress={async () => {
                    await api(`time/leave/${r.id}`, { method: "PUT", body: { status: "Cancelled" } });
                    reload();
                  }}
                />
              )}
            </View>
          ))
        ) : (
          <Empty text="No leave requests yet." />
        )}
      </Card>
    </Screen>
  );
}
