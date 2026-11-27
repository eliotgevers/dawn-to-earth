import { revisionLabel, type Catalog } from "@/components/catalog/store";
import { acceptanceState } from "@/components/verification/acceptance";
import { sameUnit, type RecordUnit, type RecordEntry, isRemovedRecord } from "@/lib/records/journal";
import { recordConnection, recordField, recordHref, recordUnitLabel, type RecordConnection, substantiveValue } from "@/lib/records/links";
import { type SelectedItem, combinedItemDetails, includesUnit, parseSelection } from "@/components/workspace/selection";
import type { AssemblyRecord, WorkspaceRecords } from "@/db/records/assembly";
import type { ReactNode } from "react";
import type { WikiArticleId } from "@/components/panel/data";
import { applicableRevisions, assemblyMembership, connectionToRecord, primaryValues, recordValues } from "@/components/records/schema";
import { formatUtcDateTime } from "@/lib/utc-time";

const sections = ["engineering", "production", "verification"] as const;
type RequirementSource = AssemblyRecord | WorkspaceRecords["evidence"][number];

function requirementScope(record: AssemblyRecord, seed: WorkspaceRecords, item?: SelectedItem) {
  const matches = assemblyMembership(item?.recordIds, unit => includesUnit(item, unit));
  return (section: string, source: RequirementSource) => source.id !== record.id && ("kind" in source
    ? matches(section === "engineering" ? "engineering" : "production", source, seed.verification.article)
    : includesUnit(item, source.linkUnit));
}

// A saved citation keeps its filed value. Older revisions can cite a unit-owned record by its bare URL.
export function requirementCitations(record: AssemblyRecord, seed: WorkspaceRecords, item: SelectedItem | undefined, saved: readonly string[]) {
  const issued = new Map(record.links.map(link => [link.href, link]));
  const allowed = requirementScope(record, seed, item);
  const citations: { section: typeof sections[number]; filed: string; link: RecordConnection; decision?: string }[] = [];
  for (const filed of saved) {
    const [path, id] = filed.split("#");
    const [route, query] = path.split("?");
    const section = sections.find(name => route === "/" + name);
    if (!section) continue;
    const rows = section === "verification" ? seed.evidence : seed[section];
    const source = rows.findLast(row => row.id === id);
    const href = !query && source?.unit && !issued.has(filed) ? recordHref(section, id, source.unit) : filed;
    let link = issued.get(href);
    if (link) {
      if (section === "verification" && item && (!source || !allowed(section, source))) continue;
    } else {
      if (!source || !allowed(section, source)) continue;
      const pin = new URLSearchParams(query).get("item");
      if (pin) {
        const selection = parseSelection(pin);
        const pinned = selection?.startsWith("unit:") ? combinedItemDetails(seed.catalog, [selection]) : undefined;
        const unit = pinned?.members[0];
        if (!unit || !includesUnit(item, unit) || !requirementScope(record, seed, pinned)(section, source) ||
            (source.unit && !sameUnit(source.unit, unit))) continue;
      }
      link = { ...connectionToRecord(section, source), href };
    }
    citations.push({section, filed, link, decision: source && "decision" in source ? source.decision : undefined});
  }
  return citations;
}

export function requirementLinkOptions(record: AssemblyRecord, seed: WorkspaceRecords, item: SelectedItem | undefined, saved: readonly string[]) {
  const allowed = requirementScope(record, seed, item);
  const options = new Map<string, string>();
  for (const section of sections) {
    for (const row of section === "verification" ? seed.evidence : seed[section]) {
      if (allowed(section, row)) options.set(recordHref(section, row.id, row.unit), row.title);
    }
  }
  // Keep the original option value checked when editing an older revision.
  const selected = new Set(saved);
  const references = [...record.links.map(link => link.href), ...saved];
  for (const { filed, link } of requirementCitations(record, seed, item, references)) {
    const title = options.get(link.href) ?? link.label;
    if (filed !== link.href && !selected.has(link.href)) options.delete(link.href);
    options.set(filed, title);
  }
  return [...options].map(([value, label]) => ({value, label}));
}

