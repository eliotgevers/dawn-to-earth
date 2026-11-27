import { readFile } from "node:fs/promises";
import { prepareFile } from "../engineering/design";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { catalogFlights, catalogSpacecraft, planScenarios, publishedPlans, publicReferences, catalogEntries, designFiles, revisionFiles, toolCases, toolDecisions } from "../schema";
import type { RecordWriter, WorkspaceDatabase } from "../connection";
import type { CaseRow } from "@/db/workflows/cases";
import { createHash } from "node:crypto";
import records from "./records.json";
import { parseReservations } from "../planning";
import { readActors, reviewers } from "../records/work";
import { isDeepStrictEqual } from "node:util";
import type { CatalogEntry, UnitConfiguration } from "@/components/catalog/store";
import { evidenceReferences, type EvidenceRecord } from "@/components/verification/model";

// A register and its opening history are introduced together. Never backfill movements into a saved ledger.
export async function seedMaterialRegisters(tx: RecordWriter, registers: CaseRow[], history: (typeof toolDecisions.$inferInsert)[]) {
  if (!registers.length) return;
  const created = await tx.insert(toolCases).values(registers).onConflictDoNothing().returning({ id: toolCases.id });
  const newIds = new Set(created.map(row => row.id));
  const moves = history.filter(move => newIds.has(move.caseId));
  if (moves.length) await tx.insert(toolDecisions).values(moves);
}

// Supply missing archive identities and improve untouched defaults. Keep the saved order and any authored rows.
export function mergeEvidence<T extends Pick<EvidenceRecord, "id" | "title" | "supports" | "capture">>(
  saved: readonly T[], curated: readonly T[], citedIds: ReadonlySet<string>, authoredCitations?: ReadonlySet<string>,
): T[] {
  const additions = new Map(curated.map(row => [row.id, row]));
  const updated = saved.map(row => {
    const next = additions.get(row.id);
    if (!next) return row;
    additions.delete(row.id);
    const identities = evidenceReferences(row);
    if (!identities.some(id => citedIds.has(id)) && publishedCopy("evidence", row.id, row)) return next;
    // Two intake captions named the expected outcome. Keep observations and authored review bases intact.
    if (authoredCitations && !identities.some(id => authoredCitations.has(id)) && publishedCopy("intakeCaptions", row.id, row))
      return { ...row, title: next.title, supports: next.supports };

    return row;
  });

  return [...updated, ...additions.values()];
}

type CatalogDefaults = {
  title?: (string | null)[];
  description?: (string | null)[];
  version?: string[];
  history?: Record<string, UnitConfiguration["history"]>;
};

// Include only links for newly inserted records. Removed links, assignments, and user-authored history survive.
export function mergeCatalogEntry(
  saved: CatalogEntry, prior: CatalogDefaults | undefined, curated: CatalogEntry, insertedWork: ReadonlySet<string>,
): CatalogEntry {
  if (!prior) return saved;
  const links = (savedIds: readonly string[], curatedIds: readonly string[]) =>
    [...new Set([...savedIds, ...curatedIds.filter(id => insertedWork.has(id))])];
  let updated = saved;
  if ("serial" in saved && "serial" in curated) {
    updated = { ...saved, configurations: saved.configurations.map(config => {
      const target = curated.configurations.find(row => row.revisionId === config.revisionId);
      if (!target) return config;
      const originals = prior.history?.[config.revisionId];
      const history = config.history.map(entry => originals?.some(original => isDeepStrictEqual(entry, original))
        ? target.history.find(row => row.date === entry.date && row.recordId === entry.recordId) ?? entry : entry);

      return { ...config, history, recordIds: links(config.recordIds, target.recordIds) };
    }) };
  } else if ("recordIds" in saved && "recordIds" in curated) {
    updated = { ...saved, recordIds: links(saved.recordIds, curated.recordIds) };
  }

  // Old wording is also a legitimate new edit. Upgrade it only when the whole row
  // matches the curated record after applying the known editorial corrections.
  const candidate: Record<string, unknown> = { ...updated };
  for (const [field, value] of Object.entries(curated)) {
    if (field !== "title" && field !== "description" && field !== "version") continue;
    if (prior[field]?.some(old => old === (candidate[field] ?? null))) candidate[field] = value;
  }

  return isDeepStrictEqual(candidate, curated) ? curated : updated;
}

