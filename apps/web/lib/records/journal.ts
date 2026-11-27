import type { RecordedSeries } from "@/components/verification/numeric-series";
import type { ExchangeArchive, ExchangeBasis } from "@/components/verification/document-exchanges";
import { methods, isVerificationTest, type VerificationTest } from "@/components/verification/model";

export type RecordUnit = { serial: string; revisionId: string; revision: string };

export type RecordIdentity = { id: string; title: string; unit?: RecordUnit };

export type AssemblyHeading = RecordIdentity & {
  reference: string;
  status: string;
  tone: "green" | "blue" | "amber" | "gray";
};

export function isRecordUnit(value: unknown): value is RecordUnit {
  if (!value || typeof value !== "object") return false;
  const unit = value as Partial<RecordUnit>;

  return [unit.serial, unit.revisionId, unit.revision].every(text => typeof text === "string" && text.length > 0);
}

const workflowActions = {
  decide: { label: "Record decision", kind: "change", note: "Reason", outcomes: ["Approved", "Returned for revision", "Declined"], event: "Change decision recorded" },
  start: { label: "Start work", kind: "queue", note: "Work note", event: "Work started" },
  complete: { label: "Complete work", kind: "queue", note: "Completion note", event: "Work completed" },
  flag: { label: "Flag issue", kind: "issue", note: "Finding", event: "Issue flagged" },
  rework: { label: "Record rework", kind: "build", note: "Work performed", reason: "Outcome or follow-up", event: "Rework recorded" },
  dispose: { label: "Record decision", kind: "issue", note: "Disposition notes", outcomes: ["Keep open", "Resolved"], event: "Issue disposition recorded" },
} as const;

export const assemblyActions = {
  edit: { label: "Edit", kind: "any", event: "Record edited" },
  remove: { label: "Remove", kind: "any", event: "Record removed" },
  note: { label: "Add note", kind: "any", event: "Note added" },
  "edit-note": { label: "Edit note", kind: "any", event: "Note edited" },
  "remove-note": { label: "Delete note", kind: "any", event: "Note deleted" },
  revise: { label: "Revise requirement", kind: "requirement", event: "Requirement revision drafted" },
  ...workflowActions,
} as const;

export type AssemblyActionType = keyof typeof assemblyActions;
export type WorkflowActionType = keyof typeof workflowActions;
export type AssemblyAction = { type: AssemblyActionType; parentId: string; unit: RecordUnit; outcome?: string };

export function isAssemblyAction(value: unknown, kind: RecordKind): value is AssemblyAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AssemblyAction>;
  if (!action.type || !Object.hasOwn(assemblyActions, action.type)) return false;

  const rule = assemblyActions[action.type];
  if (rule.kind !== "any" && rule.kind !== kind) return false;

  return typeof action.parentId === "string" && Boolean(action.parentId) &&
    isRecordUnit(action.unit) &&
    ("outcomes" in rule ? rule.outcomes.some(outcome => outcome === action.outcome) : action.outcome === undefined);
}

export type UnitEdition = Pick<RecordUnit, "serial" | "revisionId">;

export function sameUnit(first?: UnitEdition | null, second?: UnitEdition | null) {
  return Boolean(first && second && first.serial === second.serial && first.revisionId === second.revisionId);
}

export function assemblyStatusTone(status: string): "green" | "blue" | "amber" {
  if (status === "Approved" || status === "Resolved" || status === "Complete") return "green";
  if (status === "In progress") return "blue";

  return "amber";
}

export const openChanges = new Set(["Draft", "Proposed", "In review", "Returned for revision"]);

export function editableActions(kind: Exclude<RecordKind, "evidence">, status: string): WorkflowActionType[] {
  switch (kind) {
    case "requirement":
    case "configuration": return [];
    case "change": return openChanges.has(status) ? ["decide"] : [];
    case "queue":
      if (status === "Ready to resume") return ["start"];
      if (status === "Ready" || status === "Queued") return ["start", "flag"];
      return status === "In progress" ? ["complete", "flag"] : [];
    case "build": return ["rework"];
    case "issue": return status !== "Resolved" ? ["dispose"] : [];
  }
}

// Keys in the original bracket journal identify these filed records.
export const bracketRecords = {
  requirement: { section: "engineering", id: "bracket-requirement" },
  configuration: { section: "engineering", id: "bracket-configuration" },
  change: { section: "engineering", id: "bracket-change" },
  queue: { section: "production", id: "bracket-queue" },
  build: { section: "production", id: "bracket-build" },
  issue: { section: "production", id: "bracket-issue" },
  evidence: { section: "verification", id: "bracket-fit-evidence" },
} as const;

export type BracketRecord = keyof typeof bracketRecords;

type Field = { name: string; label: string; required?: boolean; limit?: number; multiline?: boolean; prefer?: string; fallback?: string };

const description = { name: "description", required: true, limit: 1000, multiline: true };

