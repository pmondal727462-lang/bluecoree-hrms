import { useRouter } from "expo-router";
import { signOut } from "@/api";
import { Button, Card, Screen } from "@/ui";

const links = [
  ["Payslips", "/payslips"],
  ["Expenses", "/expenses"],
  ["Documents", "/documents"],
  ["Notifications", "/notifications"],
  ["HR requests", "/helpdesk"],
  ["Profile", "/profile"],
] as const;

export default function More() {
  const router = useRouter();
  return (
    <Screen>
      <Card>
        {links.map(([label, href]) => (
          <Button key={href} label={label} kind="outline" onPress={() => router.push(href)} />
        ))}
      </Card>
      <Button label="Sign out" kind="danger" onPress={signOut} />
    </Screen>
  );
}
