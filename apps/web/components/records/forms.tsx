import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { fieldLabel, noteField, shortNoteField, textField } from "@/components/records/presentation";
import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type ReactNode,
  type Ref,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ImpactRecord,
  requirementDraft,
  requirementLinkOptions,
} from "@/components/engineering/records";
import { methods, type VerificationTest } from "@/components/verification/model";
import { addRecord } from "@/lib/workspace";
import { unitSelection, type ItemSelection, type SelectedItem } from "@/components/workspace/selection";
import { assemblyActions, type RecordUnit, recordKinds, primaryFields, type RecordEntry, type RecordKind } from "@/lib/records/journal";
import { recordUnitLabel } from "@/lib/records/links";
import type { AssemblyRecord, WorkspaceRecords } from "@/db/records/assembly";
import { RecordActionButton, WorkflowForm, type WorkflowTarget } from "@/components/records/actions";
import { recordValues } from "@/components/records/schema";

type Label = { label: ReactNode; labelClassName?: string };

export function TextField({ label, labelClassName, ...props }: ComponentProps<typeof Input> & Label) {
  return <label className={cn(fieldLabel, labelClassName)}>{label}<Input className={textField} {...props} /></label>;
}

export function NoteField({ label, labelClassName, ...props }: ComponentProps<typeof Textarea> & Label) {
  return <label className={cn(fieldLabel, labelClassName)}>{label}<Textarea className={noteField} {...props} /></label>;
}

export type SelectOption<Value extends string = string> = { value: Value; label: string; category?: string };

