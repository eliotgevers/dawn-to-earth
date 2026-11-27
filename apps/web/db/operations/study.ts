import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import type { Catalog } from "@/components/catalog/store";
import { parseSelection, type ItemSelection } from "@/components/workspace/selection";
import { studyScope, filedSource, studyOutcomes } from "@/lib/archives/study";
import { sourceFingerprint, type StudyDraft, type StudyId, type StudyScope } from "@/lib/archives/study";
import { loadCatalog } from "../catalog";
import { operationsStudyFindings as findings } from "../schema";
import type { Reader, RecordWriter } from "../connection";
import { isRequestId } from "../records/history";

const frozenScope = sql<StudyScope | null>`${findings.source}->'scope'`;

// History uses its filed assignment, even when the live Catalog has moved the unit or archived its source.
function historyFilter(catalog: Catalog, selections: readonly ItemSelection[]) {
  return or(...selections.map((selection): SQL => {
    const [kind, id] = selection.split(":");
    if (kind === "project") return sql`${frozenScope}->>'projectId' = ${id}`;
    if (kind === "system") return sql`${frozenScope}->>'systemId' = ${id}`;
    if (kind === "revision") return sql`${frozenScope}->>'revisionId' = ${id}`;
    const [serial, revisionId] = id.split("@");
    const edition = revisionId || catalog.units.find(row => row.serial === serial)?.revisionId;

    return edition ? sql`${frozenScope}->>'serial' = ${serial} and ${frozenScope}->>'revisionId' = ${edition}` : sql`false`;
  }));
}

export async function readOperationsStudy(db: Reader, study: StudyId, finding?: string, selections: ItemSelection[] = []) {
  const catalog = await loadCatalog(db);
  const scope = studyScope(catalog, selections, study);
  const filter = historyFilter(catalog, selections);

  const [entries, matchingFindings] = await Promise.all([
    filter
      ? db.select({
          id: findings.id,
          label: sql<string>`${findings.source}->>'label'`,
          edition: findings.edition,
          subject: findings.subject,
          first: findings.first,
          last: findings.last,
          scope: frozenScope,
          recordedAt: findings.recordedAt,
          outcome: findings.outcome,
          note: findings.note,
        })
        .from(findings)
        .where(and(eq(findings.study, study), filter))
        .orderBy(desc(findings.recordedAt), desc(findings.id))
      : [],
    isRequestId(finding)
      ? db.select()
        .from(findings)
        .where(and(eq(findings.study, study), eq(findings.id, finding), filter))
      : [],
  ]);

  const selected = matchingFindings.at(0) ?? null;

  return {
    catalog,
    selections,
    ...scope,
    entries,
    selected,
    unavailable: Boolean(finding && !selected),
  };
}

export async function saveOperationsStudy(db: RecordWriter, study: StudyId, request: {
  id: string; edition: string; stamp: string; draft: StudyDraft; target: StudyScope;
}, selections: readonly ItemSelection[]) {
  if (!isRequestId(request?.id) || typeof request.stamp !== "string" || !request.draft) {
    return { error: "Invalid finding request." };
  }

  const target = request.target;
  if (!target || typeof target.selection !== "string" || !parseSelection(target.selection) || !selections.includes(target.selection)) {
    return { error: "Choose the selected Catalog item for this finding." };
  }

  const { subject, first, last, outcome, note } = request.draft;
  if (typeof subject !== "string" || typeof outcome !== "string" || typeof note !== "string"
      || !note.trim() || note.trim().length > 2000 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    return { error: "Choose a source and enter a finding of up to 2,000 characters." };
  }

  const draft = { subject, first, last, outcome, note: note.trim() };
  const { selection, serial, projectId, systemId, revisionId } = target;
  const requestedScope: StudyScope = { selection, serial, projectId, systemId, revisionId };

  // Compare a retry with the immutable receipt, even after the unit moves or its source changes.
  const [saved] = await db.select().from(findings).where(eq(findings.id, request.id));

  if (saved) {
    const { recordedAt: _, source, ...fields } = saved;
    const { scope, ...archive } = source;
    const sameFinding = isDeepStrictEqual(fields, { id: request.id, study, edition: request.edition, ...draft });

    if (sameFinding && isDeepStrictEqual(scope, requestedScope) && await sourceFingerprint(archive) === request.stamp) {
      return { id: request.id };
    }

    return { error: "This request already recorded a different finding." };
  }

  const filed = filedSource(study, subject);
  if (!filed || filed.edition !== request.edition) return { error: "The source edition has changed. Reopen the current archive." };

  const { source, edition } = filed;
  if (await sourceFingerprint(source) !== request.stamp) {
    return { error: "The reviewed inputs differ from the current archive. Reopen the source before saving." };
  }
  if (!studyOutcomes(source, first, last).includes(outcome)) return { error: "This source, selection and outcome do not form a valid finding." };

  const { targets } = studyScope(await loadCatalog(db), [selection], study);
  const match = targets.find(row => row.subjects.includes(subject) && isDeepStrictEqual(row.scope, requestedScope));

  if (!match) return { error: "The source does not match this Catalog assignment. Reopen the study before saving." };

  await db.insert(findings).values({ id: request.id, study, edition, source: { ...source, scope: match.scope }, ...draft });

  return { id: request.id };
}
