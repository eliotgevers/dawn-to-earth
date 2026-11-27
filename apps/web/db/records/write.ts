import { unresolvedIssueMessage } from "@/components/production/builds";
import { resolveExchange } from "@/components/verification/document-exchanges";
import { unitSelection } from "@/components/workspace/selection";
import { changeImpact } from "@/lib/readiness";
import { isObject } from "@/db/workflows/cases";
import {
  authoredHeading, editableActions, isRecordEntry, isRecordUnit, isRemovedRecord, recordActivity,
  recordDecision, recordKinds, sameUnit, visibleRecordNotes, type ChangeImpact, type RecordEntry, type UnitEdition,
} from "@/lib/records/journal";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import { loadCatalog, readUnitEdition } from "../catalog";
import { fail, writeTransaction, type Reader, type RecordWriter, type WorkspaceDatabase } from "../connection";
import { acceptanceChecks, assemblyRecords, revisionReviews, workspaceBaseline, workspaceRecords } from "../schema";
import { checkEvidenceAction, readOriginalEvidence } from "../verification/evidence";
import { readBuildState } from "./assembly";
import {
  actionParent, actionType, actionUnit, editionJson, formText, isRequestId, readArticle, readCurrentRecords, recordRemovals,
} from "./history";
import { readActors, reviewers } from "./work";

async function appendRecord(db: Pick<RecordWriter, "insert">, data: RecordEntry) {
  await db.insert(workspaceRecords).values({
    id: data.id, kind: data.kind, recordedAt: new Date(data.recordedAt), data,
  });

  return { record: authoredHeading(data) };
}

export async function saveRecord(db: RecordWriter, input: unknown) {
  if (!isObject(input) || "eventFinding" in input || "benchRun" in input) return fail("Enter valid record fields.", 400);
  const data = { ...input, id: crypto.randomUUID(), recordedAt: new Date().toISOString() };
  if (!isRecordEntry(data)) return fail("Enter valid record fields.", 400);

  const unit = data.action?.unit ?? data.unit;
  if (!unit || (data.unit && !sameUnit(unit, data.unit))) return fail("Choose an existing serial and revision.");
  const target = await readUnitEdition(db, unit.serial, unit.revisionId);
  if (!target?.registered) return fail("Choose an existing serial and revision.");
  if (data.unit) data.unit = target.unit;
  if (data.action) data.action = {...data.action, unit: target.unit};

  let addedLinks = data.impacts ?? [];
  if (data.action) {
    const { parentId, type } = data.action;
    const { records, history } = await readCurrentRecords(db, or(eq(workspaceRecords.id, parentId),
      eq(actionParent, parentId)));
    const parent = records.find(({ id }) => id === parentId);
    if (type === "edit-note" || type === "remove-note") {
      const note = visibleRecordNotes(recordActivity(history, parentId, unit)).find(row => row.id === data.noteId);
      if (!note) return fail("The note is no longer available on this record.");
      if (note.eventFinding) return fail("A recorded finding retains its original observation. Add a follow-up note.");
    }
    if (!parent && history.some(entry => entry.id === parentId)) return fail("Choose the record that owns this history entry.");
    if (isRemovedRecord(parentId, history, unit)) return fail("The linked record has changed.");
    if (data.kind === "evidence") {
      const rejection = await checkEvidenceAction(db, data.action, data.test, parent, history);
      if (rejection) return rejection;
    } else {
      const [issued] = parent ? [] : await db.select().from(assemblyRecords).where(eq(assemblyRecords.id, parentId));
      const record = parent ?? issued?.data;
      if (!record || record.kind !== (type === "flag" ? "queue" : data.kind)) return fail("The linked record has changed.");
      if (type === "edit" && issued?.section === "engineering")
        return fail("This design record is read-only. Use its revision or decision action.");

      const owner = record.unit;
      if (issued?.section === "engineering" && !owner) {
        if (!target.recordIds.includes(parentId)) return fail("The linked record has changed.");
      } else if (!sameUnit(unit, owner ?? await readArticle(db))) return fail("The linked record has changed.");

      if (parent && addedLinks.length) {
        const previous = parent.impacts ?? [];
        addedLinks = addedLinks.filter(link => !previous.some(old => old.id === link.id && old.section === link.section));
      }
      const deciding = type === "decide" || type === "dispose";
      const removingIssue = type === "remove" && data.kind === "issue";
      const status = deciding || removingIssue
        ? recordDecision(history, parentId, unit)?.status ?? issued?.data.status ?? recordKinds[record.kind].status
        : undefined;
      if (deciding && status && !editableActions(type === "decide" ? "change" : "issue", status).includes(type))
        return fail("This record already has a decision. Reopen it to see the current status.");

      if (removingIssue && status !== "Resolved") {
        if (parent?.action?.type === "flag") return fail(unresolvedIssueMessage);
        const subject = editionJson(unit);
        const [linked] = await db.select({id: acceptanceChecks.id}).from(acceptanceChecks)
          .where(sql`${acceptanceChecks.data}->>'issueId' = ${parentId} and ${acceptanceChecks.data}->'unit' @> ${subject}::jsonb`)
          .unionAll(db.select({id: assemblyRecords.id}).from(assemblyRecords).where(sql`${assemblyRecords.data}->>'kind' = 'queue' and
            (not ${assemblyRecords.data} ? 'unit' or ${assemblyRecords.data}->'unit' @> ${subject}::jsonb) and
            ${assemblyRecords.data}->'overviewLinks' @> ${JSON.stringify([{section:"production",id:parentId}])}::jsonb`))
          .limit(1);
        if (linked) return fail(unresolvedIssueMessage);
      }
      if (type === "start" || type === "complete" || type === "flag") {
        // Acceptance and issue changes share this transaction lock.
        if (!target.current) return fail("This build is on a historical revision.");
        const build = issued?.data ?? { id: parentId, status: recordKinds.queue.status };
        const work = await readBuildState(db, build, unit, history);
        if (work.travelerHold) return fail("Resolve the paused traveler before progressing this build.");
        if (type === "complete" && work.closeoutLink) return fail(work.closeoutLink.label);
        if (!editableActions("queue", work.status).includes(type))
          return fail("The build has changed. Reopen it to see the available action and any blocker.");
      }
    }
  }

  if (addedLinks.length && !await linksApply(db, addedLinks, unit, target.recordIds))
    return fail("Choose affected records that are available for this serial and revision.");
  data.id = `local-${data.kind}-${data.id}`;

  return appendRecord(db, data);
}

