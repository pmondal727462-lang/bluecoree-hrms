import { useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api";
import { Button, Card, Empty, Field, Message, Row, Screen, money, s, useApi } from "@/ui";

type Person = { firstName: string; lastName: string; employeeCode: string };
type Approvals = {
  leave: { id: string; startDate: string; endDate: string; days: number; leaveType: { name: string }; employee: Person }[];
  expenses: {
    id: string;
    amount: number;
    currency: string;
    description: string;
    status: string;
    category: { name: string };
    employee: Person;
  }[];
};
const who = (p: Person) => `${p.firstName} ${p.lastName} (${p.employeeCode})`;

// Leave requests and expense claims waiting for this user's decision.
export default function ApprovalsScreen() {
  const { data, loading, reload } = useApi<Approvals>("v1/approvals");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });
  const act = async (path: string, body: unknown) => {
    setMsg({ text: "" });
    try {
      await api(path, { method: "PUT", body });
      setMsg({ text: "Done." });
      setNote("");
      await reload();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  const empty = data && !data.leave.length && !data.expenses.length;
  return (
    <Screen loading={loading} onRefresh={reload}>
      <Field label="Note (required to reject)" value={note} onChangeText={setNote} />
      <Message text={msg.text} error={msg.error} />
      {empty && <Empty text="Nothing is waiting for you." />}
      {data?.leave.map((l) => (
        <Card key={l.id} title={who(l.employee)}>
          <Row label={l.leaveType.name} value={`${l.days} day(s)`} />
          <Text style={s.muted}>
            {l.startDate.slice(0, 10)} → {l.endDate.slice(0, 10)}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Approve" onPress={() => act(`time/leave/${l.id}`, { status: "Approved", note })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Reject"
                kind="danger"
                disabled={!note}
                onPress={() => act(`time/leave/${l.id}`, { status: "Rejected", note })}
              />
            </View>
          </View>
        </Card>
      ))}
      {data?.expenses.map((x) => (
        <Card key={x.id} title={who(x.employee)}>
          <Row label={x.category.name} value={money(x.amount, x.currency)} />
          <Text style={s.muted}>
            {x.description} · {x.status === "MANAGER_APPROVED" ? "finance approval" : "manager approval"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Approve" onPress={() => act(`expenses/claims/${x.id}`, { action: "approve", note })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Reject"
                kind="danger"
                disabled={!note}
                onPress={() => act(`expenses/claims/${x.id}`, { action: "reject", note })}
              />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