export function requirementDraft(record: AssemblyRecord, revision?: RecordEntry) {
  const values = { ...recordValues(record), title: revision?.title ?? record.title };
  const updated = revision?.requirementRevision;
  return {
    values: updated ? { ...values, description: revision.description, context: updated.criterion,
      verificationMethod: updated.method, source: updated.source } : values,
    links: updated?.links ?? record.links.map(link => link.href),
  };
}

const impactSources = [
  { section: "engineering", kind: "requirement", category: "Requirements" },
  { section: "engineering", kind: "configuration", category: "Interfaces" },
  { section: "production", kind: "build", category: "Build records" },
] as const;
export type ImpactRecord = Pick<(typeof impactSources)[number], "section" | "category"> & {
  value: string;
  label: string;
};

export function changeImpactChoices(seed: WorkspaceRecords, local: readonly RecordEntry[], unit?: RecordUnit): ImpactRecord[] {
  if (!unit) return [];
  const revision = seed.catalog.revisions.find(({ id }) => id === unit.revisionId);
  const found = seed.catalog.units.find(({ serial }) => serial === unit.serial);
  const configuration = found?.configurations.find(entry => entry.revisionId === unit.revisionId);
  const matches = assemblyMembership([...(revision?.recordIds ?? []), ...(configuration?.recordIds ?? [])], owner => sameUnit(owner, unit));
  return impactSources.flatMap(({ section, kind, category }) => seed[section]
    .filter(row => row.kind === kind && (kind !== "configuration" || row.designKind === "interface")
      && matches(section, row, seed.verification.article)
      && !isRemovedRecord(row.id, local, row.origin === "local" ? undefined : unit))
    .map(row => ({ value: row.id, label: row.title, category, section })));
}

function proposalsAffectingRecord({ record, seed, local, item }: EngineeringDetails): RecordConnection[] {
  return seed.engineering.filter(change => change.impacts?.some(({ section, id, target }) =>
    section === "engineering" && id === record.id && target &&
    (record.unit ? sameUnit(record.unit, target.unit) : !item || includesUnit(item, target.unit)))
    && !isRemovedRecord(change.id, local, change.unit))
    .map(change => connectionToRecord("engineering", change));
}

function engineeringRecordScope(record: AssemblyRecord, local: readonly RecordEntry[], catalog: Catalog) {
  if (record.origin === "local" && record.unit) return recordUnitLabel(record.unit);
  const editions = Map.groupBy(catalog.units.flatMap(({ serial, configurations }) =>
    configurations.map(config => ({ ...config, serial }))), unit => unit.revisionId);
  const revisions = catalog.revisions.map(revision => ({ ...revision, units: editions.get(revision.id) ?? [] }));
  return applicableRevisions(revisions, record.id, local).map(({ revision, members }) => {
    const serials = [...new Set(members.map(unit => unit.serial))].join(", ");
    return [revisionLabel(catalog, revision), serials].filter(Boolean).join(" · ");
  }).join(" / ");
}

export type EngineeringDetails = {
  record: AssemblyRecord;
  seed: WorkspaceRecords;
  local: readonly RecordEntry[];
  kind: "requirement" | "configuration" | "change";
  decision?: RecordEntry;
  revision?: RecordEntry;
  item?: SelectedItem;
};

type EngineeringFields = {
  primary: readonly (readonly [string, ReactNode])[];
  metadata: readonly (readonly [string, ReactNode])[];
  links: readonly RecordConnection[];
  label?: string;
  next?: RecordConnection;
  article?: WikiArticleId;
};

function verificationSummary(citations: ReturnType<typeof requirementCitations>) {
  const decisions = citations.filter(row => row.section === "verification").map(row => row.decision);
  if (!decisions.length) return undefined;
  const recorded = new Set(decisions.filter(Boolean));
  if (recorded.size > 1) return "Mixed review outcomes";
  if (decisions.includes(undefined)) return "Review pending";
  return decisions[0];
}

