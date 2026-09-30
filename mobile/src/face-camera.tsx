import { useEffect, useRef, useState } from "react";
import { CameraView } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { Text, View } from "react-native";
import { Button, s } from "./ui";

// One capture per opened scan. Server verifies identity and liveness.
export function FaceCamera({ onSample, onCancel, onError }: {
  onSample: (sample: string) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const callbacks = useRef({ onSample, onError });
  callbacks.current = { onSample, onError };
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void (async () => {
        try {
          const shot = await camera.current?.takePictureAsync({ quality: 0.8 });
          if (!shot) throw new Error("Could not capture your face. Try again.");
          let imageUri: string | undefined;
          let sample: string;
          try {
            const context = ImageManipulator.manipulate(shot.uri);
            context.resize({ width: 640 });
            const rendered = await context.renderAsync();
            const image = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
            imageUri = image.uri;
            if (!image.base64) throw new Error("Could not prepare face image.");
            sample = `data:image/jpeg;base64,${image.base64}`;
          } finally {
            await FileSystem.deleteAsync(shot.uri, { idempotent: true }).catch(() => undefined);
            if (imageUri) await FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(() => undefined);
          }
          if (!active) return;
          if (sample.length > 350000) throw new Error("Camera image is too large. Please retry in good lighting.");
          await callbacks.current.onSample(sample);
        } catch (error) {
          if (active) callbacks.current.onError((error as Error).message);
        } finally {
          if (active) setBusy(false);
        }
      })();
    }, 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [ready]);
  return <View style={{ gap: 8 }}>
    <CameraView ref={camera} facing="front" style={{ height: 320, borderRadius: 12 }}
      onCameraReady={() => setReady(true)} onMountError={(event) => onError(event.message)} />
    <Text style={s.muted}>{busy ? "Verifying your face…" : "Keep your face in view. Capturing automatically…"}</Text>
    <Button label="Cancel" disabled={busy} kind="outline" onPress={onCancel} />
  </View>;
}
