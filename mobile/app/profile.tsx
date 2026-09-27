import { Card, Row, Screen, useApi } from "@/ui";

type Profile = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  officialEmail: string | null;
  mobile: string | null;
  joinedAt: string;
  department?: { name: string } | null;
  designation?: { name: string } | null;
  manager?: { firstName: string; lastName: string } | null;
};

// Read-only profile; changes are requested from HR (bank and identity
// details are never edited on the device).
export default function ProfileScreen() {
  const { data: p, loading, reload } = useApi<Profile>("v1/profile");
  return (
    <Screen loading={loading} onRefresh={reload}>
      {p && (
        <Card title={`${p.firstName} ${p.lastName}`}>
          <Row label="Employee code" value={p.employeeCode} />
          <Row label="Department" value={p.department?.name} />
          <Row label="Designation" value={p.designation?.name} />
          <Row label="Manager" value={p.manager ? `${p.manager.firstName} ${p.manager.lastName}` : null} />
          <Row label="Email" value={p.officialEmail} />
          <Row label="Mobile" value={p.mobile} />
          <Row label="Joined" value={p.joinedAt.slice(0, 10)} />
        </Card>
      )}
    </Screen>
  );
}
