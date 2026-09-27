// Copies the MediaPipe WebAssembly runtime used for on-device face detection
// from node_modules into public/, so the browser loads it from this origin.
// Runs before dev and build; the copy is not committed.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const source = "node_modules/@mediapipe/tasks-vision/wasm";
const target = "public/mediapipe/wasm";
const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];
if (!existsSync(source)) {
  console.error("Missing @mediapipe/tasks-vision. Run npm ci.");
  process.exit(1);
}
mkdirSync(target, { recursive: true });
for (const file of files) {
  const from = path.join(source, file),
    to = path.join(target, file);
  if (!existsSync(to) || statSync(to).size !== statSync(from).size)
    copyFileSync(from, to);
}
