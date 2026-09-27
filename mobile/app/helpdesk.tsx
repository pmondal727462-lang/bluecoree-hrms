import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/api";
import { Button, Card, Empty, Field, Message, Row, Screen, colors, s, useApi } from "@/ui";

type Ticket = { id: string; subject: string; category: string; status: string; lastMessageAt: string };
const categories = ["ATTENDANCE", "PAYROLL", "LEAVE", "DOCUMENT", "HR", "IT", "OTHER"];

// HR requests: raise a ticket and follow its status.
export default function Helpdesk() {
  const { data, loading, reload } = useApi<Ticket[]>("v1/helpdesk");
  const [category, setCategory] = useState("HR");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });
  return (
    <Screen loading={loading} onRefresh={reload}>
      <Card title="New request">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {categories.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.primary,
                backgroundColor: category === c ? colors.primary : "#fff",
              }}
            >
              <Text style={{ color: category === c ? "#fff" : colors.primary }}>{c.toLowerCase()}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="Details" value={body} onChangeText={setBody} multiline />
        <Message text={msg.text} error={msg.error} />
        <Button
          label="Send"
          disabled={subject.length < 3 || body.length < 3}
          onPress={async () => {
            try {
              await api("v1/helpdesk", { method: "POST", body: { category, subject, body } });
              setMsg({ text: "Request sent to HR." });
              setSubject("");
              setBody("");
              await reload();
            } catch (e) {
              setMsg({ text: (e as Error).message, error: true });
            }
          }}
        />
      </Card>
      <Card title="My requests">
        {data?.length ? (
          data.map((t) => (
            <View key={t.id} style={{ paddingVertical: 4 }}>
              <Row label={t.subject} value={t.status.toLowerCase().replace("_", " ")} />
              <Text style={s.muted}>
                {t.category.toLowerCase()} · {new Date(t.lastMessageAt).toLocaleDateString()}
              </Text>
            </View>
          ))
        ) : (
          <Empty text="No requests yet." />
        )}
      </Card>
    </Screen>
  );
}
