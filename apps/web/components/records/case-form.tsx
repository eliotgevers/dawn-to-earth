import { useEffect, useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PersonField, FormDialog } from "@/components/records/forms";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkEvent } from "@/db/workflows/cases";

export function useCaseForm(submit: ToolProps["submit"]) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState({ error: "", message: "" });
  function setError(error: string) {
    setStatus({ error, message: error });
  }
  function record(command: Parameters<typeof submit>[0], onSaved?: (eventId: string) => void, message = "") {
    if (pending) return;
    setError("");
    start(async () => {
      const result = await submit(command);
      if (result.eventId === undefined) return setError(result.error);
      setStatus({ error: "", message });
      onSaved?.(result.eventId);
    });
  }
  function recordForm(event: FormEvent<HTMLFormElement>, action: string, data: Record<string, unknown>,
    message: string, onSaved?: (id: string) => void) {
    event.preventDefault();
    const { actor, ...fields } = Object.fromEntries(new FormData(event.currentTarget));
    if (typeof actor !== "string" || !actor) return setError("Choose the person recording this action.");
    record({ action, actor, data: { ...fields, ...data } }, onSaved, message);
  }
  return { pending, ...status, setError, record, recordForm };
}

// Keep the user's selection order when an existing row is revised.
export function useDraftRows<T>(initial?: () => [string, T][]) {
  const [rows, setRows] = useState(() => new Map(initial?.()));
  function update(id: string, row?: T) {
    setRows(previous => {
      const next = new Map(previous);
      if (row === undefined) next.delete(id);
      else next.set(id, row);
      return next;
    });
  }
  return { rows, update, clear: () => setRows(new Map()) };
}

type Decision = { action: string; data: Record<string, unknown> };
type Fields = Record<string, FormDataEntryValue>;

export function DecisionDialog({
  heading, description, command, people, submit, onOpen, saved, showRole, children, ...button
}: {
  heading: string; description: string; people: ToolProps["workspace"]["actors"]; submit: ToolProps["submit"];
  command: Decision | ((fields: Fields) => Decision | string);
  onOpen?: () => void; saved: (id: string) => void; showRole?: boolean; children: ReactNode;
} & Pick<ComponentProps<typeof Button>, "variant" | "disabled" | "aria-label">) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={next => {
      if (pending) return;
      if (next) onOpen?.();
      setOpen(next);
    }}>
      <DialogTrigger render={<Button type="button" size="sm" className="w-fit" {...button} />}>{heading}</DialogTrigger>
      {open && <FormDialog heading={heading} description={description} onPendingChange={setPending}
        className="max-h-[85dvh] overflow-y-auto" onSubmit={async form => {
          const { actor, ...fields } = Object.fromEntries(form);
          if (!actor) return "Choose who is recording this action.";
          const decision = typeof command === "function" ? command(fields) : command;
          if (typeof decision === "string") return decision;
          const result = await submit({ actor: String(actor), action: decision.action, data: { ...fields, ...decision.data } });
          if (result.eventId === undefined) return result.error;
          return () => {
            setOpen(false);
            saved(result.eventId);
          };
        }}>
        {children}
        <PersonField people={people} name="actor" required showRole={showRole} />
      </FormDialog>}
    </Dialog>
  );
}

// A save can replace its trigger. Wait for the persisted event before focusing its row.
export function useDecisionFocus(events: readonly WorkEvent[], preventScroll = false) {
  const [target, setTarget] = useState<{ event: string; id: string }>();
  useEffect(() => {
    if (!target || !events.some(event => event.id === target.event)) return;
    const frame = requestAnimationFrame(() => {
      const node = document.getElementById(target.id);
      if (!node) return;
      const disclosure = node.closest("details");
      if (disclosure) disclosure.open = true;
      node.focus({ preventScroll });
      setTarget(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, events, preventScroll]);
  return (event: string, id = event) => setTarget({ event, id });
}
