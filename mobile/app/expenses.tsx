import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { api } from "@/api";
import { Button, Card, Empty, Field, Message, Row, Screen, colors, money, s, useApi } from "@/ui";

type Category = { id: string; name: string; active: boolean; requiresReceipt: boolean; limitPerClaim: number | null };
type Claim = { id: string; amount: number; currency: string; status: string; expenseDate: string; description: string; category: { name: string } };
const statusLabel: Record<string, string> = {
  SUBMITTED: "with manager",
  MANAGER_APPROVED: "with finance",
  APPROVED: "approved",
  REIMBURSED: "paid",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

// Expense claims with a receipt (PDF, PNG or JPEG up to 2 MB).
export default function Expenses() {
  const categories = useApi<Category[]>("v1/expenses/categories");
  const claims = useApi<Claim[]>("v1/expenses/claims?scope=own");
  const [categoryId, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<{ name: string; type: string; base64: string } | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });
  return (
    <Screen loading={claims.loading} onRefresh={claims.reload}>
      <Card title="New claim">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {categories.data
            ?.filter((c) => c.active)
            .map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  backgroundColor: categoryId === c.id ? colors.primary : "#fff",
                }}
              >
                <Text style={{ color: categoryId === c.id ? "#fff" : colors.primary }}>{c.name}</Text>
              </Pressable>
            ))}
        </View>
        <Field label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
        <Field label="Description" value={description} onChangeText={setDescription} />
        <Button
          label={receipt ? `Receipt: ${receipt.name}` : "Attach receipt"}
          kind="outline"
          onPress={async () => {
            const r = await DocumentPicker.getDocumentAsync({
              type: ["application/pdf", "image/png", "image/jpeg"],
              copyToCacheDirectory: true,
            });
            const file = r.assets?.[0];
            if (!file) return;
            if ((file.size ?? 0) > 2 * 1024 * 1024)
              return setMsg({ text: "The receipt must be 2 MB or smaller.", error: true });
            setReceipt({
              name: file.name,
              type: file.mimeType ?? "application/octet-stream",
              base64: await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }),
            });
          }}
        />
        <Message text={msg.text} error={msg.error} />
        <Button
          label="Submit claim"
          disabled={!categoryId || !amount || description.length < 3}
          onPress={async () => {
            try {
              await api("v1/expenses/claims", {
                method: "POST",
                body: {
                  categoryId,
                  amount: Number(amount),
                  expenseDate: date,
                  description,
                  ...(receipt ? { receipt } : {}),
                },
              });
              setMsg({ text: "Claim submitted to your manager." });
              setAmount("");
              setDescription("");
              setReceipt(null);
              await claims.reload();
            } catch (e) {
              setMsg({ text: (e as Error).message, error: true });
            }
          }}
        />
      </Card>
      <Card title="My claims">
        {claims.data?.length ? (
          claims.data.map((c) => (
            <View key={c.id} style={{ paddingVertical: 4 }}>
              <Row label={`${c.category.name} · ${c.expenseDate.slice(0, 10)}`} value={money(c.amount, c.currency)} />
              <Text style={s.muted}>
                {c.description} · {statusLabel[c.status] ?? c.status.toLowerCase()}
              </Text>
            </View>
          ))
        ) : (
          <Empty text="No claims yet." />
        )}
      </Card>
    </Screen>
  );
}
