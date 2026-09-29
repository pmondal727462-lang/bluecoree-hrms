import { useEffect, useState } from "react";
import { Text } from "react-native";
import { startNativeTracking, stopNativeTracking } from "./background-tracking";
import { trackingState, type TrackingState } from "./tracking-control";
import { Button, Card, Message, s } from "./ui";

export function TrackingPanel({ checkedIn }: { checkedIn: boolean }) {
  const [state, setState] = useState<TrackingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      void trackingState()
        .then(setState)
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Card title="Live work location">
      <Text style={s.muted}>
        Optional company add-on. By starting, you agree to share your work
        location with authorized company managers, including while this app is
        in the background. You can stop at any time. Your phone shows a location
        indicator.
      </Text>
      <Text>
        {state
          ? `Sharing until ${new Date(state.expiresAt).toLocaleTimeString()}`
          : "Location sharing is off"}
      </Text>
      <Message text={error} error />
      <Button
        disabled={busy || (!state && !checkedIn)}
        label={
          state ? "Stop location sharing" : "Agree and start location sharing"
        }
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            if (state) await stopNativeTracking();
            else await startNativeTracking();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setState(await trackingState());
            setBusy(false);
          }
        }}
      />
      <Text style={s.muted}>
        Check out or sign out to stop. Device power settings and force-closing
        the app can interrupt updates.
      </Text>
    </Card>
  );
}
