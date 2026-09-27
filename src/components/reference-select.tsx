"use client";
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Named } from "@/types/ui";
import { Button } from "./ui/button";

type Result = { items: Named[]; total: number; selected: Named | null };
export function ReferenceSelect({
  resource,
  label,
  value,
  onChange,
  required,
  excludeId,
}: {
  resource: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  excludeId?: string;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    search: query,
    page: String(page),
    pageSize: "25",
    ...(value ? { selectedId: value } : {}),
    ...(excludeId ? { excludeId } : {}),
  });
  const { data, error, isFetching } = useQuery({
    queryKey: ["references", resource, query, page, value, excludeId],
    queryFn: () => api<Result>(`references/${resource}?${params}`),
  });
  const options = data?.items ?? [];
  const current = data?.selected;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {label}
        {required ? " *" : ""}
      </legend>
      <input
        aria-label={`Search ${label}`}
        value={search}
        maxLength={150}
        placeholder="Search by name or code"
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        id={id}
        aria-label={label}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {value && !options.some((o) => o.id === value) && (
          <option value={value}>{current?.name ?? "Current selection"}</option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2 text-xs">
        <Button
          type="button"
          variant="outline"
          disabled={page === 1 || isFetching}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span aria-live="polite">
          {isFetching
            ? "Loading…"
            : `${data?.total ?? 0} matches · Page ${page}`}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={!data || page * 25 >= data.total || isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}
