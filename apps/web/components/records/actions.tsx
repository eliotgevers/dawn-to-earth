import { ChangeImpact } from "@/components/engineering/change-impact";
import { NoteField, TextField, RecordEditor } from "./forms";
import { ConnectionLink } from "./links";
import { eventFindingConnection } from "@/lib/records/links";
import { CheckSquare, ClipboardCheck, Flag, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  type ComponentProps,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { assemblyActions, type AssemblyActionType, type WorkflowActionType, type RecordUnit, editableActions, sameUnit, workflowHistory, type RecordEntry, type RecordKind } from "@/lib/records/journal";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { addRecord } from "@/lib/workspace";
import { addDemoNote } from "@/app/(sections)/verification/actions";
import type { AssemblyRecord } from "@/db/records/assembly";
import { FormDialog, LabeledSelect } from "@/components/records/forms";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { VerificationTest } from "@/components/verification/model";

type RecordAction = Exclude<AssemblyActionType, "note"> | "review";
const appearance = {
  edit: { text: "Edit", Icon: Pencil },
  "edit-note": { text: "Edit", Icon: Pencil },
  remove: { text: "Delete", Icon: Trash2 },
  "remove-note": { text: "Delete", Icon: Trash2 },
  revise: { text: "Revise", Icon: Pencil },
  decide: { text: "Decision", Icon: CheckSquare },
  start: { text: "Start", Icon: Play },
  complete: { text: "Complete work", Icon: CheckSquare },
  flag: { text: "Flag", Icon: Flag },
  rework: { text: "Rework", Icon: RotateCcw },
  dispose: { text: "Record decision", Icon: CheckSquare },
  review: { text: "Review", Icon: ClipboardCheck },
} satisfies Record<RecordAction, { text: string; Icon: typeof Pencil }>;

export function RecordActionButton({
  action,
  iconOnly = false,
  textOverride,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & { action: RecordAction; iconOnly?: boolean; textOverride?: string }) {
  const { text: defaultText, Icon } = appearance[action];
  const text = textOverride ?? defaultText;
  const name = action === "review" ? "Review evidence" : assemblyActions[action].label;
  const buttonProps = {
    type: "button",
    variant: iconOnly ? "ghost" : "outline",
    size: iconOnly ? "icon-sm" : "sm",
    "aria-label": textOverride ?? name,
    className: iconOnly ? undefined : "bg-popover",
    ...props,
  } satisfies ComponentProps<typeof Button>;
  return iconOnly ? (
    <Tooltip>
      <TooltipTrigger render={<Button {...buttonProps}><Icon aria-hidden="true" /></Button>} />
      <TooltipContent role="tooltip">{action === "revise" ? "Edit" : text}</TooltipContent>
    </Tooltip>
  ) : (
    <Button {...buttonProps}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      <span>{text}</span>
    </Button>
  );
}

type WorkflowProps = {
  record: AssemblyRecord;
  status: string;
  displayedActivity?: string;
  unit?: RecordUnit;
  activity?: readonly RecordEntry[];
  closeoutBlocked?: boolean;
  nextAction?: ReactNode;
  children?: ReactNode;
};

export function AssemblyRecordActions({
  record,
  status,
  unit,
  activity = [],
  displayedActivity,
  closeoutBlocked,
  nextAction,
  children,
}: WorkflowProps) {
  const editor = useContext(RecordEditor);
  const { kind } = record;
  const actions = unit ? editableActions(kind, status).filter(type => type !== "complete" || !closeoutBlocked) : [];
  const history = workflowHistory(activity).filter(entry => entry.id !== displayedActivity);
  const activityList = history.length > 0 && (
    <ul className="mt-2.5 grid gap-2" aria-label="Record activity">
      {history.map((entry) => {
        const action = entry.action;
        return (
          <li key={entry.id} className="min-w-0">
            <strong className="text-sm">
              {assemblyActions[action.type].event}
              {action.outcome && ` · ${action.outcome}`}
            </strong>
            <span className="block mt-0.5 text-xs text-muted-foreground">
              {action.unit.serial} · {action.unit.revision} · {formatUtcDateTime(entry.recordedAt)}
            </span>
            <p className="mt-1 text-[13px] leading-normal text-muted-foreground wrap-anywhere">{entry.description}</p>
            {(action.type === "revise" || action.type === "rework" || action.type === "edit") && (
              <p className="mt-1 text-[13px] leading-normal text-muted-foreground wrap-anywhere">{entry.context}</p>
            )}
          </li>
        );
      })}
    </ul>
  );

  const controls = unit && actions.map(workflow => (
    <BaseDialog.Trigger key={workflow} handle={editor} payload={{ workflow, record, unit }} render={
      <RecordActionButton action={workflow}
        textOverride={workflow === "start" ? (status === "Ready to resume" ? "Resume work" : "Start work") : undefined} />
    } />
  ));

  return (
    <>
      {kind === "change" ? (
        <ChangeImpact record={record} controls={<>{controls}{nextAction}</>}>{children}</ChangeImpact>
      ) : <>
        {(!!controls?.length || nextAction) && <div className="flex flex-wrap items-center gap-1.5 pt-2 pb-0.5">{controls}{nextAction}</div>}
        {children}
      </>}
      {kind === "requirement" && activityList ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">Revision history</summary>
          {activityList}
        </details>
      ) : (
        activityList
      )}
    </>
  );
}

export type WorkflowTarget = { workflow: WorkflowActionType; record: AssemblyRecord; unit: RecordUnit };

export function WorkflowForm({ workflow: type, record, unit, onSaved }: WorkflowTarget & { onSaved: () => void }) {
  const router = useRouter();
  const saved = useRef(false);
  const labels = assemblyActions[type];
  const options = "outcomes" in labels ? labels.outcomes : undefined;
  async function submit(form: FormData) {
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const title = type === "flag" ? read("title") : record.title;
    const description = read("description");
    const context = "reason" in labels ? read("reason") : `${unit.serial} · ${unit.revision}`;
    const outcome = read("outcome") || undefined;
    if (!title || !description || !context || (options && !outcome)) return "Complete the required fields.";
    const result = await addRecord({ kind: labels.kind, title, description, context, action: { type, parentId: record.id, unit, outcome } });
    if (!result.record) return result.error ?? "Unable to save the record.";
    return () => {
      saved.current = true;
      onSaved();
      if (type === "complete") {
        const destination = new URL(window.location.href);
        destination.searchParams.set("view", "build");
        destination.searchParams.set("filter", "completed");
        destination.hash = record.id;
        router.replace(destination.pathname + destination.search + destination.hash, { scroll: false });
      }
    };
  }
  return (
    <FormDialog
      heading={labels.label}
      description={`${record.title} · ${unit.serial} · ${unit.revision}`}
      initialFocus
      finalFocus={() => saved.current ? document.getElementById(record.id)?.querySelector("summary") ?? true : true}
      onSubmit={submit}
    >
      {type === "flag" && (
        <TextField label="Issue title" name="title" maxLength={100} required />
      )}
      {options && (
        <LabeledSelect
          label="Outcome"
          name="outcome"
          placeholder="Choose an outcome"
          required
          options={options}
          align
        />
      )}
      <NoteField label={labels.note} name="description" rows={3} maxLength={1000} required />
      {"reason" in labels && (
        <NoteField label={labels.reason} name="reason" rows={2} maxLength={500} required />
      )}
    </FormDialog>
  );
}

type NoteTarget = { id: string; title: string; kind: RecordKind; test?: VerificationTest };

const newNote = Symbol("new note");
type PrivateNote = Pick<RecordEntry, "id" | "description" | "recordedAt">;

function readPrivateNotes(prefix: string): PrivateNote[] {
  const notes: PrivateNote[] = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(prefix)) continue;
    try {
      const note = JSON.parse(localStorage.getItem(key) ?? "null");
      if (typeof note?.description === "string" && typeof note.recordedAt === "string" && Number.isFinite(Date.parse(note.recordedAt))) {
        notes.push({ id: key.slice(prefix.length), description: note.description, recordedAt: note.recordedAt });
      }
    } catch {
      // One unreadable browser note must not hide other notes on the record.
    }
  }

  return notes.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export function RecordNotes({
  target,
  notes: sharedNotes,
  unit,
  compact,
  sharedDemo = false,
  allowSharedNote = true,
}: {
  target: NoteTarget;
  notes: readonly RecordEntry[];
  unit?: RecordUnit;
  compact?: boolean;
  sharedDemo?: boolean;
  allowSharedNote?: boolean;
}) {
  const [editing, setEditing] = useState<string | typeof newNote>();
  const [removing, setRemoving] = useState<string>();
  const headingId = `${target.id}-notes`;
  const [feedback, setFeedback] = useState("");
  const router = useRouter();
  const requestId = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const prefix = sharedDemo && unit ? `dawn:notes:${JSON.stringify([target.kind, target.id, unit.serial, unit.revisionId])}:` : undefined;
  const [browserNotes, setBrowserNotes] = useState<PrivateNote[]>([]);

  useEffect(() => {
    if (!prefix) return;

    function reload() {
      try {
        setBrowserNotes(readPrivateNotes(prefix!));
      } catch {
        setFeedback("Browser storage is unavailable. Allow storage to save a demo note.");
      }
    }

    reload();
    const changed = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(prefix)) reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [prefix]);

  const notes: readonly RecordEntry[] = sharedDemo && unit ? [...sharedNotes, ...browserNotes.map(note => ({
    ...target, ...note, context: target.title, action: { type: "note" as const, parentId: target.id, unit },
  }))] : sharedNotes;

  if (!notes.length && !unit) return null;

  function closeEditor() {
    setEditing(undefined);
    document.getElementById(headingId)?.focus();
  }

  async function amend(description: string, type: "note" | "edit-note" | "remove-note", note?: RecordEntry) {
    if (!unit || (note && !sameUnit(unit, note.action?.unit))) return;
    if (sharedDemo) {
      if (!prefix || pending.current || (note && !browserNotes.some(saved => saved.id === note.id))) return;
      pending.current = true;
      setSaving(true);
      try {
        if (note) {
          // Earlier browser-only notes stay on this device.
          const key = prefix + note.id;
          if (type === "remove-note") localStorage.removeItem(key);
          else localStorage.setItem(key, JSON.stringify({ description, recordedAt: note.recordedAt }));
          setBrowserNotes(readPrivateNotes(prefix));
        } else {
          if (!allowSharedNote) return;
          const result = await addDemoNote({ recordId: target.id, serial: unit.serial, revisionId: unit.revisionId }, {
            id: requestId.current ??= crypto.randomUUID(), description,
          });
          if (!result.saved) { setFeedback(result.error ?? "Unable to save the shared note."); return; }
          requestId.current = undefined;
          router.refresh();
        }
        closeEditor();
        setRemoving(undefined);
        setFeedback(note ? "Saved on this device." : "Shared demo note saved.");
      } catch {
        setFeedback("The change couldn’t be confirmed. Reopen the evidence before retrying.");
      } finally {
        setSaving(false);
        pending.current = false;
      }
      return;
    }

    const result = await addRecord({
      kind: target.kind,
      test: target.test,
      title: target.title,
      description,
      context: `${unit.serial} · ${unit.revision}`,
      action: { type, parentId: target.id, unit },
      noteId: note?.id,
    });
    if (!result.record) {
      setFeedback(result.error ?? "Unable to save this note.");
      return;
    }
    closeEditor();
    setRemoving(undefined);
    setFeedback(type === "remove-note" ? "Note deleted." : "Note saved.");
  }

  function editor(note?: RecordEntry) {
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const description = String(new FormData(event.currentTarget).get("description") ?? "").trim();
      if (!description) {
        setFeedback("Enter a note.");
        return;
      }
      amend(description, note ? "edit-note" : "note", note);
    }
    return (
      <form className="grid max-w-[650px] gap-2" onSubmit={submit}>
        <NoteField label="Note" name="description" rows={2} maxLength={1000} required defaultValue={note?.description} autoFocus />
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={closeEditor}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} size="sm">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className="mt-2.5 grid gap-2 [&>button]:justify-self-start" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className={compact && !notes.length ? "sr-only" : "scroll-mt-[calc(var(--header)+12px)] text-[13px] font-semibold"}>
        {compact ? "Entry notes" : "Notes"}
      </h3>
      {sharedDemo && unit && allowSharedNote && <p className="text-xs text-muted-foreground">New notes are visible to everyone in this demo.</p>}
      {notes.length > 0 && (
        <ul className="grid gap-2" aria-label="Notes">
          {notes.map((note) => {
            if (editing === note.id) return <li key={note.id}>{editor(note)}</li>;
            const privateNote = sharedDemo && browserNotes.some(saved => saved.id === note.id);
            const writable = unit && (sharedDemo ? privateNote : !note.eventFinding && sameUnit(unit, note.action?.unit));
            return (
              <li key={note.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="wrap-anywhere">{note.description}</p>
                    <span className="block mt-0.5 text-xs text-muted-foreground">
                      {privateNote && "Saved on this device · "}{note.context === "Shared demo note" && "Demo visitor · "}{note.eventFinding && `${note.context} · `}{note.action?.unit.serial} · {formatUtcDateTime(note.recordedAt)}
                    </span>
                  </div>
                  {note.eventFinding && note.action && (
                    <ConnectionLink sourceId={target.id} connection={eventFindingConnection(
                      note.id, note.action.parentId, note.action.unit, note.eventFinding.basis.correlation,
                    )} />
                  )}
                  {writable && removing !== note.id && (
                    <div className="flex shrink-0 items-center gap-0.5 max-[550px]:[&_button]:w-[27px] max-[550px]:[&_button]:px-0">
                      <RecordActionButton
                        action="edit-note"
                        iconOnly
                        onClick={() => {
                          setFeedback("");
                          setEditing(note.id);
                        }}
                      />
                      <RecordActionButton action="remove-note" iconOnly onClick={() => setRemoving(note.id)} />
                    </div>
                  )}
                </div>
                {writable && removing === note.id && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="text-sm">Delete this note?</span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      autoFocus
                      onClick={() => amend("Note deleted.", "remove-note", note)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        const row = event.currentTarget.closest("li");
                        setRemoving(undefined);
                        requestAnimationFrame(() =>
                          row?.querySelector<HTMLButtonElement>('[aria-label="Delete note"]')?.focus(),
                        );
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing === newNote
        ? editor()
        : unit && (!sharedDemo || allowSharedNote) && (
            <Button
              type="button"
              variant="outline"
              className="bg-popover"
              size="sm"
              onClick={() => {
                setFeedback("");
                requestId.current = undefined;
                setEditing(newNote);
              }}
            >
              {compact ? "Add entry note" : "Add note"}
            </Button>
          )}
      <p role="status" className="text-xs text-muted-foreground empty:absolute">
        {feedback}
      </p>
    </section>
  );
}
