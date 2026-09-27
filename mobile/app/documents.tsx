import { useState } from "react";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { api } from "@/api";
import { Button, Card, Empty, Message, Row, Screen, useApi } from "@/ui";

type Doc = { id: string; title: string; category: string; status: string; expiresOn: string | null; requiresAcknowledgement: boolean };

// The employee's documents and company policies. Files open through a
// short-lived signed link.
export default function Documents() {
  const own = useApi<Doc[]>("v1/documents?scope=own");
  const policies = useApi<Doc[]>("v1/documents?scope=policies");
  const [error, setError] = useState("");
  const open = async (id: string) => {
    setError("");
    try {
      const r = await api<{ url: string }>(`v1/documents/${id}/download?inline=1`);
      const base = (Constants.expoConfig?.extra?.apiUrl as string).replace(/\/$/, "");
      await Linking.openURL(r.url.startsWith("http") ? r.url : `${base}${r.url}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const list = (docs: Doc[] | null) =>
    docs?.length ? (
      docs.map((d) => (
        <Card key={d.id} title={d.title}>
          <Row label={d.category.toLowerCase().replace("_", " ")} value={d.expiresOn ? `expires ${d.expiresOn.slice(0, 10)}` : ""} />
          <Button label="Open" kind="outline" onPress={() => open(d.id)} />
          {d.requiresAcknowledgement && (
            <Button
              label="Acknowledge"
              onPress={async () => {
                await api(`v1/documents/${d.id}/acknowledge`, { method: "POST" });
                await policies.reload();
              }}
            />
          )}
        </Card>
      ))
    ) : (
      <Empty text="Nothing here." />
    );
  return (
    <Screen loading={own.loading} onRefresh={() => void Promise.all([own.reload(), policies.reload()])}>
      <Message text={error} error />
      <Card title="My documents">{list(own.data)}</Card>
      <Card title="Company policies">{list(policies.data)}</Card>
    </Screen>
  );
}
