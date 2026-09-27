import { useState } from "react";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { authorizedDownload } from "@/api";
import { Button, Card, Empty, Message, Row, Screen, money, useApi } from "@/ui";

type Payslip = { id: string; periodStart: string; grossPay: number; deductions: number; netPay: number; currency: string };

// Payslips with the server-generated PDF, opened in the system viewer.
export default function Payslips() {
  const { data, loading, reload } = useApi<Payslip[]>("v1/payslips");
  const [error, setError] = useState("");
  return (
    <Screen loading={loading} onRefresh={reload}>
      <Message text={error} error />
      {data?.length === 0 && <Empty text="No payslips yet." />}
      {data?.map((p) => (
        <Card key={p.id} title={p.periodStart.slice(0, 7)}>
          <Row label="Gross" value={money(p.grossPay, p.currency)} />
          <Row label="Deductions" value={money(p.deductions, p.currency)} />
          <Row label="Net pay" value={money(p.netPay, p.currency)} />
          <Button
            label="Open PDF"
            kind="outline"
            onPress={async () => {
              setError("");
              try {
                const { uri, headers } = await authorizedDownload(`v1/payslips/${p.id}/pdf`);
                const file = `${FileSystem.cacheDirectory}payslip-${p.periodStart.slice(0, 7)}.pdf`;
                const res = await FileSystem.downloadAsync(uri, file, { headers });
                if (res.status !== 200) throw new Error("The payslip could not be downloaded.");
                await Sharing.shareAsync(res.uri, { mimeType: "application/pdf" });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
