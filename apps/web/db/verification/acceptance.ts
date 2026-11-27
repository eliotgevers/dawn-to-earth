import { captureEligibility, inspectInterval, sameArchiveEdition, type AcceptanceCheck } from "@/components/verification/acceptance";
import { recordConnection } from "@/lib/records/links";
import type { UnitEdition } from "@/lib/records/journal";
import { and, asc, desc, eq, exists, inArray, isNull, notExists, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { fail, writeTransaction, type Reader, type WorkspaceDatabase } from "../connection";
import { actionParent, actionType, actionUnit, editionJson, formText, isRequestId, recordRemovals } from "../records/history";
import { acceptanceChecks, assemblyRecords, decisions, evidence, inspectionAnalyses, inspectionFindings, toolCases, workspaceRecords, type ArchivedPair } from "../schema";

// Acceptance history

const evidenceAtCheck = and(
  eq(evidence.checkId, acceptanceChecks.id),
  eq(evidence.serial, sql`${acceptanceChecks.data}#>>'{unit,serial}'`),
  eq(evidence.revisionId, sql`${acceptanceChecks.data}#>>'{unit,revisionId}'`),
);
// New captures take precedence over imported history; equal timestamps use the evidence ID.
const currentEvidenceFirst = [asc(evidence.imported), desc(evidence.recordedAt), desc(evidence.id)];
const decisionSnapshot = eq(toolCases.id, sql`'audit-' || ${decisions.id}`);

// Older signed reviews have no frozen criterion. Only the cited evidence can supply a source link.
export async function readReviewsWithoutSnapshot(db: Reader) {
  const removed = db.select({ id: workspaceRecords.id }).from(workspaceRecords).where(and(
    eq(actionParent, evidence.id), eq(actionType, "remove"),
    eq(sql`${actionUnit}->>'serial'`, evidence.serial),
    eq(sql`${actionUnit}->>'revisionId'`, evidence.revisionId),
  ));

  const rows = await db.select({
    review: decisions,
    unit: sql<AcceptanceCheck["unit"]>`${acceptanceChecks.data}->'unit'`,
    source: evidence.source,
    removed: exists(removed).mapWith(Boolean),
  }).from(decisions)
    .innerJoin(evidence, eq(decisions.evidenceId, evidence.id))
    .innerJoin(acceptanceChecks, evidenceAtCheck)
    .leftJoin(toolCases, decisionSnapshot)
    .where(isNull(toolCases.id));

  return rows.map(({ review, unit, source, removed }) => ({
    id: review.id, decision: review.decision, reviewer: review.reviewer, reason: review.reason,
    recordedAt: review.recordedAt.toISOString(), unit,
    source: removed ? undefined : recordConnection("verification", review.evidenceId, unit, {
      view: "Acceptance Review", label: source, identity: review.evidenceId,
    }),
  })).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));
}

export async function readAcceptanceChecks(db: Reader, ids?: readonly string[], unit?: UnitEdition & { buildId?: string }) {
  const rows = await db.select({
    check: acceptanceChecks.data, capture: evidence, review: decisions, auditCaseId: toolCases.id,
  })
    .from(acceptanceChecks)
    .leftJoin(evidence, evidenceAtCheck)
    .leftJoin(decisions, eq(decisions.evidenceId, evidence.id))
    .leftJoin(toolCases, decisionSnapshot)
    .where(and(ids && inArray(acceptanceChecks.id, [...ids]),
      unit && sql`${acceptanceChecks.data}->'unit' @> ${editionJson(unit)}::jsonb`,
      unit?.buildId ? sql`${acceptanceChecks.data}->>'buildId' = ${unit.buildId}` : undefined))
    .orderBy(asc(acceptanceChecks.id), ...currentEvidenceFirst);

  return Array.from(Map.groupBy(rows, row => row.check.id).values(), group => ({
    ...group[0].check,
    captures: group.flatMap(({ capture, review, auditCaseId }) => capture ? [{
      ...capture, recordedAt: capture.recordedAt.toISOString(),
      review: review && { ...review, recordedAt: review.recordedAt.toISOString(), auditCaseId: auditCaseId ?? undefined },
    }] : []),
  }));
}