export function engineeringDetails(details: EngineeringDetails): EngineeringFields {
  const { record, seed, local, kind, revision, decision, item } = details;
  const scope = engineeringRecordScope(record, local, seed.catalog);
  if (kind === "requirement") {
    const draft = requirementDraft(record, revision);
    const citations = requirementCitations(record, seed, item, draft.links);
    const unavailable = draft.links.length - citations.length;

    return {
      primary: primaryValues("requirement", draft.values),
      metadata: [
        ["Linked evidence review", verificationSummary(citations)],
        ...(unavailable ? [["Filed references", `${unavailable} unavailable in this selection.`] as const] : []),
        ["Applies to", scope || (recordField(record, "Applicable revision") ?? record.unit?.revision)],
      ],
      label: "Requirement traceability",
      links: [...citations.map(citation => citation.link), ...proposalsAffectingRecord(details)],
    };
  }

  const fields = new Map(record.fields);
  const values = recordValues(record);
  const links = [...record.links];
  if (kind === "configuration") {
    const applicable = [
      scope,
      record.context,
      fields.get("Applicability"), fields.get("Application"), fields.get("Applies to"),
      fields.get("Applicable serials"), fields.get("Applicable revision"), fields.get("Revision"),
    ].find(value => value?.trim());
    if (record.designKind === "interface") links.push(...proposalsAffectingRecord(details));
    if (record.designKind !== "interface") values.description = substantiveValue(values.description, record.title);
    return {
      primary: primaryValues("configuration", values, record.designKind === "interface"),
      metadata: [
        ["Applies to", applicable],
        ...(fields.has("Design qualification") ? [["Design qualification", fields.get("Design qualification")] as const] : []),
      ],
      article: "spacecraft-interfaces",
      links,
    };
  }

  for (const {id, section, target} of record.impacts ?? []) {
    if (target) links.push({
      ...connectionToRecord(section, { ...target, id }),
      role: target.kind === "issue" ? "Affected issue" : undefined,
    });
    else links.push(recordConnection(section, id, record.unit, { view: "", label: "Record unavailable", identity: id, unavailable: true }));
  }
  for (const key of ["description", "currentState", "context"]) values[key] = substantiveValue(values[key], record.title);
  const activity = record.history?.at(-1);
  const decisionText = fields.get("Decision") ?? fields.get("Decision pending") ?? fields.get("Decision needed");
  const statusText = decisionText?.trim().replace(/^decision\s+/i, "").replace(/[.!]$/, "").toLowerCase();
  const summary = decisionText !== values.description && statusText !== record.status.toLowerCase() ? substantiveValue(decisionText, record.title) : undefined;
  const lastActivity = decision?.recordedAt ?? activity?.at ?? record.recordedAt;
  const instructions: RecordConnection[] = [];
  for (const check of seed.verification.acceptanceChecks) {
    if (check.changeId !== record.id || (item && !includesUnit(item, check.unit))) continue;
    const build = seed.production.find(({ id }) => id === check.buildId);
    if (!build) continue;
    const work = connectionToRecord("production", { ...build, unit: check.unit });
    links.push(work);
    if ((decision?.action?.outcome ?? record.status) === "Approved" && recordField(build, "Work instruction") && !acceptanceState(check).accepted) {
      if (!instructions.some(link => link.href === work.href)) instructions.push({ ...work, label: "Open work instruction" });
    }
  }
  return {
    next: instructions.length === 1 ? instructions[0] : undefined,
    primary: primaryValues("change", values),
    metadata: [
      ["Decision owner", fields.get("Decision owner")],
      ["Last activity", lastActivity && formatUtcDateTime(lastActivity)],
      ["Applies to", scope || fields.get("Applicable revision") || record.unit?.revision],
      ...(fields.has("Impact scope") ? [["Impact scope", fields.get("Impact scope")] as const] : []),
      ["Decision", decision ? decision.description : summary],
      ["Follow-up", fields.get("Follow-up")],
    ],
    label: links.some(link => link.role) ? "Change references" : "Affected records",
    links,
  };
}
