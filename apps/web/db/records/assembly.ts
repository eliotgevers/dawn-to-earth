import { buildWorkState, linkedBuildIssueIds } from "@/components/production/builds";
import { authoredFields, connectionToRecord, type LinkableRecord } from "@/components/records/schema";
import { type EvidenceRecord, type EvidenceReview, type ReviewDecision, type VerificationTest } from "@/components/verification/model";
import { imageComparisonConnection } from "@/components/verification/acceptance";
import { evidenceDecisions } from "@/components/verification/outcomes";
import { authoredHeading, recordKinds, sameUnit, type ChangeImpact, type RecordEntry, type RecordUnit, type UnitEdition } from "@/lib/records/journal";
import { distinctConnections, recordConnection, type RecordConnection } from "@/lib/records/links";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { readAcceptanceChecks } from "../verification/acceptance";
import { loadCatalog } from "../catalog";
import { type Reader } from "../connection";
import { actionParent, actionUnit, amendedProductionRecord, editionJson, readArticle, readCurrentRecords, readReviews } from "./history";
import { readSchedule } from "../planning";
import type { AssemblyRecord as StoredAssemblyRecord } from "../schema";
import { assemblyRecords, engineeringWork, inspectionFindings, revisionReviews, toolAssignments, workItems, workspaceRecords } from "../schema";
import { readProductionExecution, readTravelerExecution } from "../operations/tools";
import { readEvidenceIndex } from "../verification/evidence";
import { readActors, reviewers, workDestination } from "./work";

export type AssemblyRecord = Omit<StoredAssemblyRecord, "origin"> & {
  origin: "fixture" | "local";
  links: readonly RecordConnection[];
  buildId?: string;
  recordedAt?: string;
  flaggedBuildId?: string;
  impacts?: readonly (ChangeImpact & { target?: Omit<LinkableRecord, "id"> })[];
  context?: string;
};

export type WorkspaceRecords = Awaited<ReturnType<typeof readAssembly>>["records"];

function authoredAssembly(record: RecordEntry): AssemblyRecord[] {
  const {kind, action} = record;
  if (kind === "evidence") return [];
  const {id, title, origin, status, tone, reference, unit, designKind, impacts, context, recordedAt} = authoredHeading(record);

  return [{
    id, title, origin, kind, status, tone, reference, unit, designKind, impacts, context, recordedAt,
    fields: authoredFields(record),
    links: [], flaggedBuildId: action?.parentId,
  }];
}

// A build flag is both the original history entry and an editable issue with its own ID.
function assemblySections(assembly: readonly {data: StoredAssemblyRecord; buildId: string | null}[],
  { records, history }: Awaited<ReturnType<typeof readCurrentRecords>>, article: RecordUnit) {
  const production: AssemblyRecord[] = [], engineering: AssemblyRecord[] = [];
  for (const record of [
    ...records.flatMap(authoredAssembly),
    ...assembly.map(({data, buildId}) => ({ ...data, buildId: buildId ?? undefined, links: [] })),
  ]) {
    if (recordKinds[record.kind].section === "production")
      production.push(amendedProductionRecord(record, history, record.unit ?? article));
    else engineering.push(record);
  }

  return { production, engineering };
}

// Engineering links to the original records. Method captures keep their existing article applicability;
// a replacement remains available to Change Impact without becoming a new requirement link choice.
function engineeringEvidence(data: Awaited<ReturnType<typeof readEvidenceIndex>>,
  authored: readonly RecordEntry[], reviews: readonly EvidenceReview[]) {
  const lookup = evidenceDecisions(reviews, data.article, data.review);
  function source({id, title, unit, type, recordedAt, source: filedSource, sourceSheet, exchangeArchive}: LinkableRecord, test: VerificationTest | undefined, linkUnit?: EvidenceRecord["unit"], decision?: ReviewDecision,
    gap?: { requirementId: string; next: string; at: string }) {
    return {id, title, unit, test, type, recordedAt, source: filedSource, sourceSheet, exchangeArchive, linkUnit, decision, gap};
  }

  return [
    ...Object.entries(data.records).flatMap(([test, rows]) => rows.map(row =>
      source(row, test as VerificationTest, row.capture?.replaces ? undefined : data.article, lookup(row, test as VerificationTest).conclusion?.decision))),
    ...data.catalogEvidence.map(row => {
      const {conclusion} = lookup(row, row.test);

      return source(row, row.test, row.unit, conclusion?.decision, conclusion?.decision === "Follow-up needed"
        ? { requirementId: row.requirement.id, next: row.followUp ?? conclusion.reason, at: conclusion.recordedAt } : undefined);
    }),
    ...authored.map(row => source(row, row.test, row.unit ?? data.article, lookup(row, row.test).conclusion?.decision)),
    ...data.acceptanceChecks.flatMap(check => (check.captures ?? []).map(({id, source: title}) =>
      source({id, title: title || "Acceptance follow-up", unit: check.unit}, undefined, check.unit))),
  ];
}