// Evidence capture and review

function text(value: unknown, max: number) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
}

async function selectedCheck(db: Reader, id: string, input: Record<string, unknown>) {
  const [row] = await db.select({ check: acceptanceChecks.data }).from(acceptanceChecks).where(eq(acceptanceChecks.id, id));
  const check = row?.check;

  return check && check.unit.serial === input.serial && check.unit.revisionId === input.revisionId ? check : undefined;
}

// Validate the displayed edition identities before attaching a saved range to a source.
export function archivedPair(check: AcceptanceCheck, displayed?: Record<string, unknown>): ArchivedPair | undefined {
  const pair = check.comparison;
  if (!pair?.runId || !pair.rerunId) return;
  if (displayed && (pair.evidenceId !== displayed.archiveId || pair.runId !== displayed.runId ||
    pair.rerunId !== displayed.rerunId || check.requirementId !== displayed.requirementId)) return;

  return { ...pair, runId: pair.runId, rerunId: pair.rerunId, requirementId: check.requirementId };
}

export async function writeAcceptance(db: WorkspaceDatabase, input: Record<string, unknown>) {
  const checkId = text(input.checkId, 120);
  if (!checkId) return fail("Choose an acceptance check.", 400);
  if (input.operation !== "capture" && input.operation !== "review") return fail("Unknown acceptance operation.", 400);

  return writeTransaction(db, async tx => {
    const check = await selectedCheck(tx, checkId, input);
    if (!check)
      return fail("The unit or revision does not match this acceptance check.");

    const scope = { checkId, ...check.unit };
    const exact = and(eq(evidence.checkId, checkId), eq(evidence.serial, scope.serial), eq(evidence.revisionId, scope.revisionId));
    const [latest, previous] = await tx.select().from(evidence).where(exact)
      .orderBy(...currentEvidenceFirst).limit(2);

    if (input.operation === "capture") {
      const observation = text(input.observation, 1000);
      if (!observation) return fail("Enter an observation.", 400);
      let source = text(input.source, 500);
      let mark = text(input.mark, 100);
      let interval: typeof evidence.$inferInsert["interval"] = null;
      const archive = archivedPair(check, input);
      if (check.comparison) {
        if (!archive) return fail("The archived runs or requirement changed. Reopen the comparison.");
        const selected = inspectInterval(check.comparison, input.start, input.end);
        if (!selected) return fail("Choose an interval from the two recorded runs.", 400);
        ({ interval, source, mark } = selected);
      }
      if (!source || mark === undefined) return fail("Enter a source and observation.", 400);
      const requestId = typeof input.requestId === "string" && /^[a-f0-9-]{36}$/i.test(input.requestId)
        ? input.requestId : crypto.randomUUID();
      const id = `acceptance-${requestId}`;
      const at = Math.max(Date.now(), (latest?.recordedAt.getTime() ?? 0) + 1);
      const inserted = await tx.insert(evidence).values({ id, ...scope, source, mark, observation, interval, archive, recordedAt: new Date(at) })
        .onConflictDoNothing().returning({ id: evidence.id });
      if (inserted.length) return { id };

      const [existing] = await tx.select().from(evidence).where(and(exact, eq(evidence.id, id)));
      const retry = existing && existing.source === source && existing.mark === mark &&
        existing.observation === observation && (archive ? sameArchiveEdition(check, existing.archive) : !existing.archive) &&
        existing.interval?.start === interval?.start && existing.interval?.end === interval?.end;
      return retry ? { id, status: 200 } : fail("This capture request was already used.");
    }

    const reason = text(input.reason, 500);
    const decision = input.decision;
    if (!reason || (decision !== "Approved" && decision !== "On hold"))
      return fail("Choose a decision and enter a reason.", 400);
    if (!latest || latest.id !== input.evidenceId)
      return fail("The evidence is no longer current for this build.");
    const { expected, ambiguous, archiveChanged, canApprove } = captureEligibility(check, latest, previous);
    if (decision === "Approved" && archiveChanged)
      return fail("Capture the current archived pair before approving this check.");
    if (ambiguous || (decision === "Approved" && !canApprove))
      return fail("This evidence cannot be approved. Capture a complete follow-up.");

    const [saved] = await tx.insert(decisions).values({
      id: crypto.randomUUID(), evidenceId: latest.id, reason, decision,
      reviewer: text(input.reviewer, 100) || "Quality assurance",
      recordedAt: new Date(Math.max(Date.now(), latest.recordedAt.getTime())),
    }).onConflictDoNothing().returning();
    if (!saved) return fail("This capture already has a decision.");

    // Freeze precisely the criterion, evidence and signed conclusion used here. Future edits have their own history.
    await tx.insert(toolCases).values({
      id: `audit-${saved.id}`, tool: "audit", title: `${check.unit.serial} · ${saved.decision} · ${latest.source}`,
      unit: check.unit,
      data: {
        checkId, buildId: check.buildId,
        requirement: { id: check.requirementId, expected },
        evidence: {
          id: latest.id, source: latest.source, observed: latest.mark, observation: latest.observation,
          interval: latest.interval, ...(latest.archive ? { archive: latest.archive } : {}), at: latest.recordedAt.toISOString(),
        },
        review: {
          id: saved.id, decision: saved.decision, actor: saved.reviewer, reason: saved.reason, at: saved.recordedAt.toISOString(),
        },
      },
    });

    return { id: saved.id };
  });
}