// Called inside the same transaction/lock as record removal and QA decisions.
export async function saveEventFinding(
  tx: RecordWriter, input: Record<string, unknown>,
) {
  const { requestId, sourceId, unit, basis, actor } = input;
  const observation = formText(input.observation);
  if (!isRequestId(requestId) ||
    typeof sourceId !== "string" || !isRecordUnit(unit) || typeof actor !== "string" ||
    !basis || typeof basis !== "object" || !("correlation" in basis) || typeof basis.correlation !== "string" ||
    !observation)
    return fail("Choose an exchange and recorder, then enter an observation.", 400);

  const id = `local-evidence-${requestId}`;
  const [receipt] = await tx.select({ data: workspaceRecords.data }).from(workspaceRecords).where(eq(workspaceRecords.id, id));
  const matchesSource = (finding: RecordEntry["eventFinding"]) =>
    finding?.actor === actor && isDeepStrictEqual(finding.basis, basis) && isDeepStrictEqual(finding.archive, input.expectedArchive);
  const prior = receipt?.data;
  if (prior) {
    if (prior.action?.parentId === sourceId && sameUnit(prior.action.unit, unit) &&
      prior.description === observation && matchesSource(prior.eventFinding))
      return { record: authoredHeading(prior), status: 200 };

    return fail("This request already identifies another finding.");
  }

  const [sources, [recorder], removed] = await Promise.all([
    readOriginalEvidence(tx, [sourceId]), readActors(tx, actor), recordRemovals(tx, [sourceId], unit.serial, unit.revisionId),
  ]);
  if (!recorder) return fail("Choose a recorded person.", 400);
  const record = sources.get(sourceId);
  if (record?.test !== "communication" || !record.unit ||
    !sameUnit(record.unit, unit) || removed.length)
    return fail("This source is unavailable for the selected unit and revision.");

  const archive = record.exchangeArchive;
  const exchange = archive && resolveExchange(archive, basis.correlation);
  const finding = archive && exchange && { actor: recorder.id, archive, basis: exchange.basis };
  if (!finding || !matchesSource(finding))
    return fail("The recorded exchange changed. Reopen the source and choose an exchange.");

  return appendRecord(tx, {
    id, kind: "evidence", test: "communication", title: `Exchange finding · ${finding.basis.correlation}`,
    description: observation, context: recorder.name, recordedAt: new Date().toISOString(),
    action: { type: "note", parentId: record.id, unit: record.unit },
    eventFinding: finding,
  });
}

const unavailableTarget = { error: "A selected unit changed or already has an open review.", status: 409 };

