import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { ApiError, signIn } from "@/api";
import { registerForPush } from "@/push";
import { Button, Card, Field, Message, colors } from "@/ui";

// A stable per-install identifier, so administrators can deactivate a device.
async function deviceId() {
  let id = await SecureStore.getItemAsync("hrms.device");
  if (!id) {
    id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await SecureStore.setItemAsync("hrms.device", id);
  }
  return id;
}

export default function Login() {
  const router = useRouter();
  const [companyCode, setCompany] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState("");
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: colors.bg }}
    >
      <Card>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text }}>Sign in</Text>
        <Field label="Company code" autoCapitalize="characters" value={companyCode} onChangeText={setCompany} />
        <Field label="Email or employee code" autoCapitalize="none" value={identifier} onChangeText={setIdentifier} />
        <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
        {needsCode && (
          <Field label="Authenticator code" keyboardType="number-pad" maxLength={6} value={totp} onChangeText={setTotp} />
        )}
        <Message text={error} error />
        <View style={{ marginTop: 8 }}>
          <Button
            label="Sign in"
            disabled={!companyCode || !identifier || !password}
            onPress={async () => {
              setError("");
              try {
                await signIn(
                  companyCode.trim(),
                  identifier.trim(),
                  password,
                  {
                    deviceId: await deviceId(),
                    deviceName: Device.deviceName ?? Device.modelName ?? "Mobile",
                    platform: Platform.OS === "ios" ? "ios" : "android",
                    appVersion: Constants.expoConfig?.version ?? "1.0.0",
                  },
                  totp || undefined,
                );
                await registerForPush().catch(() => null);
                router.replace("/");
              } catch (e) {
                const err = e as ApiError;
                if (err.code === "TWO_FACTOR_REQUIRED") setNeedsCode(true);
                setError(err.message);
              }
            }}
          />
        </View>
      </Card>
    </KeyboardAvoidingView>
  );
}
