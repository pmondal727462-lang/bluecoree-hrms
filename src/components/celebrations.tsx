"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

type Event = {
  employeeId: string;
  name: string;
  kind: string;
  years: number | null;
  myWish: string | null;
  wishes: { emoji: string; count: number }[];
};
export function Celebrations() {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["celebrations"],
    queryFn: () => api<{ today: string; events: Event[] }>("celebrations"),
    refetchInterval: 60000,
  });
  return (
    <section className="card p-6 mb-6">
      <h2 className="text-lg font-semibold">🎉 Team celebrations</h2>
      <p className="muted text-sm mt-1">
        Today’s birthdays and work anniversaries. Send a wish to your
        colleagues.
      </p>
      {(error || query.error) && (
        <p role="alert" className="error mt-3">
          {error || query.error?.message}
        </p>
      )}
      {!query.data ? (
        <p className="muted mt-4">Loading celebrations…</p>
      ) : !query.data.events.length ? (
        <p className="muted mt-4">
          No celebrations today. We’ll show the next special day here.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          {query.data.events.map((e) => (
            <article
              key={`${e.employeeId}:${e.kind}`}
              className="rounded-xl border border-[var(--border)] p-4"
            >
              <h3 className="font-semibold">
                {e.kind === "BIRTHDAY" ? "🎂" : "🏆"} {e.name}
              </h3>
              <p className="muted text-sm mt-1">
                {e.kind === "BIRTHDAY"
                  ? "Happy birthday!"
                  : `${e.years} year${e.years === 1 ? "" : "s"} with the team`}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {e.wishes.map((w) => (
                  <button
                    key={w.emoji}
                    type="button"
                    aria-label={`Wish ${e.name} ${w.emoji}`}
                    aria-pressed={e.myWish === w.emoji}
                    disabled={saving}
                    className={`rounded-full border px-3 py-2 text-lg ${e.myWish === w.emoji ? "bg-blue-100 border-blue-500" : "border-[var(--border)]"}`}
                    onClick={async () => {
                      setSaving(true);
                      setError("");
                      try {
                        await api("celebrations", {
                          method: "POST",
                          body: JSON.stringify({
                            employeeId: e.employeeId,
                            kind: e.kind,
                            emoji: w.emoji,
                          }),
                        });
                        await client.invalidateQueries({
                          queryKey: ["celebrations"],
                        });
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {w.emoji} <span className="text-xs">{w.count}</span>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
