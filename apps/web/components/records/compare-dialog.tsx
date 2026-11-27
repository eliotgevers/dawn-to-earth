"use client";

import { GitCompareArrows } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function CompareDialog({ title, children, open, onOpen, onClose, triggerLabel = "Compare" }: {
  title: string;
  triggerLabel?: string;
  children: ReactNode;
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  return <Dialog open={open} onOpenChange={next => { if (next) onOpen?.(); else onClose?.(); }}>
    <DialogTrigger render={<Button size="sm" variant="outline" className="w-fit bg-popover" />}>
      <GitCompareArrows aria-hidden="true" data-icon="inline-start" />
      {triggerLabel}
    </DialogTrigger>
    <DialogContent className="sm:max-w-5xl">
      <DialogHeader className="pr-7">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

export function CompareFields({ referenceLabel, proposedLabel, fields }: {
  referenceLabel: string;
  proposedLabel: string;
  fields: ReadonlyArray<{ id: string; label: ReactNode; before?: string | null; after?: string | null }>;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changed = fields.filter(field => (field.before ?? "") !== (field.after ?? ""));
  const visible = showUnchanged ? fields : changed;
  return <div className="grid min-w-0 gap-3">
    {visible.length ? <>
      <div aria-hidden="true" className="hidden grid-cols-2 gap-6 text-sm font-semibold sm:grid">
        <span>{referenceLabel}</span><span>{proposedLabel}</span>
      </div>
      <dl className="divide-y border-y">
        {visible.map(field => <div key={field.id} className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-2">
          <dt className="text-sm font-semibold sm:col-span-2">{field.label}</dt>
          {[field.before, field.after].map((value, index) => <dd key={index} className="min-w-0">
            <span className="block text-xs text-muted-foreground sm:sr-only">{index === 0 ? referenceLabel : proposedLabel}</span>
            <span className="whitespace-pre-wrap wrap-anywhere">{value || "Unavailable"}</span>
          </dd>)}
        </div>)}
      </dl>
    </> : <p className="text-sm text-muted-foreground">{fields.length ? "No fields changed." : "No fields are available to compare."}</p>}
    {changed.length < fields.length && <label className="flex w-fit items-center gap-2 text-sm">
      <input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />
      Show unchanged fields
    </label>}
  </div>;
}