async function readAssembly(db: Reader, board: "engineering" | "production", planning = false) {
  const {data, position, buildId} = assemblyRecords;
  const [catalog, assembly, verification, journal, reviews, actors, linkedWork, assignments, toolTasks] = await Promise.all([
    loadCatalog(db),
    db.select({buildId, data}).from(assemblyRecords).orderBy(asc(position)),
    readEvidenceIndex(db), readCurrentRecords(db, board === "production" ? ne(workspaceRecords.kind, "evidence") : undefined),
    board === "engineering" ? readReviews(db) : [], readActors(db),
    db.select({ ...workDestination, id: workItems.id }).from(workItems).where(isNull(workItems.completedAt)),
    db.select().from(revisionReviews).orderBy(desc(revisionReviews.createdAt)),
    db.select().from(toolAssignments).where(and(eq(toolAssignments.section, board), isNull(toolAssignments.completedAt))),
  ]);
  const planningGates = new Set(planning ? verification.acceptanceChecks.flatMap(check => check.changeId ? [check.changeId] : []) : []);
  const { production, engineering } = assemblySections(assembly, journal, verification.article);
  const evidence = verification.catalogEvidence;
  const byParent = Map.groupBy(evidence, row => board === "engineering" ? row.requirement.id : row.build.id);
  const comparisons = new Map(verification.acceptanceChecks.flatMap(check => {
    const link = imageComparisonConnection(check);

    return link && check.comparison ? [[check.comparison.evidenceId, link] as const] : [];
  }));
  const destinations = {
    engineering: new Map(engineering.map(row => [row.id, row])),
    production: new Map(production.map(row => [row.id, row])),
    verification: new Map([...Object.entries(verification.records).flatMap(([test, rows]) => rows.map(row => ({ ...row, test: test as VerificationTest }))), ...evidence].map(row => [row.id, row])),
  };
  function linkedRecord(record: AssemblyRecord, section: "engineering" | "production"): AssemblyRecord {
    if (record.origin === "local") {
      if (!record.impacts) return record;
      const impacts = record.impacts.map(({section, id}) => {
        const row = destinations[section].get(id);
        const target = row && { title: row.title, kind: row.kind, reference: row.reference, designKind: row.designKind, unit: row.unit ?? (section === "production" ? verification.article : record.unit) };

        return { section, id, target };
      });
      return { ...record, impacts };
    }
    const {overviewLinks, source, ...row} = record;
    if (source && !row.history) row.history = verification.bracketEvents.filter(event => event.record === source);
    if (section !== board) return {
      ...row, buildId: undefined, history: record.history?.slice(-1) ?? row.history,
      fields: row.fields.filter(([key]) => key === "Work instruction" || key === "Evidence pending" || key === "Decision owner"),
    };
    const refs: { section: keyof typeof destinations; id: string; unit?: RecordUnit; relation?: string; detailField?: string }[] = [
      ...(overviewLinks ?? []),
      ...(byParent.get(row.id) ?? []).map(source => ({ section: "verification" as const, id: source.id })),
    ];
    if (board === "production" && (record.kind === "queue" || record.kind === "build")) {
      for (const check of verification.acceptanceChecks) {
        if (check.buildId !== record.id || !sameUnit(check.unit, row.unit ?? verification.article)) continue;
        if (check.issueId) refs.push({ section: "production", id: check.issueId, unit: check.unit });
        if (check.changeId) refs.push({ section: "engineering", id: check.changeId, unit: check.unit });
      }
    }
    const links = refs.map(({ section, id, unit, relation, detailField }): RecordConnection => {
      // Earlier fixtures also filed presentation captions here. Only these values identify the role of an edge.
      const role = relation === "Originating issue" || relation === "Affected issue" || relation === "Retained evidence" ? relation : undefined;
      const target = destinations[section].get(id);
      if (!target || (unit && target.unit && !sameUnit(unit, target.unit))) return recordConnection(section, id, unit ?? row.unit, {
        view: "", label: "Record unavailable", identity: id, role, unavailable: true,
      });
      if (section === "verification") {
        const comparison = comparisons.get(id);
        if (comparison) return { ...comparison, role };
      }
      const link = connectionToRecord(section, { ...target, unit: unit ?? target.unit });
      if (detailField && "fields" in target) link.detail = target.fields.find(([label]) => label === detailField)?.[1];

      return { ...link, role };
    });

    // Closeout checks use the filed IDs even when a target is unavailable to open.
    return { ...row, links: distinctConnections(links), overviewLinks: row.kind === "queue" || row.kind === "build" ? overviewLinks : undefined };
  }

  const { article, acceptanceChecks } = verification;
  const records = {
    catalog,
    verification: { article, acceptanceChecks },
    evidence: board === "engineering"
      ? engineeringEvidence(verification, journal.records.filter(row => row.kind === "evidence"), reviews) : [],
    engineering: engineering.filter(row => board === "engineering" || planningGates.has(row.id)).map(row => linkedRecord(row, "engineering")),
    production: production.map(row => linkedRecord(row, "production")),
  };

  return { records, actors, users: reviewers(actors), local: journal.history, workItems: linkedWork, assignments, toolTasks };
}

