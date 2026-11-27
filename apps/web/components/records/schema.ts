import type { ProductionBuild } from "@/components/production/builds";
import { type RecordKind, primaryFields, recordActivity, recordDecision, sameUnit, isRemovedRecord, type RecordEntry, type RecordIdentity, type RecordUnit } from "@/lib/records/journal";
import { methods, type VerificationTest } from "@/components/verification/model";
import { formatUtcDateTime } from "@/lib/utc-time";
import { filedReference, recordConnection, recordLabel } from "@/lib/records/links";
import { includesUnit, revisionCoverage, type ScopeRevision, type SelectedItem } from "@/components/workspace/selection";
import type { AssemblyRecord } from "@/db/records/assembly";

const recordViews = {
  requirement: "Requirements", change: "Changes", issue: "Issues", queue: "Builds", build: "Builds",
  interface: "Design · Interfaces", component: "Design · Components", evidence: "Evidence",
} as const;

export type LinkableRecord = RecordIdentity & {
  kind?: RecordKind;
  designKind?: "interface";
  test?: VerificationTest;
  type?: string;
  recordedAt?: string;
  exchangeArchive?: { id: string };
  sourceSheet?: string;
  source?: string;
  reference?: string;
  origin?: "local" | "fixture";
};

export function connectionToRecord(section: "engineering" | "production" | "verification", target: LinkableRecord) {
  const reference = target.exchangeArchive?.id ?? target.sourceSheet ?? filedReference(target.reference);
  const archive = target.type && target.recordedAt && `${target.type} · ${formatUtcDateTime(target.recordedAt)}`;
  const kind = target.kind === "configuration" ? (target.designKind ?? "component") : (target.kind ?? "evidence");
  const view = target.test ? methods[target.test].label : recordViews[kind];
  const source = target.source?.trim();
  const label = !reference && kind === "evidence" && source && source.length <= 60
    ? source : recordLabel(kind, reference ?? archive, target.title);

  return recordConnection(section, target.id, target.unit, {
    view, label, identity: [target.title, target.unit?.serial, target.unit?.revision].filter(Boolean).join(" · "),
  });
}

// Older records store named fields. Authored records store the same facts by form key.
export function recordValues(
  record: AssemblyRecord | Pick<RecordEntry, "kind" | "description" | "context" | "currentState" | "primary">,
): Record<string, string | undefined> {
  if (!("fields" in record)) {
    return { ...record.primary, description: record.description, context: record.context, currentState: record.currentState };
  }
  const fields = new Map(record.fields);
  return Object.fromEntries(primaryFields(record.kind, record.designKind === "interface").map(({ name, label, prefer, fallback }) => [
    name, (prefer && fields.get(prefer)) ?? fields.get(label) ?? (fallback && fields.get(fallback)),
  ]));
}

export function primaryValues(kind: RecordKind, values: Readonly<Record<string, string | undefined>>, isInterface?: boolean) {
  return primaryFields(kind, isInterface).map(({ name, label }) => [label, values[name]] as const);
}

// Imported authored rows may use display labels; fixture amendments overlay their existing field list.
export function authoredFields(record: RecordEntry, base?: Pick<AssemblyRecord, "kind" | "fields">) {
  const fields = new Map(base?.fields);
  const values = recordValues(record);
  for (const {name, label} of primaryFields(base?.kind ?? record.kind, !base && record.designKind === "interface")) {
    const value = (!base ? record.primary?.[label] : undefined) ?? values[name];
    if (!base || value !== undefined || base.kind === "issue") fields.set(label, value ?? "");
  }
  return [...fields];
}

type ApplicabilityRevision = Pick<ScopeRevision, "id" | "title" | "version">;

export type RecordApplicability = {
  key: string;
  label: string;
  coverage: number;
  revisions: readonly ApplicabilityRevision[];
  shared: boolean;
};

const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function compareLabels(first: string, second: string) {
  return names.compare(first, second) || (first < second ? -1 : first > second ? 1 : 0);
}

function compareRevisions(first: ApplicabilityRevision, second: ApplicabilityRevision) {
  return compareLabels(first.title, second.title) || compareLabels(first.version, second.version) ||
    compareLabels(first.id, second.id);
}

export function compareApplicability(first?: RecordApplicability, second?: RecordApplicability) {
  if (!first) return second ? 1 : 0;
  if (!second) return -1;
  const firstGroup = first.revisions[0];
  const secondGroup = second.revisions[0];
  if (firstGroup && secondGroup) {
    const order = compareRevisions(firstGroup, secondGroup);
    if (order) return order;
  } else if (firstGroup || secondGroup) {
    return firstGroup ? -1 : 1;
  }

  // Anchor a cross-revision record to its earliest revision so it appears once,
  // before any of the revisions it applies to.
  return Number(second.revisions.length > 1) - Number(first.revisions.length > 1) ||
    Number(second.shared) - Number(first.shared) || second.coverage - first.coverage ||
    compareLabels(first.label, second.label) || compareLabels(first.key, second.key);
}

export function showsApplicability(item: SelectedItem | undefined) {
  return Boolean(item && !item.unit && (item.members.length > 1 || item.revisions.length > 1));
}

function unitKey({ serial, revisionId }: RecordUnit) {
  return JSON.stringify(["unit", serial, revisionId]);
}

export function serialApplicability(unit?: RecordUnit, item?: SelectedItem): RecordApplicability | undefined {
  if (!unit) return;
  const group = item?.revisions.find(revision =>
    revision.id === unit.revisionId && revision.units.some(member => member.serial === unit.serial));
  return {
    key: JSON.stringify([unitKey(unit)]), label: unit.serial, coverage: 1,
    revisions: group ? [group] : [], shared: false,
  };
}

