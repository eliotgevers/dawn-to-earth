import { hasUnitRevision } from "@/components/catalog/store";
import { isRecordUnit, type RecordUnit } from "@/lib/records/journal";
import { assemblyAtUnit, unitProblem, isObject, hasText, entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkWrite } from "./cases";

const systems = ["Engineering", "Purchasing", "Production"] as const;
export const fields = { serial: "Serial", revisionId: "Revision", receipt: "Receipt line" };
type Field = keyof typeof fields;
type Source = {
  id: string;
  system: (typeof systems)[number];
  owner: string;
  document: string;
  sourceDate: string;
  serial: string | null;
  revisionId: string | null;
  receipt: string | null;
};
type Citation = { id: string; sourceId: string; targetId: string; locator: string };
type Comparison = {
  buildId: string;
  observation: string;
  field: Field;
  targetId: string;
  sources: Source[];
  citations: Citation[];
};
export type ReconciliationCase = WorkCase & { unit: RecordUnit; data: Comparison };

const optionalValue = (v: unknown) => v === null || hasText(v);

function isSource(s: unknown): s is Source {
  if (!isObject(s)) return false;

  return (
    systems.some((system) => system === s.system) &&
    [s.id, s.owner, s.sourceDate, s.document].every(hasText) &&
    [s.serial, s.revisionId, s.receipt].every(optionalValue)
  );
}

function isCitation(c: unknown): c is Citation {
  return isObject(c) && [c.id, c.sourceId, c.targetId, c.locator].every(hasText);
}

export function isComparison(row: WorkCase): row is ReconciliationCase {
  const d = row.data;
  if (
    row.tool !== "reconciliation" ||
    !isRecordUnit(row.unit) ||
    !hasText(d.buildId) ||
    !hasText(d.observation) ||
    !hasText(d.field) ||
    !Object.hasOwn(fields, d.field) ||
    !hasText(d.targetId) ||
    !Array.isArray(d.sources) ||
    !d.sources.every(isSource) ||
    !Array.isArray(d.citations) ||
    !d.citations.every(isCitation)
  )
    return false;
  const ids = new Set(d.sources.map((s) => s.id));

  return (
    d.sources.length === systems.length &&
    new Set(d.sources.map((s) => s.system)).size === systems.length &&
    ids.size === d.sources.length &&
    ids.has(d.targetId) &&
    new Set(d.citations.map((c) => c.id)).size === d.citations.length &&
    d.citations.every((c) => ids.has(c.sourceId) && c.sourceId !== c.targetId && c.targetId === d.targetId)
  );
}

const eventLabels: Readonly<Record<string, string | undefined>> = {
  "source-correction-requested": "With record owner",
  "source-unconfirmed": "Unconfirmed",
  "source-clarified": "Ready to map",
  "mapping-recorded": "Mapped",
  "identity-excluded": "Different unit",
};
export function stage(last?: WorkEvent) {
  return last && Object.hasOwn(eventLabels, last.kind) ? eventLabels[last.kind]! : "Open";
}

// Use an ordered representation: jsonb key order can differ from the browser’s object insertion order.
export function comparisonKey(row: ReconciliationCase) {
  const d = row.data;

  return JSON.stringify([
    row.unit.serial,
    row.unit.revisionId,
    d.buildId,
    d.field,
    d.targetId,
    d.sources.map((s) => [
      s.id,
      s.system,
      s.owner,
      s.document,
      s.sourceDate,
      s.serial,
      s.revisionId,
      s.receipt,
    ]),
    d.citations.map((c) => [c.id, c.sourceId, c.targetId, c.locator]),
  ]);
}

function usableBases(row: ReconciliationCase, target: Source, key: string, last?: WorkEvent) {
  const { sources, citations, field } = row.data;
  const entries = citations.flatMap((c) => {
    const source = sources.find((s) => s.id === c.sourceId);
    if (
      !source ||
      source.serial !== row.unit.serial ||
      source.revisionId !== row.unit.revisionId ||
      !source[field] ||
      source[field] === target[field]
    )
      return [];

    return [{ basisId: c.id, citation: c.id, sourceId: source.id, value: source[field], locator: c.locator }];
  });
  if (
    last?.kind === "source-clarified" &&
    last.data.comparisonKey === key &&
    hasText(last.data.reference) &&
    hasText(last.data.value) &&
    hasText(last.data.reason)
  ) {
    entries.push({
      basisId: last.id,
      citation: last.data.reference,
      sourceId: last.data.reference,
      value: last.data.value,
      locator: last.data.reason,
    });
  }

  return entries;
}

export type Action = "map" | "route" | "clarify" | "exclude" | "unconfirmed";

