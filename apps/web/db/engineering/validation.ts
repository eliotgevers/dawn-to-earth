import { entryText } from "@/db/workflows/cases";
import { readActors } from "../records/work";
import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { validationDecisions, judgmentIssue, assessReadings, type ValidationDecision } from "@/lib/evidence/validation";
import { readOriginalEvidence } from "../verification/evidence";
import { sameUnit } from "@/lib/records/journal";
import { fail, type WorkspaceDatabase, type Reader, writeTransaction } from "../connection";
import { isRequestId, recordRemovals } from "../records/history";
import { readUnitEdition } from "../catalog";
import { validationStudies, validationJudgments, users } from "../schema";

async function studyRows(db: Reader, condition: SQL | undefined) {
  const rows = await db.select({
    ...getTableColumns(validationStudies),
    supersededBy: sql<string | null>`(select later.id from validation_studies later
      where later.supersedes_id = validation_studies.id
      and (later.record_id, later.serial, later.revision_id) =
          (validation_studies.record_id, validation_studies.serial, validation_studies.revision_id))`,
    sourceDigest: sql<string>`encode(sha256(convert_to(to_jsonb(${validationStudies})::text, 'UTF8')), 'hex')`,
  }).from(validationStudies).where(condition).orderBy(validationStudies.modelEditionId, validationStudies.id);

  return rows.map(({ archive, supersedesId: _, supersededBy, ...identity }) => ({ ...identity, ...archive, ...(supersededBy && { supersededBy }) }));
}

type ModelTarget = { recordId?: string | null; evidenceId?: string | null; serial?: string | null; revisionId?: string | null };

export function validModelTarget({ recordId, evidenceId, serial, revisionId }: ModelTarget) {
  return Boolean(recordId) !== Boolean(evidenceId) && Boolean(serial) === Boolean(revisionId) && (!evidenceId || !!serial);
}

export async function readValidation(db: Reader, target: ModelTarget) {
  if (!validModelTarget(target)) return [];
  const studies = await studyRows(db, and(
    target.recordId ? eq(validationStudies.recordId, target.recordId) : undefined,
    target.evidenceId ? sql`${validationStudies.archive}->'evidenceIds' @> ${JSON.stringify([target.evidenceId])}::jsonb` : undefined,
    target.serial ? eq(validationStudies.serial, target.serial) : undefined,
    target.revisionId ? eq(validationStudies.revisionId, target.revisionId) : undefined,
  ));
  if (!studies.length) return [];
  const judgments = await db.select({ ...getTableColumns(validationJudgments), actorName: users.name }).from(validationJudgments)
    .innerJoin(users, eq(users.id, validationJudgments.actor))
    .where(inArray(validationJudgments.studyId, studies.map(study => study.id)))
    .orderBy(desc(validationJudgments.createdAt), desc(validationJudgments.id));
  const byStudy = Map.groupBy(judgments, judgment => judgment.studyId);

  return studies.map(study => ({ ...study, judgments: byStudy.get(study.id) ?? [] }));
}

export async function saveValidationJudgment(db: WorkspaceDatabase, input: Record<string, unknown>) {
  const { requestId, studyId, recordId, serial, revisionId, modelEditionId, sourceDigest, conditionId, rowIds, actor } = input;
  const observation = entryText(input.observation, 1000);
  const decision = input.decision as ValidationDecision;
  if (!isRequestId(requestId) ||
    typeof studyId !== "string" || typeof conditionId !== "string" || typeof actor !== "string" ||
    !observation ||
    typeof decision !== "string" || !Object.hasOwn(validationDecisions, decision) ||
    !Array.isArray(rowIds) || rowIds.length > 500 || !rowIds.every(id => typeof id === "string"))
    return { error: "Choose a model condition, observations, decision and recorder.", status: 400 };

  return writeTransaction(db, async tx => {
    const [study] = await studyRows(tx, eq(validationStudies.id, studyId));
    if (!study || study.serial !== serial || study.revisionId !== revisionId || study.recordId !== recordId ||
      study.modelEditionId !== modelEditionId || study.sourceDigest !== sourceDigest)
      return fail("The model edition, unit revision or archived sources have changed. Reopen the study.");

    const judgment = { id: requestId, studyId, actor, decision, observation };
    const [prior] = await tx.select().from(validationJudgments).where(eq(validationJudgments.id, requestId));
    const requested = new Set(rowIds);
    const selected = study.rows.filter(row => requested.has(row.id));
    if (prior) {
      const { basis: saved, createdAt: _at, ...receipt } = prior;

      return isDeepStrictEqual(judgment, receipt) && saved.sourceDigest === sourceDigest &&
        saved.condition.id === conditionId && selected.length === rowIds.length && isDeepStrictEqual(saved.selected, selected)
        ? { id: requestId, status: 200 } : fail("This request already identifies a different judgment.");
    }

    if (study.supersededBy) return fail("A later edition supersedes this model study. Open the current edition.");
    const condition = study.conditions.find(c => c.id === conditionId);
    if (!condition) return fail("Choose a condition from this model edition.");
    const { independent } = assessReadings(study.rows);
    const issue = judgmentIssue(condition, independent, rowIds, decision);
    if (issue) return fail(issue);
    const basis = { sourceDigest: study.sourceDigest, condition, selected };
    const [scope, [recorder], sources, removed] = await Promise.all([
      readUnitEdition(tx, serial, revisionId),
      readActors(tx, actor),
      readOriginalEvidence(tx, study.evidenceIds),
      recordRemovals(tx, [recordId, ...study.evidenceIds], serial, revisionId),
    ]);
    if (!recorder) return { error: "Choose a recorded person.", status: 400 };
    if (!scope?.current || scope.archived || !scope.recordIds.includes(recordId) || removed.length ||
      !study.evidenceIds.every(id => {
        const source = sources.get(id);

        return source?.content === "validation-study" && sameUnit(source.unit ?? undefined, scope.unit);
      })) return fail("The study's design record, acquisition register or current unit revision no longer applies.");

    await tx.insert(validationJudgments).values({ ...judgment, basis: {...basis, edition: {serial, revisionId, recordId, modelEditionId, unit: study.unit, quantity: study.quantity, title: study.title, source: study.source}} });

    return { id: requestId };
  });
}