export function applicableRevisions<R extends Omit<ScopeRevision, "title">>(revisions: readonly R[], id: string, local: readonly RecordEntry[]) {
  return revisions.flatMap((revision) => {
    const { shared, units } = revisionCoverage(revision, id);
    const members = units.filter((unit) => !isRemovedRecord(id, local, unit));
    return members.length || (shared && !revision.units.length) ? [{ revision, members }] : [];
  });
}

// A definition applies through listed record IDs. An authored record or build belongs to its exact unit edition.
export function assemblyMembership(recordIds: readonly string[] | undefined, includes: (owner?: RecordUnit) => boolean) {
  const ids = new Set(recordIds);
  return (section: "engineering" | "production", record: AssemblyRecord, fallback?: RecordUnit) =>
    section === "engineering" && record.origin !== "local" ? ids.has(record.id) : includes(record.unit ?? fallback);
}

// Eligible owned records have no shared coverage. An undefined result excludes the record.
export function engineeringScope(item: SelectedItem | undefined, local: readonly RecordEntry[]) {
  const matches = assemblyMembership(item?.recordIds, owner => includesUnit(item, owner));
  return (record: AssemblyRecord) => {
    if (!item || !matches("engineering", record)) return;
    if (record.origin === "local")
      return isRemovedRecord(record.id, local) ? undefined : [];
    if (item.unit) return isRemovedRecord(record.id, local, item.members[0]) ? undefined : [];
    const coverage = applicableRevisions(item.revisions, record.id, local);
    return coverage.length || item.directScopes.some(scope => scope.recordIds.includes(record.id)) ? coverage : undefined;
  };
}

export type SelectedCoverage = ReturnType<typeof applicableRevisions<ScopeRevision>>;

export function sharedApplicability(coverage: SelectedCoverage): RecordApplicability | undefined {
  // The selection has one entry per revision and one entry per serial within it.
  const targets = coverage.flatMap(({ revision, members }) => members.length
    ? members.map(unit => [unitKey(unit), unit.serial] as const)
    : [[JSON.stringify(["revision", revision.id]), revision.title] as const]);
  if (!targets.length) return;
  return {
    key: JSON.stringify(targets.map(([key]) => key).sort()),
    label: targets.map(([, label]) => label).sort(compareLabels).join(" · "),
    coverage: targets.length,
    revisions: coverage.map(row => row.revision).sort(compareRevisions),
    shared: targets.length > 1 || !coverage[0].members.length,
  };
}


export function groupByApplicability<T>(records: readonly T[], applicability: (record: T) => RecordApplicability | undefined) {
  const groups = Map.groupBy(records, record => applicability(record)?.key ?? "");
  return Array.from(groups, ([key, records]) => [key, { records, scope: applicability(records[0]) }] as const)
    .sort(([, first], [, second]) => compareApplicability(first.scope, second.scope));
}

export function listEntry(record: AssemblyRecord, board: "engineering" | "production", item: SelectedItem | undefined,
  baseline: RecordUnit, local: readonly RecordEntry[], coverage: SelectedCoverage, build?: ProductionBuild, outside?: boolean) {
  const { kind } = record;
  const owner = board === "production" ? record.unit ?? baseline : record.origin === "local" ? record.unit : baseline;
  const unit = outside ? undefined : item?.unit ? item.members[0]
    : (board === "production" || (kind === "change" && record.origin === "local")) && includesUnit(item, owner)
      ? owner : undefined;
  const activity = recordActivity(local, record.id).filter(({ action }) =>
    action && (includesUnit(item, action.unit) || (record.origin === "local" && sameUnit(owner, action.unit))));
  const decisionUnit = record.origin === "local" ? owner : unit;
  const decision = kind === "change" ? recordDecision(local, record.id, decisionUnit) : undefined;
  const selectedStatus = build?.work.status ?? (unit ? decision?.status : undefined);
  const removed = record.origin === "local" ? isRemovedRecord(record.id, local, board === "production" ? owner : undefined)
    : Boolean(item?.unit && isRemovedRecord(record.id, local, item.members[0]));
  const archived = build?.filter === "archived";
  const status = archived ? "Archived" : removed ? "Removed locally" : selectedStatus ?? record.status;
  const revision = kind === "requirement" && item?.unit
    ? activity.find(entry => entry.requirementRevision && sameUnit(item.members[0], entry.action?.unit))
    : undefined;
  const shared = board === "engineering" && record.origin === "fixture";
  const scope = !outside && showsApplicability(item) ? shared ? sharedApplicability(coverage) : serialApplicability(owner, item) : undefined;
  const targets = !item || outside || removed || archived || kind === "configuration" ? []
    : shared ? item.unit ? item.members : coverage.flatMap(group => group.members)
    : owner ? [owner] : [];
  return { id: record.id, record, build, kind, owner, unit, status, removed, archived, revision, decision, activity, targets, scope };
}

export function engineeringRows(records: readonly AssemblyRecord[], kind: AssemblyRecord["kind"], interfaces: boolean,
  item: SelectedItem | undefined, baseline: RecordUnit, local: readonly RecordEntry[]) {
  const applies = engineeringScope(item, local);

  return records.flatMap(record => {
    if (record.kind !== kind || (kind === "configuration" && (record.designKind === "interface") !== interfaces)) return [];
    const coverage = applies(record);

    return coverage ? [listEntry(record, "engineering", item, baseline, local, coverage)] : [];
  });
}