export async function assignImpact(db: WorkspaceDatabase, input: Record<string, unknown>) {
  const { changeId, fromId, toId, owner, targets } = input;
  const reason = formText(input.reason);
  if (typeof changeId !== "string" || typeof fromId !== "string" || typeof toId !== "string" ||
      typeof owner !== "string" || !reason || !Array.isArray(targets) || !targets.length || targets.length > 200) {
    return { error: "Choose units, a reviewer and a reason.", status: 400 };
  }
  try {
    return await writeTransaction(db, async tx => {
      // Imported changes without an explicit unit belong to the recorded workspace article.
      const changeOwners = tx.select({
        unit: sql<UnitEdition>`coalesce(nullif(${workspaceRecords.data}->'unit', 'null'::jsonb),
          (select ${workspaceBaseline.verification}->'article' from ${workspaceBaseline} limit 1))`,
      }).from(workspaceRecords).where(and(
        eq(workspaceRecords.id, changeId), eq(workspaceRecords.kind, "change"), isNull(actionType),
      )).unionAll(tx.select({ unit: sql<UnitEdition>`${acceptanceChecks.data}->'unit'` })
        .from(acceptanceChecks).where(sql`${acceptanceChecks.data}->>'changeId' = ${changeId}`));
      const [catalog, owners, people] = await Promise.all([
        loadCatalog(tx, ["revisions", "units", "archivedRows"]), changeOwners, readActors(tx, owner),
      ]);
      if (!reviewers(people).length) return { error: "Unknown reviewer.", status: 409 };

      const selected = new Set(targets);
      const units = changeImpact(catalog, changeId, owners.map(row => row.unit)).unitsFor(fromId, toId)
        .filter(unit => selected.has(unitSelection(unit.serial, unit.revisionId)));
      if (units.length !== targets.length) return unavailableTarget;
      await tx.insert(revisionReviews).values(units.map(({ serial, revisionId }) => ({
        id: crypto.randomUUID(), changeId, fromId, toId, serial, revisionId, owner, reason,
      })));

      return { saved: true };
    });
  } catch (error) {
    // The pending-assignment index protects the entire selection in one insert.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof postgres.PostgresError && cause.constraint_name === "revision_reviews_pending") return unavailableTarget;
    throw error;
  }
}

export async function completeImpact(db: Pick<WorkspaceDatabase, "update">, input: Record<string, unknown>) {
  const conclusion = formText(input.conclusion);
  if (typeof input.id !== "string" || !conclusion) return { error: "Enter a review conclusion.", status: 400 };
  const [completed] = await db.update(revisionReviews)
    .set({ completedAt: new Date().toISOString(), conclusion })
    .where(and(eq(revisionReviews.id, input.id), isNull(revisionReviews.completedAt)))
    .returning({ id: revisionReviews.id });

  return completed ? { saved: true } : { error: "The assignment is no longer open.", status: 409 };
}

// Check newly added destinations while the record write lock is held.
async function linksApply(db: Reader, links: readonly ChangeImpact[], unit: UnitEdition, recordIds: readonly string[]) {
  const ids = links.map(link => link.id);
  const article = sql`(select ${workspaceBaseline.verification}->'article' from ${workspaceBaseline} limit 1)`;
  const [issued, authored, removed] = await Promise.all([
    db.select({
      id: assemblyRecords.id, section: assemblyRecords.section,
      unit: sql<UnitEdition>`coalesce(nullif(${assemblyRecords.data}->'unit', 'null'::jsonb), ${article})`,
    }).from(assemblyRecords).where(inArray(assemblyRecords.id, ids)),
    db.select({
      id: workspaceRecords.id, kind: workspaceRecords.kind,
      unit: sql<UnitEdition>`coalesce(nullif(${workspaceRecords.data}->'unit', 'null'::jsonb), ${actionUnit}, ${article})`,
    }).from(workspaceRecords).where(and(inArray(workspaceRecords.id, ids), ne(workspaceRecords.kind, "evidence"),
      or(isNull(actionType), eq(actionType, "flag")))),
    recordRemovals(db, ids, unit.serial, unit.revisionId),
  ]);
  const shared = new Set(recordIds);
  const applicable = new Map<string, string>();
  for (const row of issued) {
    if (row.section === "engineering" ? shared.has(row.id) : sameUnit(row.unit, unit))
      applicable.set(row.id, row.section);
  }
  for (const row of authored) {
    if (sameUnit(row.unit, unit)) applicable.set(row.id, recordKinds[row.kind].section);
  }
  for (const row of removed) applicable.delete(row.id);

  return links.every(link => applicable.get(link.id) === link.section);
}