const previous = records.priorDefaults;
export const priorDefaults = previous as typeof previous & { catalogEdits: Record<string, CatalogDefaults> };

type FingerprintGroup = "catalog" | "assembly" | "evidence" | "intakeCaptions" | "publicFlights" | "publicSpacecraft" | "planningSlots";
export function publishedCopy(group: FingerprintGroup, id: string, data: unknown) {
  const expected = (previous[group] as Record<string, string | string[]>)[id];
  if (!expected) return false;
  const json = JSON.stringify(data, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value);
  const hash = createHash("sha256").update(json).digest("hex");

  return Array.isArray(expected) ? expected.includes(hash) : expected === hash;
}

// Early installs recorded the Oasis dossier without its article. Only an untouched,
// never-reviewed source can gain that attribution; historical decisions keep their original scope.
export async function attachUnreviewedOasis(db: Pick<WorkspaceDatabase, "select" | "update">, cases: CaseRow[]) {
  const original = cases.find(row => row.id === "reuse-cover-index");
  if (!original?.unit) return;
  await db.update(toolCases).set({ unit: original.unit }).where(and(
    eq(toolCases.id, original.id), eq(toolCases.tool, "qualification"), isNull(toolCases.unit),
    eq(toolCases.title, original.title), sql`${toolCases.data} = ${JSON.stringify(original.data)}::jsonb`,
    notExists(db.select({ id: toolDecisions.id }).from(toolDecisions).where(eq(toolDecisions.caseId, original.id))),
  ));
}

// A report edition ID identifies the original observations, units and applicability assumptions.
// Replacing the source under that ID would make an old comparison appear reproducible from different inputs.
export async function verifyStudyEditions(db: Pick<WorkspaceDatabase, "execute">, studies: CaseRow[]) {
  const [changed] = await db.execute<{ id: string }>(sql`SELECT source.id
    FROM jsonb_populate_recordset(NULL::tool_cases, ${JSON.stringify(studies)}::jsonb) AS source
    LEFT JOIN tool_cases saved ON saved.id = source.id
    WHERE (saved.tool, saved.title, saved.unit, saved.data)
      IS DISTINCT FROM ('qualification', source.title, source.unit, source.data) LIMIT 1`);
  if (changed) throw Error("Changed qualification studies need a new edition ID: " + changed.id);
}

export async function seedRevisionFiles(tx: RecordWriter, files: Record<string, Record<string, string>>) {
  const revisions = await tx.select({ id: catalogEntries.id }).from(catalogEntries)
    .where(and(eq(catalogEntries.kind, "revisions"), inArray(catalogEntries.id, Object.keys(files))));
  const existing = new Set(revisions.map(revision => revision.id));
  const sources = Object.entries(files).flatMap(([revisionId, entries]) => existing.has(revisionId)
    ? Object.entries(entries).map(([file, label]) => ({ revisionId, file, label }))
    : []);
  if (!sources.length) return;
  const attachments = await Promise.all(sources.map(async ({ revisionId, file, label }) => {
    const bytes = await readFile(new URL("../../public/design/" + file, import.meta.url));

    return { revisionId, file: await prepareFile(label, bytes) };
  }));

  // Keep the first manifest name when multiple revisions share the same content.
  const contents = new Map<string, typeof designFiles.$inferInsert>();
  for (const { file } of attachments) {
    if (!contents.has(file.id)) contents.set(file.id, file);
  }
  await tx.insert(designFiles).values([...contents.values()]).onConflictDoNothing();
  await tx.insert(revisionFiles).values(attachments.map(({ revisionId, file }) => ({ revisionId, fileId: file.id })))
    .onConflictDoNothing();
}

