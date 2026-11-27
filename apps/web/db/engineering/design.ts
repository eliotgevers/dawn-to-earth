import { readActors } from "../records/work";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { formText, isRequestId, recordRemovals } from "../records/history";
import { fail, writeTransaction, type WorkspaceDatabase, type Reader } from "../connection";
import { assemblyRecords, designEditions, designFindings, users, catalogEntries, designFiles, revisionFiles } from "../schema";
import { readUnitEdition } from "../catalog";
import { createHash } from "node:crypto";
import { readMesh } from "@/lib/evidence/mesh";

export type DesignEdition = typeof designEditions.$inferSelect;
export type DesignFinding = DesignReviewData["findings"][number];
export type DesignReviewData = Awaited<ReturnType<typeof readDesignReview>>;

type ReadScope = { recordId?: string; targetId?: string; serial?: string; revisionId?: string };

function unitScope(table: typeof designEditions | typeof designFindings, { serial, revisionId }: ReadScope) {
  return serial && revisionId ? and(eq(table.serial, serial), eq(table.revisionId, revisionId)) : undefined;
}

export async function readDesignReview(db: Reader, scope: ReadScope) {
  const { recordId, targetId, serial, revisionId } = scope;
  if (Boolean(serial) !== Boolean(revisionId) || Boolean(recordId) === Boolean(targetId)) return { editions: [], findings: [] };
  const [editions, findings] = await Promise.all([
    recordId ? db.select().from(designEditions).where(and(eq(designEditions.recordId, recordId),
      unitScope(designEditions, scope)))
      .orderBy(asc(designEditions.serial), asc(designEditions.revisionId), asc(designEditions.position)) : [],
    db.select({ ...getTableColumns(designFindings), actorName: users.name }).from(designFindings)
      .innerJoin(users, eq(users.id, designFindings.actor)).where(and(recordId ? eq(designFindings.recordId, recordId) : eq(designFindings.targetId, targetId!),
      unitScope(designFindings, scope)))
      .orderBy(desc(designFindings.createdAt), desc(designFindings.id)),
  ]);

  return { editions, findings };
}

export async function saveDesignFinding(db: WorkspaceDatabase, input: Record<string, unknown>) {
  const { recordId, serial, revisionId, priorId, currentId, fieldKey, targetId, actor, requestId } = input;
  const observation = formText(input.observation);
  if (typeof recordId !== "string" || typeof serial !== "string" || typeof revisionId !== "string" ||
    typeof priorId !== "string" || typeof currentId !== "string" || typeof fieldKey !== "string" ||
    typeof targetId !== "string" || typeof actor !== "string" || !observation || !isRequestId(requestId)) {
    return { error: "Choose two editions, a field, a destination and a recorder, then enter an observation.", status: 400 };
  }

  return writeTransaction(db, async tx => {
    const submission = { id: requestId, recordId, serial, revisionId, priorId, currentId, fieldKey, targetId, actor, observation };
    const [previous] = await tx.select().from(designFindings).where(eq(designFindings.id, requestId));
    if (previous) {
      const { basis: _basis, createdAt: _at, ...receipt } = previous;

      return isDeepStrictEqual(receipt, submission) ? { id: requestId, status: 200 } : fail("This request already identifies another finding.");
    }
    const [editions, scope, [destination], [person], removed] = await Promise.all([
      tx.select({ id: designEditions.id, fields: designEditions.fields, targets: designEditions.targets }).from(designEditions).where(and(eq(designEditions.recordId,recordId), unitScope(designEditions, submission))).orderBy(desc(designEditions.position)).limit(2),
      readUnitEdition(tx, serial, revisionId),
      tx.select({ data:assemblyRecords.data, section:assemblyRecords.section }).from(assemblyRecords).where(eq(assemblyRecords.id,targetId)),
      readActors(tx, actor),
      recordRemovals(tx, [recordId, targetId], serial, revisionId),
    ]);
    const [current, prior] = editions;
    if (current?.id !== currentId || prior?.id !== priorId)
      return fail("The current document pair changed. Reopen the comparison.");
    const after = current.fields.find((f) => f.key === fieldKey);
    const before = prior.fields.find((f) => f.key === fieldKey);
    if (!after && !before) return fail("The selected field does not appear in either edition.");
    const target = current.targets.find((t) => t.id === targetId);
    if (!scope?.current || scope.archived || !scope.recordIds.includes(recordId) || removed.some(row => row.id === recordId))
      return fail("The design no longer applies to this unit and revision.");
    const related = destination?.data;
    const applies = related?.kind === "change" ? scope.recordIds.includes(targetId) :
      related?.kind === "issue" && related.unit?.serial === serial && related.unit.revisionId === revisionId;
    if (!target || destination?.section !== target.section || !applies || removed.some(row => row.id === targetId))
      return fail("The destination no longer applies to this design review.");
    if (!person) return {error:"Choose a known recorder.",status:400};
    await tx.insert(designFindings).values({ ...submission,
      basis: { label:(after ?? before)!.label, before:before?.value ?? null,
        after:after?.value ?? null, target } });

    return { id:requestId };
  });
}