export const recordKinds = {
  requirement: {
    dialogTitle: "Add requirement", addLabel: "Add requirement", title: "Requirement name", saved: "Requirement saved.",
    status: "Draft", section: "engineering", event: "Requirement drafted",
    fields: [
      { ...description, label: "Requirement statement", prefer: "Requirement" },
      { name: "context", label: "Acceptance criterion" },
      { name: "verificationMethod", label: "Verification method" },
      { name: "source", label: "Source" },
    ],
  },
  configuration: {
    dialogTitle: "Add configuration", addLabel: "Add configuration", title: "Component name", saved: "Configuration saved.",
    status: "Draft", section: "engineering", event: "Configuration drafted",
    fields: [
      { ...description, label: "Definition", prefer: "Approved part" },
      { name: "assembly", label: "Assembly", required: true },
      { name: "matingInterface", label: "Mating interface", fallback: "Interface" },
      { name: "placement", label: "Placement" },
    ],
  },
  change: {
    dialogTitle: "Propose change", addLabel: "Add change proposal", title: "Change title", saved: "Change proposal saved.",
    status: "Proposed", section: "engineering", event: "Change proposed",
    fields: [
      { name: "currentState", label: "Current state", limit: 1000, multiline: true },
      { ...description, label: "Proposed change", fallback: "Proposal" },
      { name: "context", label: "Reason", required: true, multiline: true },
    ],
  },
  queue: {
    dialogTitle: "Queue work", addLabel: "Add queued work", title: "Work item title", saved: "Work item saved.",
    status: "Queued", section: "production", event: "Work queued",
    fields: [
      { ...description, label: "Next action" },
      { name: "context", label: "Expected output", fallback: "Output", required: true },
      { name: "assembly", label: "Assembly" },
    ],
  },
  build: {
    dialogTitle: "Add build record", addLabel: "Add build record", title: "Build record title", saved: "Build record saved.",
    status: "Recorded", section: "production", event: "Build recorded",
    fields: [
      { ...description, label: "Work performed" },
      { name: "context", label: "As-built article", fallback: "As-built article or part", required: true },
      { name: "installedDefinition", label: "Installed definition", fallback: "Installed part" },
      { name: "observedResult", label: "Observed result", multiline: true },
    ],
  },
  issue: {
    dialogTitle: "Log issue", addLabel: "Add issue", title: "Issue title", saved: "Issue saved.",
    status: "Open", section: "production", event: "Issue logged",
    fields: [
      { ...description, label: "Finding", fallback: "Reported finding" },
      { name: "affectedArticle", label: "Affected article" },
      { name: "context", label: "Affected work", required: true },
      { name: "workHeld", label: "Work held" },
    ],
  },
  evidence: {
    dialogTitle: "Add Evidence", addLabel: "Add evidence", title: "Title", saved: "Evidence saved.",
    status: "Note", section: "verification", event: "Evidence recorded",
    fields: [
      { ...description, label: "Observation" },
      { name: "context", label: "Source", required: true },
    ],
  },
} as const;

export type RecordKind = keyof typeof recordKinds;
const interfaceFields = [
  { name: "from", label: "From", required: true },
  { name: "to", label: "To", required: true },
  { ...description, label: "Interface agreement", prefer: "Record agreement" },
];

export function primaryFields(kind: RecordKind, isInterface?: boolean): readonly Field[] {
  return isInterface ? interfaceFields : recordKinds[kind].fields;
}

export type ChangeImpact = { id: string; section: "engineering" | "production" };
export type RecordEntry = RecordIdentity & {
  kind: RecordKind;
  description: string;
  context: string;
  recordedAt: string;
  test?: VerificationTest;
  evidenceType?: string;
  benchRun?: { sourceId: string; series: RecordedSeries; companion?: RecordedSeries; returnReviewId?: string };
  eventFinding?: { actor: string; archive: ExchangeArchive; basis: ExchangeBasis };
  action?: AssemblyAction;
  impacts?: readonly ChangeImpact[];
  currentState?: string;
  designKind?: "interface";
  primary?: Record<string, string>;
  noteId?: string;
  requirementRevision?: { criterion: string; method: string; source: string; links: string[] };
};

export function authoredHeading(record: RecordEntry) {
  return {
    ...record, origin: "local", reference: record.recordedAt.slice(0, 10),
    status: recordKinds[record.kind].status, tone: record.kind === "issue" ? "amber" : "gray",
  } satisfies RecordEntry & AssemblyHeading & { origin: "local" };
}

const empty: readonly RecordEntry[] = [];

function field(value: unknown, limit: number, required = false): value is string {
  return typeof value === "string" && value.length <= limit && (!required || Boolean(value.trim()));
}

function validPrimaryFields({kind, designKind, primary}: RecordEntry) {
  if (primary === undefined) return !designKind;
  if (!primary || typeof primary !== "object" || Array.isArray(primary)) return false;
  const keys = new Set(Object.keys(primary));
  for (const { name, required, limit = 500 } of primaryFields(kind, designKind === "interface")) {
    if (["description", "context", "currentState"].includes(name)) continue;
    if ((keys.delete(name) || required) && !field(primary[name], limit, required)) return false;
  }

  return keys.size === 0;
}

