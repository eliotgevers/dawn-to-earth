import { fieldLabel } from "@/components/records/presentation";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { catalogUnits, projectRevisions, revisionOptions, isCatalogArchived, type Catalog } from "@/components/catalog/store";
import {
  itemChipLabel,
  type ItemSelection,
} from "./selection";

type Choice = { value: string; label: string; detail?: string };

function searchable(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesChoice({ label, detail }: Choice, query: string) {
  const text = searchable(`${label} ${detail ?? ""}`);
  const terms =
    searchable(query)
      .replace(/\brevision\b/g, "rev")
      .match(/\brev\s+[a-z0-9.-]+|\S+/g) ?? [];
  return terms.every((term) => text.includes(term.replace(/\s+/g, " ")));
}

const pickerOrder = ["project", "system", "revision", "batch", "unit"] as const;

type PickerField = typeof pickerOrder[number];
type PickerDraft = Partial<Record<PickerField, string>>;

function pickerFields(catalog: Catalog, draft: PickerDraft) {
  const project = catalog.projects.find(({ id }) => id === draft.project);
  const revisions = projectRevisions(catalog, project, draft.system);
  const applicableSystems = new Set(revisions.map(({ systemId }) => systemId));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const units = catalogUnits(catalog, { project: project?.id, revision: draft.revision })
    .filter(unit => revisionById.has(unit.revisionId));
  const batches = [...new Set(units.flatMap(({ batch }) => (batch ? [batch] : [])))].sort();
  const active = (kind: "project" | "system", id: string) => !isCatalogArchived(catalog, kind, id);
  return [
    [
      "project",
      "Project",
      "Find a project",
      catalog.projects
        .filter(({ id }) => active("project", id))
        .map(({ id, title, customer }) => ({ value: id, label: title, detail: customer })),
    ],
    [
      "system",
      "System",
      "Find a reusable design",
      catalog.systems
        .filter(({ id }) => active("system", id) && (!draft.project || applicableSystems.has(id)))
        .map(({ id, title }) => ({ value: id, label: title })),
    ],
    [
      "revision",
      "Revision",
      "Find a revision",
      revisionOptions(catalog, revisions.filter(({ systemId }) => active("system", systemId))),
    ],
    [
      "unit",
      "Unit",
      "Find a serial number",
      units
        .filter((unit) => !draft.batch || unit.batch === draft.batch)
        .map((unit) => ({
          value: unit.serial,
          label: unit.title ?? unit.serial,
          detail: [unit.title && unit.serial, revisionById.get(unit.revisionId)?.version, unit.batch]
            .filter(Boolean)
            .join(" · "),
        })),
    ],
    ...(batches.length
      ? [["batch", "Filter units by batch", "All batches", batches.map(value => ({ value, label: value }))] as const]
      : []),
  ] as const;
}

// Removing a chip returns keyboard focus to the control that can add it again.
export function SelectionChip({ label, evidence, onRemove, trigger }: {
  label: string; evidence?: boolean; onRemove: () => void; trigger: { current: HTMLButtonElement | null };
}) {
  const Tag = evidence ? "li" : "div";
  return <Tag className={evidence
    ? "inline-flex max-w-full items-center gap-1 rounded-md border border-border pl-2 text-xs"
    : "inline-flex max-w-full min-w-0 items-center rounded-lg border border-border bg-background pl-2.5"}>
    <span className={evidence ? "min-w-0 wrap-anywhere" : "min-w-0 wrap-anywhere text-sm"}>{label}</span>
    <Button type="button" variant="ghost" size={evidence ? "icon-xs" : "icon-sm"}
      aria-label={`${evidence ? "Remove" : "Clear"} ${label}`} onClick={() => {
        onRemove();
        trigger.current?.focus();
      }}>
      <X aria-hidden="true" />
    </Button>
  </Tag>;
}

export function ItemPicker({
  catalog,
  selections,
  onChange,
}: {
  catalog?: Catalog;
  selections: readonly ItemSelection[];
  onChange?: (selections: readonly ItemSelection[]) => void;
}) {
  const [draft, setDraft] = useState<PickerDraft | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const fields = draft && catalog ? pickerFields(catalog, draft) : [];
  const selectedLevel = (["unit", "revision", "system", "project"] as const).find(level => draft?.[level]);
  const next: ItemSelection | null = draft && selectedLevel ? `${selectedLevel}:${draft[selectedLevel]}` : null;
  function choose(field: PickerField, value?: string) {
    if (!draft) return;
    const next = { ...draft, [field]: value };
    for (const dependent of pickerOrder.slice(pickerOrder.indexOf(field) + 1)) delete next[dependent];
    setDraft(next);
  }
  const alreadySelected = Boolean(next && selections.includes(next));
  const chips = selections.flatMap((selection) => {
    const label = catalog ? itemChipLabel(catalog, selection) : selection.slice(selection.indexOf(":") + 1);
    return label ? [{ selection, label }] : [];
  });
  const hasSelection = chips.length > 0;
  const label = hasSelection ? "Add item" : "Select item";

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => setDraft(open ? {} : null)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Selected items">
        {chips.map(({ selection, label }) => (
          onChange ? <SelectionChip key={selection} label={label} trigger={add}
            onRemove={() => onChange(selections.filter(item => item !== selection))} />
            : <span key={selection} className="rounded-lg border px-2.5 py-1 text-sm wrap-anywhere">{label}</span>
        ))}
        <DialogTrigger
          render={
            <Button
              ref={add}
              type="button"
              variant="outline"
              className="bg-popover"
              size={hasSelection ? "icon-sm" : "sm"}
              disabled={!catalog}
              aria-label={label}
              title={hasSelection ? label : undefined}
            />
          }
        >
          {hasSelection ? <Plus aria-hidden="true" /> : label}
        </DialogTrigger>
      </div>
      {catalog && (
        <DialogContent
          initialFocus={first}
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape" || event.currentTarget.querySelector('input[aria-expanded="true"]')) return;
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Choose a project, system, revision, or unit.</DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-3">
            {fields.map(([field, name, placeholder, choices], index) => {
              const key = [field, ...pickerOrder.slice(0, pickerOrder.indexOf(field)).map(key => draft?.[key])].join("-");
              const id = `${baseId}-${index}`;
              return (
                <div key={key} className={fieldLabel}>
                  <label htmlFor={id}>{name}</label>
                  <Combobox.Root
                    items={choices}
                    value={choices.find((choice) => choice.value === draft?.[field]) ?? null}
                    filter={matchesChoice}
                    itemToStringLabel={(item) => item.label}
                    isItemEqualToValue={(a, b) => a.value === b.value}
                    autoHighlight
                    openOnInputClick
                    onValueChange={(choice) => choose(field, choice?.value)}
                  >
                    <Combobox.InputGroup className="flex min-w-0 items-center rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50">
                      <Combobox.Input
                        ref={index === 0 ? first : undefined}
                        id={id}
                        placeholder={placeholder}
                        className="h-9 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
                      />
                      <Combobox.Clear
                        aria-label={`Clear ${name.toLowerCase()}`}
                        className="shrink-0 rounded-md p-1.5 hover:bg-muted focus-visible:ring-2"
                      >
                        <X size={14} aria-hidden="true" />
                      </Combobox.Clear>
                      <Combobox.Trigger
                        aria-label={`Show ${name.toLowerCase()} options`}
                        className="shrink-0 rounded-md p-1.5 hover:bg-muted focus-visible:ring-2"
                      >
                        <ChevronDown size={15} aria-hidden="true" />
                      </Combobox.Trigger>
                    </Combobox.InputGroup>
                    <Combobox.Portal>
                      <Combobox.Positioner sideOffset={4} className="z-50">
                        <Combobox.Popup className="max-h-[min(16rem,var(--available-height))] w-(--anchor-width) overflow-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
                          <Combobox.Empty className="px-2 py-1.5 text-muted-foreground empty:hidden">
                            Unavailable
                          </Combobox.Empty>
                          <Combobox.List>
                            {(choice: Choice) => (
                              <Combobox.Item
                                key={choice.value}
                                value={choice}
                                className="grid cursor-default grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-md px-2 py-1.5 data-highlighted:bg-muted"
                              >
                                <span className="min-w-0 wrap-break-word">
                                  {choice.label}
                                  {choice.detail && <span className="block mt-0.5 text-xs text-muted-foreground">{choice.detail}</span>}
                                </span>
                                <Combobox.ItemIndicator>
                                  <Check size={14} aria-hidden="true" />
                                </Combobox.ItemIndicator>
                              </Combobox.Item>
                            )}
                          </Combobox.List>
                        </Combobox.Popup>
                      </Combobox.Positioner>
                    </Combobox.Portal>
                  </Combobox.Root>
                </div>
              );
            })}
          </div>
          {alreadySelected && (
            <p className="mt-1 text-[13px] leading-normal text-muted-foreground" role="status">
              This item is already selected.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              type="button"
              variant={hasSelection ? "outline" : "default"}
              className={hasSelection ? "bg-popover" : undefined}
              disabled={!next || alreadySelected}
              onClick={() => {
                if (!next || alreadySelected) return;
                onChange?.([...selections, next]);
                setDraft(null);
              }}
            >
              {hasSelection ? "Add" : "Select"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