export type FileInfo = Pick<typeof designFiles.$inferSelect, "id" | "kind" | "name">;

const labels = { id: designFiles.id, kind: designFiles.kind, name: designFiles.name };
const maxBytes = 512 * 1024;
class FileInputError extends Error {}

export async function fileLibrary(database: Reader, revisionId: string) {
  const rows = await database.select({ file: labels, attachment: revisionFiles.fileId })
    .from(catalogEntries)
    .leftJoin(designFiles, sql`true`)
    .leftJoin(revisionFiles, and(eq(revisionFiles.revisionId, catalogEntries.id), eq(revisionFiles.fileId, designFiles.id)))
    .where(and(eq(catalogEntries.kind, "revisions"), eq(catalogEntries.id, revisionId)))
    .orderBy(asc(designFiles.kind), asc(designFiles.name), asc(designFiles.id));
  if (!rows.length) return { error: "This catalog revision does not exist." };
  const attached: FileInfo[] = [], available: FileInfo[] = [];
  for (const { file, attachment } of rows) {
    if (file) (attachment ? attached : available).push(file);
  }

  return { attached, available };
}

export async function prepareFile(name: string, bytes: Buffer) {
  if (!name.trim() || name.length > 140 || /[\/\\\x00-\x1f]/.test(name)) throw new FileInputError("Use a file name of 1–140 characters without a path.");
  if (!bytes.length || bytes.length > maxBytes) throw new FileInputError("Choose a PNG or OBJ up to 512 KB.");
  let kind: FileInfo["kind"];
  if (/\.png$/i.test(name)) {
    kind = "drawing";
    if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new FileInputError("This file is not a PNG drawing.");
    try {
      const {default: sharp} = await import("sharp");
      const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
      const info = await image.metadata();
      if (info.format !== "png" || !info.height || !info.width || info.height > 4096 || info.width > 4096 || (info.pages ?? 1) > 1) throw new FileInputError();
      // Decode and re-encode without embedded metadata, animation or other file content.
      bytes = await image.png().toBuffer();
    } catch { throw new FileInputError("Use a readable, single-frame PNG no larger than 4096 × 4096."); }
    if (bytes.length > 2 * 1024 * 1024) throw new FileInputError("The decoded drawing is too large. Reduce its dimensions.");
  } else if (/\.obj$/i.test(name)) {
    kind = "model";
    const obj = bytes.toString("utf8");
    if (/[^\t\r\n -~]/.test(obj)) throw new FileInputError("Use a plain-text OBJ mesh.");
    try { readMesh(obj); } catch (error) { throw new FileInputError(error instanceof Error ? error.message : "Invalid OBJ mesh."); }
  } else throw new FileInputError("Choose a PNG drawing or a plain OBJ model.");

  return { id: createHash("sha256").update(bytes).digest("hex"), name, kind, content: bytes.toString("base64") };
}

export async function saveRevisionFile(db: WorkspaceDatabase, form: FormData): Promise<{ id: string } | { error: string }> {
  const revisionId = String(form.get("revisionId") || "");
  const upload = form.get("file");
  const existing = form.get("existing");

  if (!revisionId || revisionId.length > 240) return { error: "Choose the exact catalog revision." };
  if (typeof existing === "string" && existing && upload instanceof File && upload.size)
    return { error: "Choose one existing file or one upload." };

  try {
    let attachment: string | Awaited<ReturnType<typeof prepareFile>>;
    if (typeof existing === "string" && /^[a-f0-9]{64}$/.test(existing)) {
      attachment = existing;
    } else {
      if (!(upload instanceof File) || !upload.size || upload.size > maxBytes)
        return { error: "Choose a PNG or OBJ up to 512 KB." };

      attachment = await prepareFile(upload.name, Buffer.from(await upload.arrayBuffer()));
    }

    return await writeTransaction(db, async tx => {
      const fileId = typeof attachment === "string" ? attachment : attachment.id;
      if (typeof attachment === "string") {
        const [known] = await tx.select({ id: designFiles.id }).from(designFiles).where(eq(designFiles.id, fileId));
        if (!known) return { error: "This file is no longer in the library." };
      }

      const [revision] = await tx.select({ id: catalogEntries.id }).from(catalogEntries)
        .where(and(eq(catalogEntries.kind, "revisions"), eq(catalogEntries.id, revisionId)));
      if (!revision) return { error: "This catalog revision does not exist." };

      if (typeof attachment !== "string") await tx.insert(designFiles).values(attachment).onConflictDoNothing();
      await tx.insert(revisionFiles).values({ revisionId, fileId }).onConflictDoNothing();

      return { id: fileId };
    });
  } catch (error) {
    if (error instanceof FileInputError) return { error: error.message };

    throw error;
  }
}
