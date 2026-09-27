"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm" />
        <DialogPrimitive.Content className="modal-content">
          <DialogPrimitive.Title className="text-xl font-bold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 mb-6 text-sm text-[var(--secondary)]">
            {description ||
              "Complete the details below. Required fields are marked with *."}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            className="absolute right-5 top-5 rounded p-1 hover:bg-[var(--muted)]"
            aria-label="Close dialog"
          >
            <X size={20} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
