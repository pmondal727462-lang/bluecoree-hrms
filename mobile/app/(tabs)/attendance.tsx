import { useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Location from "expo-location";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api } from "@/api";
import { stopNativeTracking } from "@/background-tracking";
import { TrackingPanel } from "@/tracking-panel";
import { Button, Card, Empty, Message, Row, Screen, s, useApi } from "@/ui";

type Punch = { checkIn: string; checkOut: string | null; status: string } | null;
type Summary = { current: Punch; open: Punch };
type Day = { id: string; workDate: string; checkIn: string; checkOut: string | null; status: string; workedMinutes: number };
const time = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

// GPS and face attendance. The first punch of the day is the check-in and
// later punches move the check-out, as on the web app.
export default function Attendance() {
  const summary = useApi<Summary>("time/summary");
  const month = new Date().toISOString().slice(0, 7);
  const days = useApi<{ items: Day[] }>(`v1/attendance?from=${month}-01`);
  const [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });

  const location = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return undefined;
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
        {camera ? (
          <View style={{ gap: 8 }}>
            <CameraView ref={ref} facing="front" style={{ height: 320, borderRadius: 12 }} />
            <Button
              label="Scan my face"
              onPress={async () => {
                const shot = await ref.current?.takePictureAsync({ base64: true, quality: 0.4 });
                if (shot?.base64) await punch("face-punch", `data:image/jpeg;base64,${shot.base64}`);
              }}
            />
            <Button label="Cancel" kind="outline" onPress={() => setCamera(false)} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Button
              label="Face attendance"
              onPress={async () => {
                if (!permission?.granted && !(await requestPermission()).granted)
                  return setMsg({ text: "Allow camera access for face attendance.", error: true });
                setCamera(true);
              }}
            />
            <Button label={checkedIn ? "Check out with GPS" : "Check in with GPS"} kind="outline" onPress={() => punch(checkedIn ? "check-out" : "check-in")} />
          </View>
        )}
        <Text style={s.muted}>
          Your location is sent with each punch when your company uses geofences.
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
