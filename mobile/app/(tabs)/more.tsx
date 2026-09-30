import { useRouter } from "expo-router";
import { signOut } from "@/api";
import { Button, Card, Message, Screen, useApi } from "@/ui";

const links = [
  ["Payslips", "/payslips", "payroll.self"],
  ["Expenses", "/expenses", "expenses.self"],
  ["Documents", "/documents", "profile.read"],
  ["Notifications", "/notifications", "profile.read"],
  ["HR requests", "/helpdesk", "profile.read"],
  ["Profile", "/profile", "profile.read"],
] as const;

export default function More() {
  const router = useRouter();
  const account = useApi<{ permissions: string[] }>("auth/me");
  return (
    <Screen loading={account.loading} onRefresh={account.reload}>
      <Message text={account.error} error />
      <Card>
        {links.filter(([, , permission]) => account.data?.permissions.includes(permission)).map(([label, href]) => (
          <Button key={href} label={label} kind="outline" onPress={() => router.push(href)} />
        ))}
      </Card>
      <Button label="Sign out" kind="danger" onPress={signOut} />
    </Screen>
  );
}