export function LabeledSelect<Value extends string, Multiple extends boolean = false>({
  label, options: choices, onChange, placeholder, required, trigger, display, children, align, ...control
}: Pick<ComponentProps<typeof Select<Value, Multiple>>, "name" | "value" | "defaultValue" | "disabled" | "multiple"> & {
  label: ReactNode;
  options: readonly (SelectOption<Value> | Value)[];
  onChange?: ComponentProps<typeof Select<Value, Multiple>>["onValueChange"];
  display?: string;
  placeholder?: string;
  required?: boolean;
  trigger?: Ref<HTMLButtonElement>;
  align?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const options = choices.map(choice => typeof choice === "string" ? { value: choice, label: choice, category: undefined } : choice);
  return (
    <div className={fieldLabel}>
      <label htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      <Select<Value, Multiple> {...control} items={options} onValueChange={onChange}>
        <SelectTrigger
          ref={trigger}
          id={id}
          aria-labelledby={`${id}-label`}
          className="data-[size=default]:h-9 w-full min-w-0 cursor-pointer rounded-md bg-popover px-2"
          aria-required={required}
        >
          <SelectValue className="min-w-0 overflow-hidden"
            placeholder={placeholder ?? (typeof label === "string" ? `Choose ${label.toLowerCase()}` : undefined)}
          >
            {display === undefined ? undefined : () => display}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={align ?? false} className="min-w-0 [&_[data-slot=select-item]>span:first-child]:min-w-0 [&_[data-slot=select-item]>span:first-child]:shrink [&_[data-slot=select-item]>span:first-child]:whitespace-normal">
          {Array.from(Map.groupBy(options, option => option.category ?? ""), ([label, entries]) => (
            <SelectGroup key={label}>
              {label && <SelectLabel>{label}</SelectLabel>}
              {entries.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  );
}

type PersonProps<Id extends string> = Pick<
  ComponentProps<typeof LabeledSelect<Id>>, "name" | "defaultValue" | "value" | "onChange" | "required" | "disabled" | "placeholder"
> & {
  people: readonly { id: Id; name: string; role?: string }[];
  label?: string;
  showRole?: boolean;
};

export function PersonField<Id extends string>({
  people, label = "Recorded by", placeholder = "Choose a person", showRole, ...field
}: PersonProps<Id>) {
  const options = people.map(person => ({
    value: person.id,
    label: showRole && person.role ? `${person.name} · ${person.role}` : person.name,
  }));
  return <LabeledSelect {...field} label={label} placeholder={placeholder} options={options} />;
}

type ContentProps = Pick<ComponentProps<typeof DialogContent>, "initialFocus" | "finalFocus" | "className">;

type SubmitResult = string | (() => void) | void;

export function FormDialog({
  heading,
  description,
  hideDescription,
  onPendingChange,
  onSubmit,
  submit = "Save",
  variant,
  children,
  ...content
}: ContentProps & {
  heading: string;
  description: ReactNode;
  hideDescription?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSubmit: (fields: FormData) => SubmitResult | Promise<SubmitResult>;
  submit?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  children?: ReactNode;
}) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const active = useRef(false);

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    active.current = true;
    setSubmitting(true);
    onPendingChange?.(true);
    setFeedback("");
    const fields = new FormData(form);
    Promise.resolve().then(() => onSubmit(fields)).then(result => {
      if (!form.isConnected) return;
      if (typeof result === "string") setFeedback(result);
      else result?.();
    }).catch(() => {
      if (form.isConnected) setFeedback("Unable to confirm the save. Check the record before retrying.");
    }).finally(() => {
      active.current = false;
      setSubmitting(false);
      onPendingChange?.(false);
    });
  }

  return (
    <DialogContent showCloseButton={false} {...content}>
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription className={hideDescription ? "sr-only" : undefined}>{description}</DialogDescription>
      </DialogHeader>
      <form className="grid max-w-[680px] gap-2.5 [&_textarea]:min-h-[78px]" onChange={() => feedback && setFeedback("")} onSubmit={submitForm}>
        {children}
        {feedback && (
          <p className="text-xs text-muted-foreground empty:absolute" role="alert">
            {feedback}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={submitting} variant={variant}>
            {submit}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

type MaintenanceEntry = (
  | Pick<RecordEntry, "id" | "title" | "kind" | "description" | "context" | "primary">
  | AssemblyRecord
) & Pick<RecordEntry, "test" | "evidenceType" | "currentState" | "designKind"> & Pick<AssemblyRecord, "impacts">;

type RecordDialogProps =
  | {
      type: "add";
      kind: RecordKind;
      test?: VerificationTest;
      isInterface?: boolean;
      units: readonly RecordUnit[];
      requireUnitChoice?: boolean;
      onSaved: (record: RecordEntry) => void;
    }
  | {
      type: "edit";
      entry: MaintenanceEntry;
      unit: RecordUnit;
    }
  | ({
      type: "remove";
      entry: Pick<MaintenanceEntry, "id" | "title" | "kind" | "test">;
      retentionReason?: string;
      onSaved?: () => void;
    } & ({ unit: RecordUnit } | { units: readonly RecordUnit[] }))
  | {
      type: "revise";
      record: AssemblyRecord;
      seed: WorkspaceRecords;
      item?: SelectedItem;
      unit: RecordUnit;
      saved?: RecordEntry;
    };

const removalLabels = {
  build: {
    verb: "Archive", title: "Archive build",
    explanation: "Move this build to Archived. Its exact link, work history and notes remain available.",
  },
  evidence: {
    verb: "Delete", title: "Delete evidence",
    explanation: "Remove this evidence from active records and new reviews. Its exact link and history remain available.",
  },
  record: {
    verb: "Remove", title: "Remove",
    explanation: "Remove this record from the active list. Its exact link and activity remain available.",
  },
};

function prepareDialog(action: RecordDialogProps) {
  switch (action.type) {
    case "add": {
      const labels = recordKinds[action.kind];
      return action.isInterface
        ? { ...action, heading: "Add interface", label: "Add interface" }
        : { ...action, heading: labels.dialogTitle, label: labels.addLabel };
    }
    case "edit":
      return { ...action, heading: assemblyActions.edit.label, label: `Edit ${action.entry.title}` };
    case "revise":
      return { ...action, heading: assemblyActions.revise.label, label: assemblyActions.revise.label };
    case "remove": {
      const { kind } = action.entry;
      const removal = removalLabels[kind === "queue" || kind === "build" ? "build" : kind === "evidence" ? kind : "record"];
      return { ...action, heading: removal.title, label: `${removal.verb} ${action.entry.title}`, removal };
    }
  }
}

export function RecordDialog(action: RecordDialogProps) {
  const editor = useContext(RecordEditor);
  const payload = prepareDialog(action);
  const { label } = payload;
  const removal = payload.type === "remove" ? payload.removal : undefined;
  return <BaseDialog.Trigger handle={editor} payload={payload} render={action.type === "add"
    ? <Button variant="outline" className="bg-popover" type="button" aria-label={label} />
    : <RecordActionButton action={action.type} iconOnly aria-label={label}
        textOverride={removal?.verb === "Archive" ? "Archive" : undefined}
        className={removal && "hover:text-destructive"} />
  }>{action.type === "add" ? "Add" : undefined}</BaseDialog.Trigger>;
}

type RecordRequest = ReturnType<typeof prepareDialog>;
export const RecordEditor = createContext<ReturnType<typeof BaseDialog.createHandle<RecordRequest | WorkflowTarget>> | undefined>(undefined);

type Saved = (record: RecordEntry) => void;
type ImpactChoices = (unit?: RecordUnit) => readonly ImpactRecord[];

async function saveRecord(input: Parameters<typeof addRecord>[0], onSaved: Saved) {
  const { record, error } = await addRecord(input);
  return record ? () => onSaved(record) : error ?? "Unable to save the record.";
}

// The selected trigger supplies the exact operation and its unit to the list's one open editor.
export function RecordDialogs({ children, impactChoices }: { children: ReactNode; impactChoices?: ImpactChoices }) {
  const [editor] = useState(() => BaseDialog.createHandle<RecordRequest | WorkflowTarget>());
  const [notice, setNotice] = useState<string | null>("");
  function saved(action: RecordDialogProps, record: RecordEntry) {
    setNotice(action.type === "add" ? recordKinds[action.kind].saved :
      action.type === "remove" ? "Removed from the active list." : "Saved to the workspace.");
    if ("onSaved" in action) action.onSaved?.(record);
  }
  return <RecordEditor value={editor}>
    {children}
    <BaseDialog.Root handle={editor} open={notice === null} onOpenChange={open => setNotice(open ? null : "")}>
      {({ payload }) => notice === null && payload && ("workflow" in payload ? <WorkflowForm {...payload} onSaved={() => setNotice("Saved to the workspace.")} />
        : payload.type === "remove" ? <RemoveRecord action={payload} onSaved={record => saved(payload, record)} />
        : <RecordForm action={payload} impactChoices={impactChoices} onSaved={record => saved(payload, record)} />)}
    </BaseDialog.Root>
    <span className="sr-only" role="status">{notice}</span>
  </RecordEditor>;
}

// All mutations need one exact serial and revision, including removing a shared requirement.
function useRecordTarget(action: RecordDialogProps, onChange?: () => void) {
  const [serial, setSerial] = useState<ItemSelection | null>(null);
  const adding = action.type === "add";
  const targets = "units" in action ? action.units.map(unit => ({
    value: unitSelection(unit.serial, unit.revisionId), label: recordUnitLabel(unit), unit,
  })) : [];
  const chooseUnit = targets.length > 1 || (adding && action.requireUnitChoice);
  const unit = "unit" in action ? action.unit : chooseUnit
    ? targets.find(target => target.value === serial)?.unit : action.units[0];
  const scope = recordUnitLabel(unit) ?? "Choose the serial to remove from the active list.";
  const description = adding
    ? unit ? `${scope}. This record will be saved to the workspace.` : "Choose the exact serial for this record."
    : "entry" in action ? `${action.entry.title} · ${scope}` : scope;
  const serialField = chooseUnit && <LabeledSelect
    label="Serial number" placeholder="Choose a serial" required options={targets} value={serial}
    onChange={value => { setSerial(value); onChange?.(); }}
  />;
  return { unit, description, serialField };
}

function RemoveRecord({ action, onSaved }: { action: Extract<RecordRequest, { type: "remove" }>; onSaved: Saved }) {
  const { unit, description, serialField } = useRecordTarget(action);
  const { removal } = action;
  const { id, title, kind, test } = action.entry;
  if (action.retentionReason) return <DialogContent>
    <DialogHeader>
      <DialogTitle>{kind === "evidence" ? "Evidence must be retained" : "Resolve the linked issue"}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    <p className="text-sm">{action.retentionReason}</p>
  </DialogContent>;
  return <FormDialog heading={action.heading} description={description} submit={removal.verb} variant="destructive"
    className="max-h-[85dvh] overflow-y-auto" onSubmit={() => unit ? saveRecord({
      kind, test, title, description: "Removed from the active list.", context: recordUnitLabel(unit),
      action: { type: "remove", parentId: id, unit },
    }, onSaved) : "Complete the required fields."}>
    {serialField}
    <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{removal.explanation}</p>
  </FormDialog>;
}

// Archived destinations stay removable in an edit but never appear as candidates for a new link.
function recordLinkField(
  action: Exclude<RecordRequest, { type: "remove" }>, kind: RecordKind, unit: RecordUnit | undefined,
  selected: readonly string[], changed: boolean, availableChoices?: ImpactChoices,
) {
  if (action.type === "revise") {
    return {
      options: requirementLinkOptions(action.record, action.seed, action.item, action.saved?.requirementRevision?.links ?? []),
      display: selected.length ? `${selected.length} linked` : "Choose records",
      label: "Applicable record links",
    };
  }
  if (kind !== "change") return { options: [] };
  const entry = action.type === "edit" ? action.entry : undefined;
  const available = availableChoices?.(unit) ?? [];
  const options = new Map<string, Omit<ImpactRecord, "category"> & { category: string }>(
    available.map(option => [option.value, option]),
  );
  const checked = new Set(selected);
  for (const { id, section, target } of entry?.impacts ?? []) {
    if (checked.has(id) && options.get(id)?.section !== section)
      options.set(id, { value: id, section, label: target?.title ?? id, category: "Previously linked" });
  }
  const impacts = action.type === "add" || changed ? selected.flatMap(id => {
    const option = options.get(id);
    return option ? [{ id, section: option.section }] : [];
  }) : undefined;
  return {
    options: [...options.values()], impacts,
    display: selected.length ? `${selected.length} selected` : "Link requirements, interfaces, or builds",
    label: <>Affected records <span className="font-normal text-muted-foreground">(optional)</span></>,
  };
}

// Existing production records may be missing fields that are required on new records.
function editorFields(action: Exclude<RecordRequest, { type: "remove" }>) {
  const adding = action.type === "add";
  const entry = action.type === "edit" ? action.entry : undefined;
  const revision = action.type === "revise" ? requirementDraft(action.record, action.saved) : undefined;
  const kind = adding ? action.kind : entry?.kind ?? "requirement";
  const test = adding ? action.test : entry?.test;
  const isInterface = adding ? action.isInterface : entry?.designKind === "interface";
  const defaults: Readonly<Record<string, string | undefined>> =
    revision?.values ?? (entry ? { ...recordValues(entry), title: entry.title } : {});
  const fields = [
    { name: "title", label: isInterface ? "Interface name" : recordKinds[kind].title, required: true, limit: 100, multiline: false },
    ...primaryFields(kind, isInterface).map(field => ({
      ...field,
      required: field.required && !(entry && recordKinds[kind].section === "production" && !defaults[field.name]),
    })),
  ];
  return { kind, test, isInterface, fields, defaults, evidenceType: entry?.evidenceType,
    links: revision?.links ?? entry?.impacts?.map(impact => impact.id) ?? [] };
}

function RecordForm({ action, onSaved, impactChoices }: {
  action: Exclude<RecordRequest, { type: "remove" }>; onSaved: Saved; impactChoices?: ImpactChoices;
}) {
  const [changedLinks, setLinks] = useState<string[]>();
  const saved = useRef(false);
  const { unit, description, serialField } = useRecordTarget(action, () => setLinks([]));
  const adding = action.type === "add";
  const revising = action.type === "revise";
  const { kind, test, isInterface, fields, defaults, evidenceType, links: initialLinks } = editorFields(action);
  const links = changedLinks ?? initialLinks;
  const { options, display, label, impacts } = recordLinkField(action, kind, unit, links, changedLinks !== undefined, impactChoices);

  function submit(form: FormData) {
    if (!unit) return adding ? "Choose the exact serial for this record." : "Complete the required fields.";
    if (impacts && impacts.length !== links.length) {
      setLinks(impacts.map(({ id }) => id));
      return "An affected record changed. Check the links before saving.";
    }
    const read = (name: string) => String(form.get(name) ?? "").trim();
    const values = Object.fromEntries(fields.map(({ name }) => [name, read(name)]));
    const { title, description = "", context = "", currentState, ...primary } = values;
    const evidenceType = read("evidenceType");
    const reason = read("reason");
    if ((test && !evidenceType) || fields.some(field => field.required && !values[field.name]) || (revising && !reason))
      return revising ? "Enter the name, statement and reason." : "Complete the required fields.";

    if (action.type === "revise") return saveRecord({
      kind: "requirement", title, description, context: reason,
      action: { type: "revise", parentId: action.record.id, unit },
      requirementRevision: { criterion: context, method: primary.verificationMethod, source: primary.source, links },
    }, onSaved);

    return saveRecord({
      kind, test, title, description, context, currentState: currentState || undefined, primary,
      unit: adding ? unit : undefined,
      action: action.type === "edit" ? { type: "edit", parentId: action.entry.id, unit } : undefined,
      evidenceType: evidenceType || undefined, designKind: isInterface ? "interface" : undefined, impacts,
    }, record => { saved.current = true; onSaved(record); });
  }

  return (
    <FormDialog
      heading={action.heading}
      description={description}
      onSubmit={submit}
      initialFocus={adding || undefined}
      finalFocus={adding ? () => !saved.current : undefined}
      className="max-h-[85dvh] overflow-y-auto"
    >
      {serialField}
      {test && (
        <LabeledSelect
          label="Evidence Type"
          placeholder="Choose an evidence type"
          required
          options={methods[test].types}
          name="evidenceType"
          defaultValue={evidenceType ?? null}
        />
      )}
      {fields.map(({ name, label, required, limit, multiline }) => {
        const input = { name, defaultValue: defaults[name], required, maxLength: limit ?? 500 };
        return multiline
          ? <NoteField key={name} label={label} className={shortNoteField} rows={2} {...input} />
          : <TextField key={name} label={label} {...input} />;
      })}
      {options.length > 0 && (
        <LabeledSelect<string, true>
          multiple
          label={label}
          options={options}
          value={links}
          onChange={setLinks}
          display={display}
        />
      )}
      {revising && <NoteField label="Reason for revision" className={`${noteField} min-h-[78px]!`}
        name="reason" rows={2} maxLength={500} required />}
    </FormDialog>
  );
}
