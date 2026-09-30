import { useState } from "react";
import { Text, View } from "react-native";
import * as Location from "expo-location";
import { useCameraPermissions } from "expo-camera";
import { FaceCamera } from "@/face-camera";
import { api } from "@/api";
import { stopNativeTracking } from "@/background-tracking";
import { TrackingPanel } from "@/tracking-panel";
import { Button, Card, Empty, Message, Row, Screen, s, useApi } from "@/ui";

type Punch = { checkIn: string; checkOut: string | null; status: string } | null;
type Summary = { current: Punch; open: Punch; employeePolicy: { geofenceEnabled: boolean; gpsTrackingEnabled: boolean } };
type FaceStatus = { enrolled: boolean; providerConfigured: boolean; enrollmentRequired: boolean };
type Day = { id: string; workDate: string; checkIn: string; checkOut: string | null; status: string; workedMinutes: number };
const time = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

// GPS and face attendance. The first punch of the day is the check-in and
// later punches move the check-out, as on the web app.
export default function Attendance() {
  const summary = useApi<Summary>("time/summary");
  const face = useApi<FaceStatus>("v1/face/status");
  const month = new Date().toISOString().slice(0, 7);
  const days = useApi<{ items: Day[] }>(`v1/attendance?from=${month}-01`);
  const [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });

  const location = async () => {
    const policy = summary.data?.employeePolicy;
    if (!policy) throw new Error("Attendance policy is still loading. Try again.");
    if (!policy.geofenceEnabled && !policy.gpsTrackingEnabled) return undefined;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Your company requires location access for attendance.");
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: p.coords.accuracy ?? 0,
    };
  };
  const punch = async (action: "check-in" | "check-out" | "face-punch", faceSample?: string) => {
    setMsg({ text: "" });
    try {
      const saved = await api<Punch>(`v1/attendance/${action}`, {
        method: "POST",
        body: { location: await location(), ...(faceSample ? { faceSample } : {}) },
      });
      setMsg({ text: "Attendance recorded." });
      if (action === "check-out" || saved?.checkOut) await stopNativeTracking().catch(() => undefined);
      setCamera(false);
      await Promise.all([summary.reload(), days.reload()]);
    } catch (e) {
      setCamera(false);
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  // The open record (still checked in) takes precedence over today's.
  const t = summary.data?.open ?? summary.data?.current ?? null;
  const checkedIn = !!t && !t.checkOut;
  return (
    <Screen loading={summary.loading} onRefresh={() => void Promise.all([summary.reload(), days.reload()])}>
      <Card title="Today">
        <Row label="Check-in" value={time(t?.checkIn ?? null)} />
        <Row label="Check-out" value={time(t?.checkOut ?? null)} />
        {t ? <Row label="Status" value={t.status.toLowerCase().replace("_", " ")} /> : null}
        <Message text={msg.text} error={msg.error} />
        <Message text={summary.error || face.error} error />
        {face.data && !face.data.providerConfigured ? <Message text="Face attendance is awaiting your company's face verification service setup." /> : null}
        {camera ? (
          <FaceCamera onCancel={() => setCamera(false)} onError={(text) => { setCamera(false); setMsg({ text, error: true }); }}
            onSample={async (sample) => {
              if (!face.data?.enrolled) {
                await api("v1/face/enroll", { method: "POST", body: { faceSample: sample, consent: true } });
                setCamera(false);
                setMsg({ text: "Face registered securely. Start face attendance to record your check-in." });
                await face.reload();
              } else await punch("face-punch", sample);
            }} />
        ) : (
          <View style={{ gap: 8 }}>
            <Button
              label={face.data?.enrolled ? "Face attendance" : "Agree and register my face"}
              disabled={!face.data?.providerConfigured || summary.loading}
              onPress={async () => {
                if (!permission?.granted && !(await requestPermission()).granted)
                  return setMsg({ text: "Allow camera access for face attendance.", error: true });
                setCamera(true);
              }}
            />
            {!face.data?.enrolled ? <Text style={s.muted}>I consent to an encrypted face template being stored on the HRMS server for attendance verification. Contact HR to reset or remove it.</Text> : null}
          </View>
        )}
        <Text style={s.muted}>
          Your first verified scan records check-in. Later scans update check-out. Use the same employee login as the website; your attendance is saved on the HRMS server.
        </Text>
      </Card>
      <TrackingPanel checkedIn={checkedIn} />
      <Card title="This month">
        {days.data?.items.length ? (
          days.data.items.map((d) => (
            <Row
              key={d.id}
              label={d.workDate.slice(0, 10)}
              value={`${time(d.checkIn)}–${time(d.checkOut)} · ${d.status.toLowerCase().replace("_", " ")}`}
            />
          ))
        ) : (
          <Empty text="No attendance this month." />
        )}
      </Card>
    </Screen>
  );
}