// Both alternatives are snapshots of the original reservations (version zero).
// Later publications and planner-authored scenarios keep their own dates and assignments.
export async function seedPlanningScenarios(tx: RecordWriter) {
  const { tasks, scenarios } = records.planning;
  const people = reviewers(await readActors(tx));
  const rows = scenarios.map(({ id, title, savedAt, changes }) => {
    const edits = new Map(Object.entries(changes));
    const proposed = tasks.map(({ id: task, day, person, station }) => {
      const change = edits.get(task);
      edits.delete(task);

      return { task, day, person, station, ...change };
    });
    const slots = parseReservations(proposed, tasks, people);
    if (edits.size || !slots) throw Error("Invalid reservations in scenario: " + title);

    return { id, title, savedAt, baseVersion: 0, slots };
  });

  const previous = await tx.select().from(planScenarios).where(inArray(planScenarios.id, rows.map(row => row.id)));
  const byId = new Map(previous.map(row => [row.id, row]));
  for (const next of rows) {
    const saved = byId.get(next.id);
    if (!saved || !publishedCopy("planningSlots", saved.id, saved.slots)) continue;

    // Only extend the two original, unpublished examples. A published version cites its exact saved slots.
    await tx.update(planScenarios).set({ slots: next.slots }).where(and(
      eq(planScenarios.id, next.id), eq(planScenarios.title, next.title),
      eq(planScenarios.savedAt, next.savedAt), eq(planScenarios.baseVersion, next.baseVersion),
      eq(planScenarios.slots, saved.slots),
      notExists(tx.select({ version: publishedPlans.version }).from(publishedPlans).where(eq(publishedPlans.scenario, next.id))),
    ));
  }

  return tx.insert(planScenarios).values(rows).onConflictDoNothing().returning({ id: planScenarios.id });
}

export async function seedPublicArchive(tx: RecordWriter) {
  const { programs, spacecraft, flights, pixxel } = records.publicArchive;
  const flightRows = flights.map(({ kind, precision, ...flight }, position): typeof catalogFlights.$inferInsert => {
    if ((kind !== "flight" && kind !== "campaign") ||
        (precision !== "day" && precision !== "month" && precision !== "year" && precision !== "range"))
      throw Error("Invalid flight archive entry: " + flight.id);

    return { id: flight.id, data: { ...flight, kind, precision, position } };
  });

  await tx.insert(catalogEntries).values(programs.map(({ id, title, customer, description, position }) => ({
    kind: "projects" as const, id, position, data: { id, title, customer, description, revisionIds: [], recordIds: [] },
  }))).onConflictDoNothing();
  await tx.insert(publicReferences).values(programs.map(({ referenceId: id, title, description: summary, status, sources, position }) =>
    ({ id, title, summary, status, sources, position })
  )).onConflictDoNothing();
  await tx.insert(catalogSpacecraft).values(spacecraft.map(data => ({ noradId: data.noradId, data }))).onConflictDoNothing();
  await tx.insert(catalogFlights).values(flightRows).onConflictDoNothing();

  const nextFlights = new Map(flightRows.map(row => [row.id, row.data]));
  const savedFlights = await tx.select().from(catalogFlights)
    .where(inArray(catalogFlights.id, Object.keys(priorDefaults.publicFlights)));
  for (const row of savedFlights) {
    const next = nextFlights.get(row.id);
    if (next && !isDeepStrictEqual(next, row.data) && publishedCopy("publicFlights", row.id, row.data))
      await tx.update(catalogFlights).set({ data: next }).where(and(eq(catalogFlights.id, row.id), eq(catalogFlights.data, row.data)));
  }

  const nextSpacecraft = new Map(spacecraft.map(row => [row.noradId, row]));
  const savedSpacecraft = await tx.select().from(catalogSpacecraft)
    .where(inArray(catalogSpacecraft.noradId, Object.keys(priorDefaults.publicSpacecraft).map(Number)));
  for (const row of savedSpacecraft) {
    const next = nextSpacecraft.get(row.noradId);
    if (next && !isDeepStrictEqual(next, row.data) && publishedCopy("publicSpacecraft", String(row.noradId), row.data))
      await tx.update(catalogSpacecraft).set({ data: next }).where(and(eq(catalogSpacecraft.noradId, row.noradId), eq(catalogSpacecraft.data, row.data)));
  }

  const earlierSummary = "Dawn identifies SatDrive on FFLY-1, FFLY-2 and FFLY-3. Pixxel documents the Firefly launch campaigns.";
  await tx.update(publicReferences).set({
    summary: pixxel.summary,
    sources: sql`case when ${publicReferences.sources} @> ${JSON.stringify([{ href: pixxel.source.href }])}::jsonb
      then ${publicReferences.sources} else ${publicReferences.sources} || ${JSON.stringify([pixxel.source])}::jsonb end`,
  }).where(and(eq(publicReferences.id, "pixxel-firefly"), eq(publicReferences.summary, earlierSummary)));
}
