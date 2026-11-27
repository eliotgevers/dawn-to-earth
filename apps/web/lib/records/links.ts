import { methods } from "@/components/verification/model";
import { sectionLabels, type Section } from "../workspace-routes";
import { unitSelection } from "@/components/workspace/selection";
import type { RecordUnit, UnitEdition } from "./journal";
import type { AssemblyRecord } from "@/db/records/assembly";

export function recordField(record: Pick<AssemblyRecord, "fields">, label: string) {
  return record.fields.find(([name]) => name === label)?.[1];
}

type WorkOrder = { id: string; title: string; priority: number; activity?: string };

export function compareWork(a: WorkOrder, b: WorkOrder) {
  return a.priority - b.priority || (b.activity ?? "").localeCompare(a.activity ?? "") ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function recordHref(section: "engineering" | "production" | "verification" | "operations",
  id: string | undefined, unit?: UnitEdition | null, parameters?: Record<string, string>) {
  const query = new URLSearchParams(unit ? { item: unitSelection(unit.serial, unit.revisionId), ...parameters } : parameters);

  return "/" + section + (query.size ? "?" + query : "") + (id === undefined ? "" : "#" + id);
}

export function eventFindingConnection(id: string, sourceId: string, unit: RecordUnit, correlation: string): RecordConnection {
  return {
    href: recordHref("verification", encodeURIComponent(sourceId), unit, { eventFinding: id }),
    label: "Finding · " + correlation,
    location: "Verification",
  };
}

const recordTypes = {
  queue: "Queued work", build: "Build", issue: "Issue", requirement: "Requirement",
  interface: "Interface", component: "Component", configuration: "Configuration",
  change: "Change", evidence: "Evidence",
} as const;

// Authored headings use their creation day in the reference field. Older packets retain that value.
export function filedReference(value?: string) {
  const reference = value?.trim();

  return reference && !/^\d{4}-\d{2}-\d{2}$/.test(reference) ? reference : undefined;
}

export function recordLabel(kind: keyof typeof recordTypes, reference: string | undefined, title: string) {
  const filed = filedReference(reference);

  return filed ? `${recordTypes[kind]} ${filed}` : title;
}

// The href identifies the destination, including its edition. The other fields describe it to the reader.
export type RecordConnection = {
  role?: "Originating issue" | "Affected issue" | "Retained evidence";
  unavailable?: true;
  href: string;
  label: string;
  location?: string;
  identity?: string;
  detail?: string;
};

export function recordConnection(
  section: Section, id: string, unit: UnitEdition | null | undefined,
  { view, ...description }: Pick<RecordConnection, "label" | "identity" | "detail" | "unavailable" | "role"> & { view: string },
): RecordConnection {
  // Previously saved cross-references can carry the old tab caption.
  if (section === "verification" && view === "Electronics communication") view = methods.communication.label;

  return { href: recordHref(section, id, unit), ...description, location: [sectionLabels["/" + section], view].filter(Boolean).join(" · ") };
}

// Producers order relationships by relevance. Keep the first description of the same exact destination.
export function distinctConnections(links: readonly RecordConnection[]) {
  const seen = new Set<string>();

  return links.filter(({ href }) => {
    if (seen.has(href)) return false;
    seen.add(href);

    return true;
  });
}

export function linkedWork(links: readonly RecordConnection[], assignments: readonly { href: string; actionLabel: string; title: string }[]): RecordConnection | undefined {
  const matches = assignments.filter(task => links.some(link => !link.unavailable && link.href === task.href));
  if (matches.length !== 1) return;
  const [task] = matches;

  return { ...links.find(link => !link.unavailable && link.href === task.href)!, label: task.actionLabel, identity: task.title };
}

export function findingConnection(finding: {
  id: string; serial: string; revisionId: string; archiveId: string;
  first: number; last: number; observation: string;
}): RecordConnection {
  return {
    href: recordHref("verification", finding.archiveId, finding, { finding: finding.id }),
    label: `Finding · frames ${finding.first}–${finding.last}`,
    location: "Verification · Investigation",
    identity: finding.id,
    detail: finding.observation,
  };
}

export function substantiveValue(value: string | undefined, title: string) {
  const normalize = (text: string) => text.trim().replace(/[.!?]+$/, "").toLowerCase();

  return value && normalize(value) !== normalize(title) ? value : undefined;
}

export function recordUnitLabel(unit: RecordUnit): string;
export function recordUnitLabel(unit?: RecordUnit): string | undefined;
export function recordUnitLabel(unit?: RecordUnit) {
  return unit ? `${unit.serial} · ${unit.revision}` : undefined;
}
