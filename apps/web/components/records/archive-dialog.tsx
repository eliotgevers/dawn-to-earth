"use client";

import { ScanSearch } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ArchiveDialog({ id, label, title, description, pinned, clearOnClose, onOpen, compact, children }: {
  id?: string; label: string; title: string; description: string; pinned: boolean;
  clearOnClose?: string[]; onOpen?: () => void; compact?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <Dialog open={pinned || open} onOpenChange={next => {
    setOpen(next);
    if (next) onOpen?.();
    else if (clearOnClose?.length) {
      const url = new URL(window.location.href);
      for (const key of clearOnClose) url.searchParams.delete(key);
      window.history.replaceState(null, "", url);
    }
  }}>
    <DialogTrigger id={id} render={<Button ref={trigger} size="sm" variant="outline" className="w-fit bg-popover" />}>
      <ScanSearch data-icon="inline-start" aria-hidden="true" />{label}
    </DialogTrigger>
    <DialogContent finalFocus={trigger} className={`max-h-[90dvh] min-w-0 overflow-y-auto ${compact ? "sm:max-w-3xl" : "sm:max-w-4xl"}`}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}