export function nextDecision(row: ReconciliationCase, last: WorkEvent | undefined, workspace: ToolContext["workspace"]) {
  let problem = unitProblem(workspace.catalog, row.unit);
  const build = problem ? undefined : assemblyAtUnit(workspace, row.data.buildId, row.unit);
  if (!build) problem ??= "The linked build no longer identifies this unit and revision.";
  const subject = {
    serial: row.unit.serial,
    revisionId: row.unit.revisionId,
    targetId: row.data.targetId,
    comparisonKey: comparisonKey(row),
    previousId: last?.id ?? null,
  };
  const target = row.data.sources.find(source => source.id === subject.targetId)!;
  const request = last?.kind === "source-correction-requested" ? last : undefined;
  const changed = request && request.data.comparisonKey !== subject.comparisonKey
    ? "The original source changed after referral. Return this request unresolved and compare the revised sources."
    : undefined;
  const bases = usableBases(row, target, subject.comparisonKey, last);
  let choices: Action[] = [];
  let denial: string;
  if (last?.kind === "mapping-recorded") {
    denial = "This discrepancy already has a recorded mapping.";
  } else if (last?.kind === "identity-excluded") {
    denial = "The owner excluded this source from the case unit.";
  } else if (request) {
    choices = changed || problem ? ["unconfirmed"] : ["clarify", "exclude", "unconfirmed"];
    denial = problem ?? changed ?? "Record the owner’s finding before mapping this source.";
  } else {
    if (!problem) choices = bases.length ? ["map", "route"] : ["route"];
    denial = problem ?? "Choose an exact source citation or route the discrepancy to its owner.";
  }

  return { subject, choices, denial, request, changed, bases, build, problem, target };
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const row = command.dossier;
  if (!isComparison(row)) return "The reconciliation case is unavailable.";
  const { data, action } = command;
  const last = row.history.at(-1);
  const step = nextDecision(row, last, ctx.workspace);
  const { subject: { previousId, ...expected }, target, request } = step;
  if (data.previousId !== previousId || data.comparisonKey !== expected.comparisonKey)
    return "The comparison changed. Reopen the case before saving.";
  if (
    data.serial !== expected.serial || data.revisionId !== expected.revisionId || data.targetId !== expected.targetId
  )
    return "The source row, unit or revision does not match this case.";
  const reason = entryText(data.reason, 1200);
  if (!reason) return "Enter a reason of 1 to 1,200 characters.";
  if (!step.choices.some(choice => choice === action)) return step.denial;
  const { targetId, buildId, field, sources } = row.data;
  if (request) {
    const task = openAssignments(request, ctx.tasks).find(
      (t) =>
        t.sourceId === request.data.targetId &&
        t.owner === request.data.owner &&
        t.unit?.serial === request.data.serial &&
        t.unit?.revisionId === request.data.revisionId,
    );
    if (!task) return "The open assignment no longer matches the source owner or unit.";
    const returned = { ...request.data, reason, requestId: request.id };
    const completeTaskIds = [task.id];
    if (action === "unconfirmed")
      return {
        kind: "source-unconfirmed",
        title: "Owner could not confirm the match",
        data: returned,
        completeTaskIds,
      };
    const reference = entryText(data.reference, 120);
    if (
      !reference ||
      sources.some((s) => s.id.toLowerCase() === reference.toLowerCase())
    )
      return "Cite a separate owner clarification with a document and page or entry.";
    if (action === "exclude") {
      const other = ctx.workspace.catalog.units.find((u) => u.serial === data.attestedSerial);
      if (
        data.attestedTarget !== targetId ||
        !other ||
        other.serial === row.unit.serial ||
        !hasUnitRevision(other, data.attestedRevision)
      )
        return "Quote the original row and the other unit’s exact recorded serial and revision.";
      return {
        kind: "identity-excluded",
        title: "Owner ruled out this unit",
        completeTaskIds,
        data: { ...returned, reference, otherSerial: other.serial, otherRevision: data.attestedRevision },
      };
    }
    if (
      data.attestedTarget !== targetId ||
      data.attestedSerial !== row.unit.serial ||
      data.attestedRevision !== row.unit.revisionId
    )
      return "The clarification must identify the original source row, serial and exact catalog revision.";
    // The attested identity above already supplies the corrected serial or revision.
    const value = entryText(data.value === undefined && field !== "receipt" ? row.unit[field] : data.value, 120);
    if (
      !value ||
      value === target[field] ||
      (field !== "receipt" && value !== row.unit[field])
    )
      return "The corrected value must match this unit and differ from the source value.";
    return {
      kind: "source-clarified",
      title: "Owner supplied a cited clarification",
      data: { ...returned, reference, value },
      completeTaskIds,
    };
  }
  const subject = { ...expected, buildId, field, before: target[field], reason };
  if (action === "route") {
    return {
      kind: "source-correction-requested",
      title: "Correction routed to " + target.system,
      data: { ...subject, owner: target.owner, system: target.system },
      tasks: [
        {
          owner: target.owner,
          section: target.system === "Engineering" ? "engineering" : "production",
          unit: row.unit,
          sourceId: targetId,
          title: "Clarify " + fields[field].toLowerCase() + " on " + targetId,
        },
      ],
    };
  }
  const basis = step.bases.find(b => b.basisId === data.basisId);
  if (!basis) return step.denial;

  return {
    kind: "mapping-recorded",
    title: fields[field] + " mapping recorded",
    data: { ...subject, ...basis },
  };
}
