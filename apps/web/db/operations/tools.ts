import { and, asc, desc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { isRecordUnit, type RecordUnit, type UnitEdition } from "@/lib/records/journal";
import { type ItemSelection, itemChipLabel, parseSelection } from "@/components/workspace/selection";
import { actionParent, actionUnit, amendedProductionRecord, editionJson, readRecordHistory, readReviews } from "../records/history";
import { fail, writeTransaction, type Reader, type WorkspaceDatabase } from "../connection";
import { toolCases, toolDecisions, toolAssignments, users, acceptanceChecks, assemblyRecords, deliveryPackets, planningTasks, verificationReviews, workspaceBaseline } from "../schema";
import { hasUnitRevision } from "@/components/catalog/store";
import type { CatalogEvidence } from "@/components/verification/model";
import { isObject, type ToolCommand, type ToolContext, type ToolId, type WorkCase, type WorkWrite } from "../workflows/cases";
import { acknowledgedAgreements, agreementData, agreementRequirementIds, decide as agreements } from "../workflows/agreements";
import { decide as audit } from "../workflows/audit";
import { decide as campaign } from "../workflows/campaign";
import { decide as containment } from "../workflows/containment";
import { decide as exchange } from "../workflows/exchange";
import { decide as improvement } from "../workflows/improvement";
import { decide as inventory, inventoryForPlanning } from "../workflows/inventory";
import { decide as qualification } from "../workflows/qualification";
import { decide as recall } from "../workflows/recall";
import { decide as reconciliation } from "../workflows/reconciliation";
import { decide as recovery, planningRecovery } from "../workflows/recovery";
import { decide as traveler, travelerExecution } from "../workflows/traveler";
import { readAcceptanceChecks, readReviewsWithoutSnapshot } from "../verification/acceptance";
import { loadCatalog } from "../catalog";
import { readActors, reviewers } from "../records/work";

// PostgreSQL records can differ within one millisecond. Keep their full timestamps for ordered replay.
const eventTime = sql<string>`to_char(${toolDecisions.at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Case history contains only decisions filed on that case. An alternate report supplies its
// document, never decisions from another comparison.
async function readCases(database: Reader, tools: ToolId[], scope?: string | SQL) {
  const caseMatch = (id: typeof toolCases.id | typeof toolDecisions.caseId) =>
    typeof scope === "string" ? eq(id, scope) : scope && inArray(id, scope);
  const alternateReport = tools[0] === "qualification" && typeof scope === "string"
    ? eq(sql`${toolCases.data}->>'sourceFor'`, scope) : undefined;

  const [cases, decisions] = await Promise.all([
    database.select().from(toolCases)
      .where(and(inArray(toolCases.tool, tools), or(caseMatch(toolCases.id), alternateReport)))
      .orderBy(asc(toolCases.title), asc(toolCases.id)),
    database.select({ ...getTableColumns(toolDecisions), at: eventTime }).from(toolDecisions)
      .where(and(inArray(toolDecisions.tool, tools), caseMatch(toolDecisions.caseId))),
  ]);
  const histories = Map.groupBy(decisions, event => event.caseId);

  return cases.map(record => ({
    ...record,
    // Equal timestamps retain their historical mixed-case ID ordering.
    history: (histories.get(record.id) ?? []).filter(event => event.tool === record.tool)
      .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id)),
  }));
}

// Intake checks the sender's prior receipts. Containment checks filed lot corrections.
function readRelatedEvents(db: Reader, tool: ToolId, caseId: string | undefined, preview: boolean) {
  const { tool: owner, kind, data, at, id } = toolDecisions;
  const receipt = and(eq(owner, "exchange"), eq(kind, "bundle-imported"));
  let fields: SQL<Record<string, unknown>>;
  let filter: SQL | undefined;

  if (tool === "containment") {
    filter = or(receipt, and(eq(owner, "inventory"), eq(kind, "installation-recorded")));
    fields = sql`jsonb_build_object('lotCorrections', ${data}->'lotCorrections')`;
  } else if (tool === "exchange" && caseId !== undefined) {
    filter = receipt;
    fields = sql`jsonb_build_object('bundleId', ${data}->'bundleId', 'receivedFrom', ${data}->'receivedFrom')
      ${preview ? sql`|| jsonb_build_object('manifest', ${data}->'manifest')` : sql``}`;
  } else {
    return [];
  }

  return db.select({ ...getTableColumns(toolDecisions), at: eventTime, data: fields })
    .from(toolDecisions).where(filter).orderBy(asc(at), asc(id));
}

// These are the pages that render assignment owners, counts or closure history.
const assignmentPages: Record<"index" | "detail", readonly ToolId[]> = {
  index: ["recovery", "recall", "qualification"],
  detail: ["agreements", "audit", "recall", "qualification"],
};

export async function readToolState(
  database: Reader, tool: ToolId, caseId?: string,
  mode: "screen" | "decision" = "decision",
) {
  const showTasks = mode === "decision" || assignmentPages[caseId === undefined ? "index" : "detail"].includes(tool);
  const [cases, relatedEvents, tasks] = await Promise.all([
    readCases(database, [tool], caseId),
    readRelatedEvents(database, tool, caseId, mode === "screen"),
    showTasks ? database.select().from(toolAssignments).where(and(
      eq(toolAssignments.tool, tool),
      caseId === undefined ? undefined : eq(toolAssignments.caseId, caseId),
    )) : [],
  ]);

  return { cases, relatedEvents, tasks };
}

export function readDecisionHistory(database: Reader) {
  // Opening and closing decisions inherit the assignment's subject. Only unassigned decisions use the case unit.
  const subject = sql`case when ${toolAssignments.id} is null then ${toolCases.unit} else ${toolAssignments.unit} end`;

  return database
    .select({
      id: toolDecisions.id,
      title: toolDecisions.title,
      caseId: toolCases.id,
      caseUnit: toolCases.unit,
      tool: toolCases.tool,
      at: eventTime,
      actor: users.name,
      units: sql<RecordUnit[]>`coalesce(jsonb_agg(distinct ${subject}) filter (where ${subject} is not null), '[]')`,
      selections: sql<ItemSelection[]>`coalesce(jsonb_agg(distinct ${toolAssignments.selection})
        filter (where ${toolAssignments.selection} is not null), '[]')`,
    })
    .from(toolDecisions)
    .innerJoin(toolCases, eq(toolCases.id, toolDecisions.caseId))
    .innerJoin(users, eq(users.id, toolDecisions.actor))
    .leftJoin(toolAssignments, or(eq(toolAssignments.eventId, toolDecisions.id), eq(toolAssignments.completedBy, toolDecisions.id)))
    .groupBy(toolDecisions.id, toolCases.id, users.id);
}

function casesAtUnit(unit: UnitEdition, buildId?: string) {
  return sql`(select ${toolCases.id} from ${toolCases} where ${toolCases.unit} @> ${editionJson(unit)}::jsonb
    ${buildId === undefined ? sql`` : sql`and ${toolCases.data}->>'buildId' = ${buildId}`})`;
}

export async function readTravelerExecution(database: Reader, build?: { id: string; unit: RecordUnit }) {
  const cases = await readCases(database, ["traveler"], build && casesAtUnit(build.unit, build.id));

  return travelerExecution(cases);
}

// Packet eligibility uses the agreed customer scope and outstanding shop-floor holds.
export async function readAcknowledgedAgreements(database: Reader) {
  const cases = await readCases(database, ["agreements"]);

  return acknowledgedAgreements(cases);
}

export async function readReleaseBasis(database: Reader, unit?: UnitEdition) {
  const cases = await readCases(database, ["agreements", "traveler"], unit && casesAtUnit(unit));

  return { agreements: acknowledgedAgreements(cases), holds: travelerExecution(cases).holds };
}

export async function readProductionExecution(database: Reader, view: "builds" | "planning" | "publication") {
  const includeLinks = view !== "publication";
  const sources: ToolId[] = ["traveler"];
  if (includeLinks) sources.push("inventory");
  if (view !== "builds") sources.push("recovery");
  const [cases, studies] = await Promise.all([
    readCases(database, sources),
    // Planning links an order to a build. Its detailed handoff register stays in the study.
    includeLinks ? database.select({ caseId: toolCases.id, title: toolCases.title,
      buildId: sql<unknown>`entry->'buildId'`, unit: sql<unknown>`entry->'unit'` })
      .from(toolCases).crossJoin(sql`jsonb_array_elements(case when jsonb_typeof(${toolCases.data}->'orders') = 'array'
        then ${toolCases.data}->'orders' else '[]'::jsonb end) as entry`)
      .where(eq(toolCases.tool, "improvement")) : [],
  ]);

  return {
    execution: {
      ...travelerExecution(cases),
      materials: inventoryForPlanning(cases),
      studies: studies.flatMap(({ caseId, title, buildId, unit }) =>
        typeof buildId === "string" && isRecordUnit(unit) ? [{ caseId, title, buildId, unit }] : []),
    },
    recoveries: planningRecovery(cases),
  };
}

// Case documents are stored as JSON. Only the owning workflow defines what a field refers to.
function ids(values: unknown[]) {
  return [...new Set(values.filter(value => typeof value === "string"))];
}

function fieldIds(rows: unknown, field: string) {
  return Array.isArray(rows) ? ids(rows.map(row => row?.[field])) : [];
}

// Both the screen and its decision use these sources. Audit decisions use the filed snapshot.
function caseSources(tool: ToolId, cases: WorkCase[], dossier: WorkCase | undefined, screen: boolean) {
  const data = dossier?.data;

  switch (tool) {
    case "agreements": {
      if (!screen || !dossier) return {};
      const { related } = agreementData(dossier);
      const verification = related.filter(link => link.section === "verification").map(link => link.id);

      return {
        records: related.filter(link => link.section !== "verification").map(link => link.id),
        evidence: verification,
        checks: verification,
      };
    }
    case "recovery":
    case "traveler": {
      const rows = dossier ? [dossier] : screen ? cases : [];
      const issues = rows.map(row => row.data.issueId);
      if (tool === "recovery") return { records: ids(issues) };

      return {
        records: ids([...issues, ...rows.map(row => row.data.buildId)]),
        checks: ids(rows.map(row => row.data.checkId)),
      };
    }
    case "audit":
    case "campaign": {
      if (!data || (tool === "audit" && !screen)) return {};
      const requirement = isObject(data.requirement) ? data.requirement.id : undefined;
      const evidence = isObject(data.evidence) ? ids([data.evidence.id]) : [];
      if (tool === "campaign") return { records: ids([requirement]), evidence };

      const records = ids([data.buildId, requirement]);
      if (typeof data.checkId === "string" && data.checkId) return { records, checks: [data.checkId] };

      return { records, evidence, archiveRequirements: ids([requirement]) };
    }
    case "qualification": {
      // The scoped query includes the selected comparison and its alternate reports.
      const records = ids([data?.requirementId]);
      if (!screen || !dossier) return { records };

      const proposals = dossier.history.filter(event => event.kind === "reuse-proposed");

      return { records, evidence: ids([...cases, ...proposals].map(row => row.data.evidenceId)) };
    }
    case "improvement":
    case "inventory": return { records: fieldIds(data?.orders, "buildId") };
    case "reconciliation": return { records: ids([data?.buildId]) };
    case "recall": return { evidence: fieldIds(data?.entries, "evidenceId") };
    default: return {};
  }
}

export async function readToolContext(
  db: Reader, tool: ToolId, caseId?: string,
  mode: "screen" | "decision" = "screen",
) {
  const [state, catalog, actors] = await Promise.all([
    readToolState(db, tool, caseId, mode), loadCatalog(db), readActors(db),
  ]);
  const cases = caseId ? state.cases : state.cases.filter(row => !row.data.sourceFor);
  const dossier = cases.find(row => row.id === caseId && !row.data.sourceFor);
  const screen = mode === "screen";
  const detail = screen ? dossier : undefined;
  const audit = screen && tool === "audit";
  const auditUnit = audit ? detail?.unit : undefined;
  const packetUnit = detail?.tool === "agreements" ? detail.unit : undefined;
  const requirements = packetUnit && detail ? agreementRequirementIds(agreementData(detail)) : [];

  const { records: recordIds = [], evidence: evidenceIds = [], checks: checkIds = [], archiveRequirements = [] } =
    caseSources(tool, cases, dossier, screen);
  const subjects = [...recordIds, ...evidenceIds];
  const data = assemblyRecords.data;

  const [assembly, archive, local, reviews, checks, reviewsWithoutSnapshot, reservations, packets, acknowledgedAgreements, qualificationCases, lotNotices, packetCheck] = await Promise.all([
    recordIds.length ? db.select({ data, article: sql<RecordUnit | null>`(select ${workspaceBaseline.verification}->'article' from ${workspaceBaseline}
      where ${assemblyRecords.section} = 'production' and ${data}->>'unit' is null limit 1)` })
      .from(assemblyRecords).where(inArray(assemblyRecords.id, recordIds)) : [],
    evidenceIds.length || archiveRequirements.length ? db.select({
      evidence: sql<CatalogEvidence[]>`jsonb_path_query_array(${workspaceBaseline.verification},
        '$.catalogEvidence[*] ? (@.id == $ids[*] || @.requirement.id == $requirements[*])',
        ${JSON.stringify({ids: evidenceIds, requirements: archiveRequirements})}::jsonb)`,
    }).from(workspaceBaseline).limit(1) : [],
    (subjects.length && tool !== "recall") || auditUnit ? readRecordHistory(db, auditUnit ? sql`${actionUnit} @> ${editionJson(auditUnit)}::jsonb`
        : inArray(actionParent, subjects)) : [],
    auditUnit && !checkIds.length ? readReviews(db, sql`${verificationReviews.data}->'scope' @> ${JSON.stringify({ selection: `unit:${auditUnit.serial}`, revision: auditUnit.revisionId })}::jsonb`) : [],
    checkIds.length ? readAcceptanceChecks(db, checkIds) : [],
    audit && !caseId ? readReviewsWithoutSnapshot(db) : [],
    tool === "recovery" && recordIds.length ? db.select({
      id: planningTasks.id, issueId: planningTasks.issueId, checkId: planningTasks.checkId,
      unit: sql<RecordUnit>`${acceptanceChecks.data}->'unit'`,
    }).from(planningTasks).innerJoin(acceptanceChecks, eq(acceptanceChecks.id, planningTasks.checkId))
      .where(and(inArray(planningTasks.issueId, recordIds), sql`${acceptanceChecks.data}->>'id' = ${planningTasks.checkId}`)) : [],
    packetUnit ? db.select({ id: deliveryPackets.id, version: deliveryPackets.version,
      scopes: sql<NonNullable<typeof deliveryPackets.$inferSelect.contents.scopes>>`coalesce(${deliveryPackets.contents}->'scopes', '[]'::jsonb)`,
    }).from(deliveryPackets).where(and(eq(deliveryPackets.serial, packetUnit.serial), eq(deliveryPackets.revisionId, packetUnit.revisionId)))
      .orderBy(desc(deliveryPackets.version)) : [],
    detail?.tool === "qualification" ? readAcknowledgedAgreements(db) : [],
    requirements.length && packetUnit ? db.select({
      id: toolCases.id, title: toolCases.title, requirement: sql<string>`${toolCases.data}->>'requirement'`,
    })
      .from(toolCases).where(and(eq(toolCases.tool, "qualification"),
        eq(sql`${toolCases.data}->>'revisionId'`, packetUnit.revisionId),
        or(isNull(toolCases.unit), sql`${toolCases.unit} @> ${editionJson(packetUnit)}::jsonb`),
        inArray(sql`${toolCases.data}->>'requirementId'`, requirements)))
      .orderBy(asc(toolCases.title), asc(toolCases.id)) : [],
    detail?.tool === "exchange" ? db.select({
      id: toolCases.id, title: toolCases.title, lotId: sql<string>`${toolCases.data}->>'lotId'`,
    }).from(toolCases).where(eq(toolCases.tool, "containment")).orderBy(asc(toolCases.title), asc(toolCases.id)) : [],
    packetUnit ? db.select({id: acceptanceChecks.id}).from(acceptanceChecks)
      .where(sql`${acceptanceChecks.data}->'unit' @> ${editionJson(packetUnit)}::jsonb`).limit(1) : [],
  ]);

  const workspace = {
    catalog, actors, users: reviewers(actors),
    assembly: assembly.map(({ data, article }) => amendedProductionRecord(data, local, data.unit ?? article ?? undefined)),
    evidence: archive[0]?.evidence ?? [], checks, local, reviews, reviewsWithoutSnapshot,
    reservations, packets, acknowledgedAgreements, qualificationCases, lotNotices, hasUnitAcceptance: packetCheck.length > 0,
  };

  return { ...state, cases, dossier, workspace };
}

const decide: Record<ToolId, (context: ToolContext, command: ToolCommand) => WorkWrite | string> = {
  agreements, audit, campaign, containment, exchange, improvement,
  inventory, qualification, recall, reconciliation, recovery, traveler,
};

export async function recordToolDecision(
  db: WorkspaceDatabase,
  tool: ToolId,
  input: Record<string, unknown>,
) {
  const { caseId, action, actor, data } = input;
  if (
    typeof caseId !== "string" ||
    typeof action !== "string" ||
    typeof actor !== "string" ||
    !isObject(data) ||
    JSON.stringify(data).length > 450_000
  )
    return fail("Invalid decision.", 400);

  return writeTransaction(db, async tx => {
    const state = await readToolContext(tx, tool, caseId, "decision");
    const { catalog, actors } = state.workspace;
    const { dossier } = state;
    if (!dossier) return fail("The source record is unavailable.", 404);
    const actorIds = new Set<string>(actors.map((person) => person.id));
    if (!actorIds.has(actor)) return fail("Unknown recorder.", 400);
    const write = decide[tool](state, { dossier, action, actor, data });
    if (typeof write === "string") return fail(write);
    const tasks = write.tasks ?? [];
    for (const {owner, sourceId, title, unit, selection} of tasks) {
      if (!actorIds.has(owner) || !sourceId || !title)
        return fail("Assignment needs a source and a known owner.");
      if (unit && !catalog.units.some(row => row.serial === unit.serial && hasUnitRevision(row, unit.revisionId)))
        return fail("Assignment does not match a recorded unit revision.");
      if (selection && (!parseSelection(selection) || !itemChipLabel(catalog, selection)))
        return fail("Assignment scope is unavailable.");
    }
    const completions = write.completeTaskIds ?? [];
    if (completions.some(id => !state.tasks.some(task => task.id === id && !task.completedAt)))
      return fail("The assignment is no longer open on this case.");
    const id = crypto.randomUUID();
    await tx
      .insert(toolDecisions)
      .values({
        id,
        caseId,
        tool,
        kind: write.kind,
        title: write.title,
        actor,
        data: write.data,
        at: sql`clock_timestamp()`,
      });
    if (completions.length) {
      // The decision read is exact-case and the workspace write lock is held until commit.
      await tx.update(toolAssignments)
        .set({ completedAt: sql`clock_timestamp()`, completedBy: id })
        .where(inArray(toolAssignments.id, completions));
    }
    if (tasks.length)
      await tx
        .insert(toolAssignments)
        .values(tasks.map((task) => ({ ...task, id: crypto.randomUUID(), eventId: id, caseId, tool })));

    return { eventId: id };
  });
}
