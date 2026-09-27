import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { api } from "./api";

export const colors = {
  primary: "#1f4e99",
  text: "#1b1f24",
  muted: "#6b7280",
  border: "#e5e7eb",
  bg: "#f6f7f9",
  danger: "#b42318",
  ok: "#067647",
};

// Loads an endpoint and exposes pull-to-refresh.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export function Screen({
  children,
  loading = false,
  onRefresh,
}: {
  children: ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={loading} onRefresh={onRefresh} /> : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.title}>{title}</Text> : null}
      {children}
    </View>
  );
}
export function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.text}>{value ?? "—"}</Text>
    </View>
  );
}
export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  kind?: "primary" | "outline" | "danger";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={async () => {
        setBusy(true);
        try {
          await onPress();
        } finally {
          setBusy(false);
        }
      }}
      style={[
        s.button,
        kind === "outline" && s.outline,
        kind === "danger" && { backgroundColor: colors.danger },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "outline" ? colors.primary : "#fff"} />
      ) : (
        <Text style={[s.buttonText, kind === "outline" && { color: colors.primary }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.muted}>{props.label}</Text>
      <TextInput {...props} style={s.input} placeholderTextColor={colors.muted} />
    </View>
  );
}
export function Message({ text, error }: { text?: string; error?: boolean }) {
  if (!text) return null;
  return <Text style={{ color: error ? colors.danger : colors.ok }}>{text}</Text>;
}
export function Empty({ text }: { text: string }) {
  return <Text style={[s.muted, { textAlign: "center", padding: 16 }]}>{text}</Text>;
}
export const money = (v: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

export const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  outline: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.primary },
  buttonText: { color: "#fff", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#fff",
    color: colors.text,
  },
});
