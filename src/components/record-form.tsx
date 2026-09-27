"use client";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "./ui/button";
import type { Field } from "@/types/ui";
import { ReferenceSelect } from "./reference-select";
export function RecordForm({
  fields,
  initial = {},
  onSave,
  onCancel,
  submitLabel = "Save changes",
  children,
}: {
  fields: Field[];
  initial?: Record<string, unknown>;
  onSave: (values: Record<string, string>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  children?: React.ReactNode;
}) {
  const defaults = Object.fromEntries(
    fields.map((f) => [
      f.key,
      initial[f.key] === null || initial[f.key] === undefined
        ? ""
        : String(initial[f.key]).slice(0, f.type === "date" ? 10 : undefined),
    ]),
  );
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Record<string, string>>({ defaultValues: defaults });
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          await onSave(values);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div className="form-grid">
        {fields.map((f, index) => (
          <div key={f.key} className={f.type === "textarea" ? "full" : ""}>
            {f.section &&
              (index === 0 || fields[index - 1].section !== f.section) && (
                <p className="subheading mb-4">{f.section}</p>
              )}
            {f.reference ? (
              <Controller
                name={f.key}
                control={control}
                render={({ field }) => (
                  <ReferenceSelect
                    resource={f.reference!}
                    label={f.label}
                    required={f.required}
                    excludeId={f.excludeId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            ) : (
              <label>
                {f.label}
                {f.required ? " *" : ""}
                {f.type === "select" ? (
                  <select {...register(f.key)} required={f.required}>
                    <option value="">Select…</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    maxLength={f.maxLength ?? 500}
                    {...register(f.key)}
                    required={f.required}
                  />
                ) : (
                  <input
                    type={f.type || "text"}
                    required={f.required}
                    min={f.type === "number" ? 0 : undefined}
                    maxLength={f.type === "password" ? 72 : 500}
                    autoComplete={
                      f.type === "password" ? "new-password" : undefined
                    }
                    {...register(f.key)}
                  />
                )}
              </label>
            )}
          </div>
        ))}
      </div>
      {children}
      {error && (
        <div role="alert" className="error mt-5">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-3 mt-7">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
