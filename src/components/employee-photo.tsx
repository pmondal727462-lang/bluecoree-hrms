"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";

// Private employee photo, loaded through a short-lived signed link. `path` is
// "profile/photo" for the signed-in employee or "employees/<id>/photo".
export function EmployeePhoto({
  path,
  name,
  canEdit,
  notify,
}: {
  path: string;
  name: string;
  canEdit: boolean;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photo = useQuery({
    queryKey: ["photo", path],
    queryFn: () => api<{ url: string | null }>(path),
    staleTime: 240_000,
  });
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
  const change = async (file: File) => {
    if (!["image/png", "image/jpeg"].includes(file.type))
      return notify("Choose a PNG or JPEG photo.");
    if (file.size > 1024 * 1024)
      return notify("Photos must be 1 MB or smaller.");
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      await api(path, {
        method: "PUT",
        body: JSON.stringify({
          file: {
            name: file.name,
            type: file.type,
            base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
          },
        }),
      });
      await client.invalidateQueries({ queryKey: ["photo", path] });
      notify("Photo updated.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not upload the photo.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(path, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: ["photo", path] });
      notify("Photo removed.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4">
      {photo.data?.url ? (
        <img
          src={photo.data.url}
          alt={`Photo of ${name}`}
          className="avatar size-16 object-cover"
        />
      ) : (
        <span className="avatar size-16 text-xl" aria-hidden>
          {initials}
        </span>
      )}
      {canEdit && (
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void change(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {photo.data?.url ? "Change photo" : "Add photo"}
          </Button>
          {photo.data?.url && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
