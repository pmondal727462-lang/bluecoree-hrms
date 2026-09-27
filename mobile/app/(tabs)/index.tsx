import { Text } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Empty, Row, Screen, money, s, useApi } from "@/ui";

type Home = {
  employee: { name: string; designation: string | null; department: string | null } | null;
  attendance: { checkIn: string; checkOut: string | null; workedMinutes: number } | null;
  leave: { id: string; name: string; remaining: number }[] | null;
  holidays: { id: string; name: string; date: string }[];
  payslip: { periodEnd: string; netPay: number; currency: string } | null;
  announcements: { id: string; title: string; body: string }[];
  training: { upcoming: { course: string; startsAt: string }[]; expiring: number } | null;
  unreadNotifications: number;
  approvals: Record<string, number>;
};
const time = (v: string) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Dashboard() {
  const router = useRouter();
  const { data: h, loading, error, reload } = useApi<Home>("v1/home");
  const waiting = h ? Object.values(h.approvals).reduce((a, b) => a + b, 0) : 0;
  return (
    <Screen loading={loading} onRefresh={reload}>
      {error ? <Text style={{ color: "#b42318" }}>{error}</Text> : null}
      {h?.employee && (
        <Card>
          <Text style={s.title}>Hello, {h.employee.name}</Text>
          <Text style={s.muted}>
            {[h.employee.designation, h.employee.department].filter(Boolean).join(" · ")}
          </Text>
        </Card>
      )}
      <Card title="Today">
        <Row label="Check-in" value={h?.attendance ? time(h.attendance.checkIn) : "Not yet"} />
        <Row label="Check-out" value={h?.attendance?.checkOut ? time(h.attendance.checkOut) : "—"} />
        <Button label="Go to attendance" kind="outline" onPress={() => router.push("/attendance")} />
      </Card>
      {waiting > 0 && (
        <Card title={`${waiting} waiting for you`}>
          <Button label="Open approvals" onPress={() => router.push("/approvals")} />
        </Card>
      )}
      {h?.leave && (
        <Card title="Leave balance">
          {h.leave.slice(0, 4).map((l) => (
            <Row key={l.id} label={l.name} value={l.remaining} />
          ))}
        </Card>
      )}
      {h?.payslip && (
        <Card title="Latest payslip">
          <Row label={h.payslip.periodEnd.slice(0, 7)} value={money(h.payslip.netPay, h.payslip.currency)} />
          <Button label="All payslips" kind="outline" onPress={() => router.push("/payslips")} />
        </Card>
      )}
      {h?.training && (h.training.upcoming.length > 0 || h.training.expiring > 0) && (
        <Card title="Training">
          {h.training.upcoming.map((t) => (
            <Row key={t.course + t.startsAt} label={t.course} value={t.startsAt.slice(0, 10)} />
          ))}
          {h.training.expiring > 0 && (
            <Text style={s.muted}>{h.training.expiring} certificate(s) expiring or expired</Text>
          )}
        </Card>
      )}
      <Card title="Announcements">
        {h?.announcements.length ? (
          h.announcements.map((a) => (
            <Text key={a.id} style={s.text}>
              • {a.title}
            </Text>
          ))
        ) : (
          <Empty text="No announcements." />
        )}
      </Card>
      <Card title="Upcoming holidays">
        {h?.holidays.map((x) => <Row key={x.id} label={x.name} value={x.date.slice(0, 10)} />)}
      </Card>
    </Screen>
  );
}
