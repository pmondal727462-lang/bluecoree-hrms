"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { moduleAllowed } from "@/lib/module-access";
import type { Me } from "@/types/ui";

type Progress = {
  steps: { key: string; title: string; done: boolean; href: string }[];
  completed: number;
  dismissed: boolean;
};

// Guided setup for a new company; hidden once complete or dismissed.
export function SetupChecklist({
  canDismiss,
  subscription,
}: {
  canDismiss: boolean;
  subscription: Me["subscription"];
}) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["setup-progress"],
    queryFn: () => api<Progress>("setup-progress"),
  });
  const source = data.data;
  const steps =
    source?.steps.filter((s) => moduleAllowed(subscription, s.href)) ?? [];
  const p = source && {
    ...source,
    steps,
    completed: steps.filter((s) => s.done).length,
  };
  if (!p || p.dismissed || p.completed === p.steps.length) return null;
  return (
    <section className="card p-5 mb-6">
      <div className="flex justify-between items-center gap-3 mb-3">
        <h2 className="font-semibold">
          Set up your company ({p.completed}/{p.steps.length})
        </h2>
        {canDismiss && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await api("setup-progress/dismiss", { method: "POST" });
              await client.invalidateQueries({ queryKey: ["setup-progress"] });
            }}
          >
            Hide
          </Button>
        )}
      </div>
      <ol className="space-y-2 text-sm">
        {p.steps.map((s) => (
          <li key={s.key} className="flex gap-2">
            <span aria-hidden>{s.done ? "✓" : "○"}</span>
            {s.done ? (
              <span className="muted line-through">{s.title}</span>
            ) : (
              <Link className="underline" href={s.href}>
                {s.title}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
