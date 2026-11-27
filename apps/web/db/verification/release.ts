import { entryText } from "@/db/workflows/cases";
import { type UnitEdition } from "@/lib/records/journal";
import { packetBasis, unitReadiness } from "@/lib/readiness";
import { and, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { readUnitWork } from "../records/assembly";
import { loadCatalog, loadUnitCatalog } from "../catalog";
import { fail, type Reader, type RecordWriter } from "../connection";
import { deliveryPackets, packetResponses, toolAssignments, users } from "../schema";
import { readReleaseBasis } from "../operations/tools";
import { readActors, reviewers } from "../records/work";

export async function readReadinessBasis(db: Reader, unit?: UnitEdition) {
  const [{production, verification, local}, catalog, actors, basis, toolTasks] = await Promise.all([
    readUnitWork(db, unit),
    unit ? loadUnitCatalog(db, unit.serial, unit.revisionId) : loadCatalog(db),
    readActors(db), readReleaseBasis(db, unit),
    db.select().from(toolAssignments).where(and(isNull(toolAssignments.completedAt),
      or(eq(toolAssignments.tool, "agreements"), !unit ? eq(toolAssignments.section, "operations") : undefined))),
  ]);

  return { records: { catalog, production, verification }, local, ...basis, toolTasks, actors, users: reviewers(actors) };
}

export async function readReadinessWorkspace(db: Reader) {
  const [basis, packets] = await Promise.all([
    readReadinessBasis(db),
    db.select({ ...getTableColumns(deliveryPackets), receipt: packetResponses }).from(deliveryPackets)
      .leftJoin(packetResponses, eq(packetResponses.packetId, deliveryPackets.id))
      .orderBy(desc(deliveryPackets.version)),
  ]);

  return { ...basis, packets };
}

export async function recordPacketResponse(tx: RecordWriter, input: Record<string, unknown>) {
  const {packetId,serial,revisionId,version,outcome,recordedBy} = input;
  const receivedFrom = entryText(input.receivedFrom, 120), reference = entryText(input.reference, 200);
  if (typeof packetId !== "string" || (outcome !== "Accepted" && outcome !== "Returned") ||
      !receivedFrom || !reference || typeof recordedBy !== "string")
    return fail("Choose a response and identify the customer contact, receipt and recorder.",400);
  const [packet] = await tx.select({serial: deliveryPackets.serial, revisionId: deliveryPackets.revisionId,
    version: deliveryPackets.version, recorder: users.id}).from(deliveryPackets)
    .leftJoin(users, sql`${users.id} = ${recordedBy}`).where(eq(deliveryPackets.id, packetId));
  if (!packet || packet.serial !== serial || packet.revisionId !== revisionId || packet.version !== version)
    return fail("The response must identify the exact signed packet.");
  if (!packet.recorder) return fail("Choose a recorder.",400);
  const saved = await tx.insert(packetResponses).values({packetId,outcome,receivedFrom,reference,recordedBy:packet.recorder})
    .onConflictDoNothing().returning({id:packetResponses.packetId});

  return saved.length ? {saved:true} : fail("A customer response is already recorded for this packet version.");
}

export async function signPacket(tx: RecordWriter, input: Record<string, unknown>) {
  if (typeof input.serial !== "string" || typeof input.revisionId !== "string" || typeof input.signer !== "string") return fail("Choose a unit, revision and signer.", 400);
  const [basis, [prior]] = await Promise.all([
    readReadinessBasis(tx, {serial: input.serial, revisionId: input.revisionId}),
    tx.select({version: deliveryPackets.version}).from(deliveryPackets)
      .where(and(eq(deliveryPackets.serial, input.serial), eq(deliveryPackets.revisionId, input.revisionId)))
      .orderBy(desc(deliveryPackets.version)).limit(1),
  ]);
  const revision = basis.records.catalog.revisions.find(({id}) => id === input.revisionId);
  if (!revision || !basis.users.some((u) => u.id === input.signer)) return fail("Unknown revision or signer.");
  const unit = { serial: input.serial, revisionId: revision.id, revision: revision.version };
  const { blockers, contents } = unitReadiness(basis, unit);
  if (blockers.length || input.basis !== packetBasis(contents))
    return fail("Readiness changed. Refresh the packet and review it before signing.");
  await tx.insert(deliveryPackets).values({ id: crypto.randomUUID(), serial: unit.serial, revisionId: unit.revisionId,
    version: (prior?.version ?? 0) + 1, signedBy: input.signer, contents });

  return { saved: true };
}
