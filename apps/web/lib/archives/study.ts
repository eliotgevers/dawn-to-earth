import { type ItemSelection, scopeSource } from "@/components/workspace/selection";
import type { readOperationsStudy } from "@/db/operations/study";
import type { operationsStudyFindings } from "@/db/schema";
import { isCatalogArchived, type Catalog, type CatalogDirectory } from "@/components/catalog/store";
import * as aurora from "./aurora";
import * as docking from "./docking";

// Frames are one-based indices in the archived subject. The server resolves the source snapshot.
export type StudyDraft = Pick<typeof operationsStudyFindings.$inferSelect, "subject" | "first" | "last" | "outcome" | "note">;

// A design sheet can belong to a revision without a unit. A unit archive always names the serial that supplied it.
export type StudyFiling = { projectId: string; serial: string | null; revisionId: string };
export type StudyScope = StudyFiling & { selection: ItemSelection; systemId: string };
export type StudyTarget = { scope: StudyScope; label: string; subjects: string[] };

export type StudyHistory = Awaited<ReturnType<typeof readOperationsStudy>>;

export type OperationsStudyProps = Pick<StudyHistory, "availableArchives" | "selected"> & {
  scopeSelected: boolean;
  subjects: readonly string[];
  save: (draft: StudyDraft) => Promise<string | undefined>;
};

export const operationsStudies = {
  aurora: "Aurora Flight Archive",
  docking: "Interface Review",
} as const;

export type StudyId = keyof typeof operationsStudies;

export function interfaceCompareHref(params: URLSearchParams, recordKey?: string) {
  const query = new URLSearchParams(params);
  query.set("view", "configuration");
  query.set("part", "interfaces");
  query.set("compare", recordKey ?? query.get("compare") ?? "interface");

  return "/engineering?" + query;
}

export function isOperationsStudy(id: string): id is StudyId {
  return Object.hasOwn(operationsStudies, id);
}

// Verify that a client still has the same filed input as the server before recording a new judgment.
export async function sourceFingerprint(source: object) {
  // PostgreSQL JSONB reorders object keys. The digest identifies the reviewed content in either ordering.
  const json = JSON.stringify(source, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value,
  );
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));

  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export const studyArchives = { aurora, docking };

export function filedSource(study: StudyId, subject: string) {
  const archive = studyArchives[study];
  const source = archive.sourceFor(subject);
  if (source) return { source, edition: "edition" in source ? source.edition : archive.edition };
}

// The writer checks the interval and decision against the same source that will be frozen in its receipt.
export function studyOutcomes(source: NonNullable<ReturnType<typeof filedSource>>["source"], first: number, last: number): readonly string[] {
  if (first < 1 || first > last) return [];
  if ("feature" in source) return last === 1 ? docking.reviewOutcomes(source.feature) : [];
  return last <= source.pair.reviewed.frames.length ? aurora.outcomes : [];
}

// These are explicit archive filings, independent of public mission references and of users' current selections.
export function studyFilings(study: keyof typeof studyArchives) {
  if (study === "docking") {
    return docking.interfaces.flatMap(record => record.features.map(featureId => ({
      filing: record.filing,
      subject: docking.subjectFor(record, featureId),
    })));
  }

  const events = Object.keys(aurora.events) as aurora.EventId[];

  return aurora.pairs.flatMap(pair => events.map(event => ({
    filing: aurora.filings[pair.id],
    subject: aurora.subjectFor(pair, event),
  })));
}

export function studyCatalog(catalog: CatalogDirectory) {
  const projects = catalog.projects.filter(row => !isCatalogArchived(catalog, "project", row.id));
  const projectRevisions = new Map(projects.map(project => [project.id, new Set(project.revisionIds)]));
  const units = new Map(catalog.units
    .filter(row => !isCatalogArchived(catalog, "unit", row.serial))
    .map(row => [row.serial, row]));
  const revisions = new Map(catalog.revisions
    .filter(row => !isCatalogArchived(catalog, "system", row.systemId))
    .map(row => [row.id, row]));

  function sourcesFor(study: StudyId) {
    // Match the source's filed assignment once. Never lend a neighboring serial's archive to an empty scope.
    const sources = new Map<string, Omit<StudyScope, "selection"> & { subjects: string[] }>();
    for (const { filing, subject } of studyFilings(study)) {
      if (!filing) continue;
      const { projectId, serial, revisionId } = filing;
      const revision = revisions.get(revisionId);
      if (!revision || !projectRevisions.get(projectId)?.has(revisionId)) continue;
      const unit = serial !== null && units.get(serial);
      if (serial !== null && (!unit || unit.projectId !== projectId || unit.revisionId !== revisionId)) continue;
      const key = JSON.stringify([projectId, revisionId, serial]);
      const source = sources.get(key);
      if (source) source.subjects.push(subject);
      else sources.set(key, { ...filing, systemId: revision.systemId, subjects: [subject] });
    }

    return [...sources.values()];
  }

  return { projects, units, revisions, sourcesFor };
}

// Public reports follow the selected projects. Recordings also have an exact filed revision and optional serial.
export function studyScope(catalog: Catalog, selections: readonly ItemSelection[], study?: StudyId) {
  const { projects, units, revisions, sourcesFor } = studyCatalog(catalog);
  const sources = study ? sourcesFor(study) : [];
  const targets: StudyTarget[] = [];
  if (!selections.length) {
    const filings = Map.groupBy(sources, source => source.projectId);
    const availableArchives = projects.flatMap(project => {
      const records = filings.get(project.id);

      return records ? [{ selection: `project:${project.id}` as const, label: project.title,
        subjects: records.flatMap(row => row.subjects) }] : [];
    });

    return { projectIds: projects.map(project => project.id), availableArchives, targets };
  }

  const projectIds = new Set<string>();
  for (const selection of selections) {
    const item = scopeSource(catalog, selection);
    if (!item) continue;
    const { unit, label, projectId, revisionIds } = item;
    if (unit && (!units.has(unit.serial) || unit.revisionId !== revisionIds[0])) continue;

    const activeEditions = new Set(revisionIds.filter(id => revisions.has(id)));

    // A project or unit has one owner. Systems and revisions can span several projects.
    function includesProject(id: string, editions: readonly string[]) {
      if (unit) return unit.projectId === id;
      if (projectId) return projectId === id;

      return editions.some(edition => activeEditions.has(edition));
    }

    for (const project of projects) {
      if (includesProject(project.id, project.revisionIds)) projectIds.add(project.id);
    }
    for (const { subjects, ...filing } of sources) {
      if ((!unit || filing.serial === unit.serial) && includesProject(filing.projectId, [filing.revisionId])) {
        targets.push({ scope: { ...filing, selection }, label, subjects });
      }
    }
  }

  return { projectIds: [...projectIds], availableArchives: [], targets };
}