export async function readEngineering(db: Reader) {
  const [base, work, execution] = await Promise.all([
    readAssembly(db, "engineering"), db.select().from(engineeringWork), readTravelerExecution(db),
  ]);

  return { ...base, engineeringWork: work, holds: execution.holds };
}

export async function readProduction(db: Reader, view?: string) {
  const { id, serial, revisionId, archiveId, first, last, issueId, observation, createdAt } = inspectionFindings;
  const planning = view === "planning";
  const [base, { execution, recoveries }, schedule, findings] = await Promise.all([
    readAssembly(db, "production", planning), readProductionExecution(db, planning ? "planning" : "builds"),
    planning ? readSchedule(db) : undefined,
    db.select({ id, serial, revisionId, archiveId, first, last, issueId, observation }).from(inspectionFindings)
      .where(isNotNull(issueId)).orderBy(desc(createdAt)),
  ]);

  return { ...base, execution, schedule: schedule && { ...schedule, recoveries }, findings };
}

export type AssemblyWorkspace = Awaited<ReturnType<typeof readEngineering | typeof readProduction>>;

// The build and its journal were already read under the write lock. Only its linked issues,
// flag dispositions, QA decisions and traveler can change the next action.
export async function readBuildState(db: Reader, build: Pick<AssemblyRecord, "id" | "status" | "overviewLinks">, unit: RecordUnit, history: readonly RecordEntry[]) {
  const [checks, { holds, travelers }] = await Promise.all([
    readAcceptanceChecks(db, undefined, { ...unit, buildId: build.id }), readTravelerExecution(db, { id: build.id, unit }),
  ]);
  const ids = linkedBuildIssueIds(build.overviewLinks, checks);
  for (const entry of history) if (entry.action?.type === "flag" && sameUnit(entry.action.unit, unit)) ids.add(entry.id);
  let issues: AssemblyRecord[] = [];
  if (ids.size) {
    const issueIds = [...ids];
    const [issued, journal] = await Promise.all([
      db.select({ data: assemblyRecords.data, buildId: assemblyRecords.buildId }).from(assemblyRecords)
        .where(and(inArray(assemblyRecords.id, issueIds), sql`${assemblyRecords.data}->>'kind' = 'issue'`)),
      readCurrentRecords(db, and(eq(workspaceRecords.kind, "issue"),
        or(inArray(workspaceRecords.id, issueIds), inArray(actionParent, issueIds)))),
    ]);
    const article = issued.some(row => !row.data.unit) ? await readArticle(db) : unit;
    issues = assemblySections(issued, journal, article).production.filter(row => sameUnit(row.unit ?? article, unit));
    // Flag creation is already in the build journal; dispositions belong to the issue.
    history = [...history, ...journal.history.filter(row => row.action?.parentId !== build.id)];
  }

  return buildWorkState(build, unit, checks, history, holds, travelers, issues);
}

// Planning gates refer to issues and changes. Release packets need the production work on the target unit.
export async function readUnitWork(db: Reader, subject?: "planning" | UnitEdition) {
  const planning = subject === "planning";
  const unit = planning ? undefined : subject;
  const {data, section, position, buildId} = assemblyRecords;
  const scope = unit && editionJson(unit);
  // Earlier imports can omit the owner; resolve those against the workspace article below.
  const atUnit = (owner: SQL) => scope === undefined ? undefined : sql`(${owner} is null or ${owner} @> ${scope}::jsonb)`;
  const [article, checks, assembly, journal] = await Promise.all([
    readArticle(db),
    readAcceptanceChecks(db, undefined, unit),
    db.select({data, buildId}).from(assemblyRecords).where(planning
      ? sql`${data}->>'kind' in ('issue', 'change')`
      : and(eq(section, "production"), atUnit(sql`${data}->'unit'`))
    ).orderBy(asc(position)),
    readCurrentRecords(db, and(inArray(workspaceRecords.kind, planning ? ["issue", "change"] : ["queue", "build", "issue"]),
      atUnit(sql`coalesce(${actionUnit}, ${workspaceRecords.data}->'unit')`))),
  ]);
  const { production, engineering } = assemblySections(assembly, journal, article);
  const scoped = unit ? production.filter(record => sameUnit(record.unit ?? article, unit)) : production;

  return { production: scoped, verification: { article, acceptanceChecks: checks }, engineering, local: journal.history };
}