export async function acceptsIssueFinding(db: Reader, check: AcceptanceCheck, target: string) {
  if (check.issueId !== target) return false;
  const { serial, revisionId } = check.unit;
  const [issue] = await db.select({id: assemblyRecords.id}).from(assemblyRecords).where(and(
    eq(assemblyRecords.id, target),
    sql`${assemblyRecords.data} @> ${JSON.stringify({kind: "issue", unit: {serial, revisionId}})}::jsonb`,
    notExists(recordRemovals(db, [target], serial, revisionId)),
  ));

  return Boolean(issue);
}

export async function saveInspectionFinding(tx: Pick<WorkspaceDatabase,"select"|"insert">, input: Record<string, unknown>) {
  const { checkId, first, last, target } = input;
  const observation = formText(input.observation);
  if (typeof checkId !== "string" || typeof first !== "number" || typeof last !== "number" ||
    !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first ||
    typeof target !== "string" || !observation)
    return fail("Choose an interval and destination and describe the finding.", 400);

  const check = await selectedCheck(tx, checkId, input);
  const archive = check && archivedPair(check, input);
  if (!archive || last > archive.frames.length)
    return fail("The interval or edition does not match the archived run pair.");
  const id = isRequestId(input.requestId) ? input.requestId : crypto.randomUUID();
  const onIssue = target === check.issueId;
  const values = {
    id, checkId, serial: check.unit.serial, revisionId: check.unit.revisionId,
    archiveId: archive.evidenceId, first, last, observation,
    issueId: onIssue ? target : null, decisionId: onIssue ? null : target,
  };

  const [prior] = await tx.select({record: inspectionFindings, analysis: inspectionAnalyses.findingId}).from(inspectionFindings)
    .leftJoin(inspectionAnalyses, eq(inspectionAnalyses.findingId, inspectionFindings.id)).where(eq(inspectionFindings.id, id));
  if (prior) {
    const { createdAt: _, archive: originalEdition, ...original } = prior.record;
    if (prior.analysis || !sameArchiveEdition(check, originalEdition) || !isDeepStrictEqual(original, values))
      return fail("This request already identifies another finding.");
    return { saved: true, id };
  }
  if (onIssue) {
    if (!await acceptsIssueFinding(tx, check, target)) return fail("The issue no longer applies to this inspection.");
  } else {
    const [match] = await tx.select({ archive: evidence.archive }).from(decisions)
      .innerJoin(evidence, eq(decisions.evidenceId, evidence.id))
      .where(and(
        eq(decisions.id, target), eq(evidence.checkId, checkId),
        eq(evidence.serial, check.unit.serial), eq(evidence.revisionId, check.unit.revisionId),
      ));

    if (!sameArchiveEdition(check, match?.archive))
      return fail("Choose this issue or a QA decision recorded against these archived runs.");
  }

  await tx.insert(inspectionFindings).values({ ...values, archive });

  return { saved: true, id };
}
