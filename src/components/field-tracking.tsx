"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Radio, Square } from "lucide-react";
import { api } from "@/lib/api-client";
import { currentLocation } from "@/lib/geolocation";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";

type Point = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
  locationName: string | null;
};
type Session = {
  id: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  employee: {
    firstName: string;
    lastName: string;
    employeeCode: string;
    branch?: { name: string } | null;
  };
  points: Point[];
};
const deviceKey = "people-field-tracking-device";
function deviceId() {
  const current = localStorage.getItem(deviceKey);
  if (current) return current;
  const value =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  localStorage.setItem(deviceKey, value);
  return value;
}
const map = (point: Point) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`;

export function FieldTracking({
  me,
  enabled,
  employeeId,
  intervalSeconds,
}: {
  me: Me;
  enabled: boolean;
  employeeId?: string;
  intervalSeconds: number;
}) {
  const client = useQueryClient();
  const entitled = !!me.subscription?.plan.features.includes("livetracking");
  const [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const watch = useRef<number | null>(null),
    sending = useRef(false),
    lastSentAt = useRef(0);
  const own = useQuery({
    queryKey: ["field-tracking", "own", employeeId],
    queryFn: () =>
      api<Session[]>(
        `time/field-tracking?employeeId=${encodeURIComponent(employeeId || "")}`,
      ),
    enabled: entitled && !!employeeId,
    refetchInterval: session ? 15000 : false,
  });
  const manager = useQuery({
    queryKey: ["field-tracking", "manager"],
    queryFn: () => api<Session[]>("time/field-tracking"),
    enabled: entitled && me.permissions.includes("fieldtracking.read"),
    refetchInterval: 15000,
  });
  useEffect(() => {
    if (!entitled && watch.current !== null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }
  }, [entitled]);
  useEffect(() => {
    const current = own.data?.find((s) => s.status === "ACTIVE") || null;
    if (current && !session) setSession(current);
  }, [own.data, session]);
  useEffect(
    () => () => {
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );
  async function send(sessionId: string) {
    if (sending.current) return;
    if (Date.now() - lastSentAt.current < intervalSeconds * 1000) return;
    sending.current = true;
    try {
      const location = await currentLocation();
      await api("time/field-tracking/location", {
        method: "POST",
        body: JSON.stringify({ sessionId, deviceId: deviceId(), location }),
      });
      lastSentAt.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Location update failed.");
    } finally {
      sending.current = false;
    }
  }
  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        id: string;
        expiresAt: string;
        intervalSeconds: number;
      }>("time/field-tracking", {
        method: "POST",
        body: JSON.stringify({ deviceId: deviceId(), consent: true }),
      });
      setSession({
        id: result.id,
        status: "ACTIVE",
        startedAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
        lastSeenAt: null,
        employee: {
          firstName: "You",
          lastName: "",
          employeeCode: "",
          branch: null,
        },
        points: [],
      });
      await send(result.id);
      if (!navigator.geolocation)
        throw new Error("This browser does not support GPS.");
      watch.current = navigator.geolocation.watchPosition(
        () => {
          void send(result.id);
        },
        () =>
          setError(
            "Live GPS cannot update until location permission is enabled.",
          ),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
      );
      await client.invalidateQueries({ queryKey: ["field-tracking"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start live tracking.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function stop(id: string) {
    setBusy(true);
    setError("");
    try {
      if (watch.current !== null) {
        navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
      }
      await api(`time/field-tracking/${id}`, { method: "DELETE" });
      setSession(null);
      await client.invalidateQueries({ queryKey: ["field-tracking"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not stop live tracking.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!entitled || (!enabled && !me.permissions.includes("fieldtracking.read")))
    return null;
  return (
    <div className="space-y-6">
      {employeeId && (
        <section className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Radio size={20} />
                Live field tracking
              </h2>
              <p className="muted text-sm mt-2">
                Tracking is off until you start it. Starting records your GPS
                only while this session is active and while you are checked in.
                It expires automatically.
              </p>
            </div>
            {session?.status === "ACTIVE" ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void stop(session.id)}
              >
                <Square />
                Stop tracking
              </Button>
            ) : (
              <Button disabled={busy || !enabled} onClick={() => void start()}>
                <Radio />
                Start live tracking
              </Button>
            )}
          </div>
          {session?.status === "ACTIVE" && (
            <p className="text-sm mt-4">
              <span className="badge positive">LIVE</span> Updates approximately
              every {intervalSeconds} seconds · ends{" "}
              {new Date(session.expiresAt).toLocaleString()}
            </p>
          )}
          {!enabled && (
            <p className="text-sm muted mt-3">
              Live field tracking has not been enabled by your administrator.
            </p>
          )}
          {error && (
            <p role="alert" className="error mt-4">
              {error}
            </p>
          )}
        </section>
      )}
      {me.permissions.includes("fieldtracking.read") && (
        <section className="card p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MapPin size={20} />
            Field employees on the move
          </h2>
          <p className="muted text-sm mt-2">
            Only active, consented sessions are shown. Locations refresh every
            15 seconds. Managers can view direct reports; HR can view the
            company.
          </p>
          {manager.error && (
            <p className="error mt-4">{manager.error.message}</p>
          )}
          <div className="table-scroll mt-4">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Last update</th>
                  <th>Location</th>
                  <th>Map</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(manager.data || [])
                  .filter((s) => s.status === "ACTIVE")
                  .map((s) => {
                    const point = s.points[0];
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.employee.firstName} {s.employee.lastName}
                          <div className="muted text-xs">
                            {s.employee.employeeCode} ·{" "}
                            {s.employee.branch?.name || "No location"}
                          </div>
                        </td>
                        <td>
                          <span className="badge positive">LIVE</span>
                        </td>
                        <td>
                          {s.lastSeenAt
                            ? new Date(s.lastSeenAt).toLocaleString()
                            : "Waiting"}
                        </td>
                        <td>
                          {point
                            ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)} ±${Math.round(point.accuracy)}m`
                            : "Waiting"}
                        </td>
                        <td>
                          {point ? (
                            <a
                              className="text-blue-700 underline"
                              href={map(point)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open map
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {me.permissions.includes("fieldtracking.manage") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void stop(s.id)}
                            >
                              Stop
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {!(manager.data || []).some((s) => s.status === "ACTIVE") && (
            <p className="empty">No active field tracking sessions.</p>
          )}
        </section>
      )}
    </div>
  );
}
