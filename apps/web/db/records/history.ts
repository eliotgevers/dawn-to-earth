import { authoredFields } from "@/components/records/schema";
import type { VerificationRecords } from "@/components/verification/model";
import { assemblyStatusTone, latestRecordEdit, recordActivity, recordDecision, recordKinds, type RecordEntry, type RecordUnit, type UnitEdition } from "@/lib/records/journal";
import { and, asc, desc, inArray, sql, type SQL } from "drizzle-orm";
import type { Reader } from "../connection";
import { verificationReviews, workspaceBaseline, workspaceRecords, type AssemblyRecord as StoredAssemblyRecord } from "../schema";

// Authored actions cite their parent and exact unit inside the stored record.
export const actionParent = sql<string>`${workspaceRecords.data}#>>'{action,parentId}'`;
export const actionType = sql<string>`${workspaceRecords.data}#>>'{action,type}'`;
export const actionUnit = sql`${workspaceRecords.data}#>'{action,unit}'`;

// Stored unit objects can retain an old revision label. Match only their stable identity.
export function editionJson({ serial, revisionId }: UnitEdition) {
  return JSON.stringify({ serial, revisionId });
}

// Workspace forms cap the raw input before storing trimmed text.
export function formText(value: unknown, max = 1000) {
  return typeof value === "string" && value.length <= max ? value.trim() : "";
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
}

export async function readVerificationBaseline(db: Reader) {
  const [row] = await db.select({ verification: workspaceBaseline.verification }).from(workspaceBaseline).limit(1);
  if (!row) throw new Error("Workspace has not been initialized");

  return row.verification;
}

export async function readRecordHistory(db: Reader, filter?: SQL) {
  const rows = await db.select({ data: workspaceRecords.data }).from(workspaceRecords)
    .where(filter).orderBy(desc(workspaceRecords.recordedAt), desc(workspaceRecords.id));

  return rows.map(row => row.data);
}

// A flag creates an issue with its own identity and remains an event on the original build.
export async function readCurrentRecords(db: Reader, filter?: SQL) {
  const entries = await readRecordHistory(db, filter);
  const history = entries.filter(row => row.action);
  const roots = entries.filter(row => !row.action || row.action.type === "flag");
  const article = roots.some(row => !row.unit && !row.action?.unit) ? await readArticle(db) : undefined;
  const records = roots.map(root => {
    const unit = root.unit ?? root.action?.unit ?? article;
    const edits = recordActivity(history, root.id, unit).filter(entry => entry.action?.type === "edit");
    const [latest] = edits;
    if (!latest) return root.unit === unit ? root : { ...root, unit };

    // Older editors could save text without sending structured fields. Take the newest supplied value
    // for each independently editable part. A structured edit can explicitly clear Current state.
    const structured = edits.find(edit => edit.primary != null);
    const stateEdit = edits.find(edit => edit.primary || edit.currentState !== undefined);

    return {
      ...root, unit, title: latest.title, description: latest.description,
      context: root.kind === "configuration" ? edits.find(edit => !edit.primary)?.context ?? root.context : latest.context,
      primary: structured?.primary ?? root.primary,
      currentState: stateEdit ? stateEdit.currentState : root.currentState,
      impacts: edits.find(edit => edit.impacts != null)?.impacts ?? root.impacts,
      evidenceType: edits.find(edit => edit.evidenceType != null)?.evidenceType ?? root.evidenceType,
    } satisfies RecordEntry;
  });

  return { records, history };
}

export async function readReviews(db: Reader, filter?: SQL) {
  const rows = await db.select({data: verificationReviews.data}).from(verificationReviews)
    .where(filter).orderBy(asc(verificationReviews.recordedAt), asc(verificationReviews.id));

  return rows.map(row => row.data);
}

// A removal on another serial or revision leaves the original subject available.
export function recordRemovals(db: Reader, ids: string[], serial: string, revisionId: string) {
  return db.select({ id: actionParent }).from(workspaceRecords).where(and(
    inArray(actionParent, ids),
    sql`${workspaceRecords.data}->'action' @> ${JSON.stringify({type: "remove", unit: {serial, revisionId}})}::jsonb`,
  ));
}

export async function readArticle(db: Reader) {
  const [row] = await db.select({article: sql<VerificationRecords["article"]>`${workspaceBaseline.verification}->'article'`})
    .from(workspaceBaseline).limit(1);
  if (!row) throw new Error("Workspace has not been initialized");

  return row.article;
}

export function amendedProductionRecord<T extends Pick<StoredAssemblyRecord, "id" | "title" | "fields" | "kind" | "status" | "tone">>(
  record: T, local: readonly RecordEntry[], owner?: RecordUnit,
): T {
  if (!owner || recordKinds[record.kind].section !== "production") return record;
  if (record.kind === "issue") {
    const status = recordDecision(local, record.id, owner)?.status;
    if (status) record = { ...record, status, tone: assemblyStatusTone(status) };
  }
  if ("origin" in record && record.origin === "local") return record;
  const edit = latestRecordEdit(local, record.id, owner);
  if (!edit) return record;

  return { ...record, title: edit.title, fields: authoredFields(edit, record) };
}