export function isRecordEntry(value: unknown): value is RecordEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as RecordEntry;
  const {id, kind, action, title, description, context, unit, impacts, currentState, noteId, designKind, requirementRevision, test, evidenceType} = record;
  if (typeof id !== "string" || typeof kind !== "string" || !Object.hasOwn(recordKinds, kind) ||
    typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt)) ||
    unit !== undefined && !isRecordUnit(unit) || action !== undefined && !isAssemblyAction(action, kind)) return false;

  const productionEdit = action?.type === "edit" && recordKinds[kind].section === "production";
  if (!field(title, 100, true) || !field(description, 1000, !productionEdit) ||
    !field(context, 500, !productionEdit && kind !== "configuration" && kind !== "requirement") ||
    (designKind !== undefined && (kind !== "configuration" || designKind !== "interface")) ||
    !validPrimaryFields(record)) return false;

  if (impacts !== undefined || currentState !== undefined) {
    if (kind !== "change" || (action && action.type !== "edit")) return false;
    if (currentState !== undefined && !field(currentState, 1000, true)) return false;
    if (impacts !== undefined && (!Array.isArray(impacts) || impacts.some(impact => !impact ||
      typeof impact.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(impact.id) ||
      !["engineering", "production"].includes(impact.section)) || new Set(impacts.map(row => row.id)).size !== impacts.length)) return false;
  }

  if (noteId !== undefined && (!noteId || typeof noteId !== "string" ||
    (action?.type !== "edit-note" && action?.type !== "remove-note"))) return false;

  if (requirementRevision !== undefined) {
    if (kind !== "requirement" || action?.type !== "revise" || !requirementRevision) return false;
    const {criterion, method, source, links} = requirementRevision;
    if (![criterion, method, source].every(text => field(text, 500)) || !Array.isArray(links) ||
      !links.every(href => typeof href === "string" && /^\/(engineering|production|verification)(?:\?item=unit(?:%3a|:)[a-z0-9-]+(?:(?:%40|@)[a-z0-9-]+)?)?#[a-z0-9-]+$/i.test(href))) return false;
  }

  if (kind !== "evidence") return test === undefined;

  return isVerificationTest(test) &&
    (evidenceType === undefined ? !!action : methods[test].types.includes(evidenceType));
}

type HistoryEntry = RecordEntry & { action: AssemblyAction };

export function workflowHistory(activity: readonly RecordEntry[]): HistoryEntry[] {
  return activity.filter((entry): entry is HistoryEntry =>
    !!entry.action && !["note", "edit-note", "remove-note"].includes(entry.action.type));
}

const activityIndexes = new WeakMap<readonly RecordEntry[], Map<string, RecordEntry[]>>();

export function recordActivity(records: readonly RecordEntry[], id: string, unit?: RecordUnit | null) {
  let index = activityIndexes.get(records);
  if (!index) {
    index = Map.groupBy(records.filter(entry => entry.action), entry => entry.action!.parentId);
    activityIndexes.set(records, index);
  }

  const entries: readonly RecordEntry[] = index.get(id) ?? empty;

  return unit ? entries.filter(({ action }) => sameUnit(unit, action?.unit)) : entries;
}

// Activity is newest first and belongs to one work order and unit edition.
export function recordedBuildProgress(issuedStatus: string, activity: readonly RecordEntry[]) {
  const startedAt = activity.find(entry => entry.action?.type === "start")?.recordedAt;
  const completedAt = activity.find(entry => entry.action?.type === "complete")?.recordedAt;
  if (completedAt && (!startedAt || completedAt >= startedAt)) return { status: "Complete", startedAt };

  return { status: startedAt ? "In progress" : issuedStatus, startedAt };
}

export function latestRecordEdit(records: readonly RecordEntry[], id: string, unit?: RecordUnit) {
  return recordActivity(records, id, unit).find(entry => entry.action?.type === "edit");
}

/** Shared definitions have independent decisions for each unit edition. */
export function recordDecision(records: readonly RecordEntry[], id: string, unit?: RecordUnit) {
  if (!unit) return;
  const entry = recordActivity(records, id, unit).find(({ action }) =>
    action?.type === "decide" || action?.type === "dispose");
  const outcome = entry?.action?.outcome;
  if (entry && outcome) return { ...entry, status: outcome === "Keep open" ? "Open" : outcome };
}

export function isRemovedRecord(id: string, activity: readonly RecordEntry[], unit?: RecordUnit | null) {
  return recordActivity(activity, id, unit).some(({ action }) => action?.type === "remove");
}

export function visibleRecordNotes(activity: readonly RecordEntry[]) {
  const updates = new Map<string, RecordEntry>();
  for (const entry of activity) {
    if (entry.noteId && (entry.action?.type === "remove-note" || !updates.has(entry.noteId))) updates.set(entry.noteId, entry);
  }

  return activity.filter((entry) => entry.action?.type === "note").flatMap((note) => {
    const amendment = updates.get(note.id);
    if (amendment?.action?.type === "remove-note") return [];

    return amendment ? [{ ...note, description: amendment.description, recordedAt: amendment.recordedAt }] : [note];
  });
}
