import assert from "node:assert/strict";
import { expect } from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { EvidenceRecord } from "../../components/verification/model";
import { resolveExchange, type ExchangeArchive, type ExchangeLog } from "../../components/verification/document-exchanges";
import { recordActivity, visibleRecordNotes } from "../../lib/records/journal";
import { readRecordHistory } from "../records/history";
import { workspaceBaseline, workspaceRecords } from "../schema";
import { readArchiveSources } from "../verification/evidence";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

const previous: ExchangeLog = { id: "register-prior", title: "Received register", events: [
  { id: "a-entry", key: "cover-03", document: "Cover sheet", atMs: 1, kind: "request", expected: "Filed" },
] };

const current: ExchangeLog = { id: "register-current", title: "Returned register", events: [
  { id: "b-entry", key: "cover-03", document: "Cover sheet", atMs: 1, kind: "request", expected: "Filed" },
  { id: "b-reply", key: "cover-03", document: "Cover sheet", atMs: 4, kind: "reply", value: "Filed" },
] };

const archive = { id: "cover-index-trace", prior: previous, current };

databaseTest("a documentary event finding pins server source, unit, revision and events; retry and subsequent source corrections preserve its basis", async (tx) => {
  const [baseline] = await tx.select().from(workspaceBaseline);
  const { verification } = baseline;
  const record = verification.records.communication.find(r => r.id === "communication-capture");
  assert(record?.unit);
  const attach = async (archive: ExchangeArchive, extra: EvidenceRecord[] = []) => {
    const records = { ...verification.records, communication: [
      ...verification.records.communication.map(r => r.id === record.id ? { ...r, exchangeArchive: archive } : r),
      ...extra,
    ] };
    await tx.update(workspaceBaseline).set({ verification: { ...verification, records } })
      .where(eq(workspaceBaseline.id, baseline.id));
  };
  await attach(archive);
  const exchange = resolveExchange(archive, "cover-03");
  assert(exchange);
  const { basis } = exchange;
  const write = { operation: "event-finding", requestId: crypto.randomUUID(), sourceId: record.id, unit: record.unit,
    basis, expectedArchive: archive, actor: "reviewer", observation: "The received register has no reply for the cover sheet." };
  const attempt = (overrides: Record<string, unknown>) => writeWorkspace(tx, { ...write, ...overrides });
  expect(await attempt({ unit: { ...record.unit, serial: "LK-016" } })).toMatchObject({ status: 409 });
  expect(await attempt({ unit: { ...record.unit, revisionId: "bench-b" } })).toMatchObject({ status: 409 });
  expect(await attempt({ actor: "unknown-role" })).toMatchObject({ status: 400 });
  expect(await attempt({ observation: " ".repeat(1000) + "x" })).toMatchObject({ status: 400 });
  expect(await attempt({ observation: "   " })).toMatchObject({ status: 400 });
  expect(await attempt({ basis: { ...basis, currentEventIds: ["some-other-reply"] } })).toMatchObject({ status: 409 });
  const removalId = crypto.randomUUID();
  const removal = { id: removalId, kind: "evidence", title: "Archived exchange", description: "", context: "Register", recordedAt: new Date().toISOString(), action: {type: "remove", parentId: record.id, unit: record.unit} } as const;
  await tx.insert(workspaceRecords).values({id: removalId, kind: removal.kind, recordedAt: new Date(), data: removal});
  expect(await attempt({})).toMatchObject({ status: 409 });
  await tx.update(workspaceRecords).set({data: {...removal, action: {...removal.action, unit: {...record.unit, serial: "sibling"}}}})
    .where(eq(workspaceRecords.id, removalId));
  const result = await attempt({});
  assert("record" in result && result.record);
  const saved = result.record;
  assert(saved.eventFinding);
  expect(saved.eventFinding.basis).toEqual(basis);
  expect(saved.eventFinding.archive).toEqual(archive);
  // A new finding cannot choose between competing original IDs or cite a navigation alias.
  // An existing immutable receipt still reopens even if a later import introduces a collision.
  for (const competing of [
    { ...record, exchangeArchive: archive },
    { ...record, id: "another-record", capture: { reviewId: record.id, handoffId: "navigation-only" } },
  ]) {
    await attach(archive, [competing]);
    expect(await attempt({ requestId: crypto.randomUUID() })).toMatchObject({ status: 409 });
    expect(await attempt({ requestId: crypto.randomUUID(), sourceId: "navigation-only" })).toMatchObject({ status: 409 });
    expect(await attempt({})).toMatchObject({ record: { id: saved.id } });
  }
  await attach(archive);
  expect(saved.action).toEqual({ type: "note", parentId: record.id, unit: record.unit });
  expect(await attempt({ observation: "A different finding." })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, { operation: "record", record: { ...saved, action: undefined } })).toMatchObject({ status: 400 });
  const noteAction = (type: string, extra: Record<string, unknown> = {}) => writeWorkspace(tx, { operation: "record", record: {
    kind: "evidence", test: "communication", title: "Review note", description: "Follow-up note.",
    context: "Register", action: { type, parentId: record.id, unit: record.unit }, ...extra,
  } });
  expect(await noteAction("remove")).toMatchObject({ error: expect.stringMatching(/exchange finding/) });
  expect(await noteAction("edit-note", { noteId: saved.id })).toMatchObject({ status: 409 });
  expect(await noteAction("remove-note", { noteId: saved.id })).toMatchObject({ status: 409 });
  expect(await noteAction("edit-note", { noteId: "missing-note" })).toMatchObject({ status: 409 });
  const note = await noteAction("note");
  assert("record" in note && note.record?.action);
  const ordinary = note.record;
  expect(await noteAction("edit-note", { noteId: ordinary.id })).toHaveProperty("record.id");
  expect(await noteAction("remove-note", { noteId: ordinary.id })).toHaveProperty("record.id");
  expect(await noteAction("edit-note", { noteId: ordinary.id })).toMatchObject({ status: 409 });
  // An imported edit after deletion cannot make the original note visible or editable again.
  const late = { ...ordinary, id: crypto.randomUUID(), noteId: ordinary.id,
    recordedAt: new Date(Date.now() + 1000).toISOString(), action: { parentId: record.id, unit: record.unit, type: "edit-note" as const } };
  await tx.insert(workspaceRecords).values({ id: late.id, kind: late.kind, data: late, recordedAt: new Date(late.recordedAt) });
  const activity = recordActivity(await readRecordHistory(tx), record.id, record.unit);
  expect(visibleRecordNotes(activity).some(note => note.id === ordinary.id)).toBe(false);
  expect(await noteAction("edit-note", { noteId: ordinary.id })).toMatchObject({ status: 409 });
  const corrected = { ...archive, current: { ...current, events: current.events.map(e =>
    e.id === "b-reply" ? { ...e, value: "Receipt pending" } : e) } };
  await attach(corrected);
  expect(await attempt({ requestId: crypto.randomUUID() })).toMatchObject({ status: 409 });
  expect(await attempt({})).toMatchObject({ record: { id: saved.id } });
  const rows = await tx.select().from(workspaceRecords).where(eq(workspaceRecords.id, saved.id));
  expect(rows.length).toBe(1);
  expect(rows[0].data.eventFinding?.archive.current.events.at(-1)).toMatchObject({kind: "reply", value: "Filed"});

  const projected = await readArchiveSources(tx);
  const original = projected.activity.find(({ action, eventFinding }) => action?.parentId === record.id && eventFinding?.basis.correlation === basis.correlation);
  expect(original?.eventFinding).toEqual(saved.eventFinding);
  const latest = projected.sources.find(row => row.test === "communication" && row.id === record.id);
  expect(latest?.exchangeArchive).toEqual(corrected);
  expect(original).toMatchObject({ matchesSource: true });
  // Neither a changed event list nor a bare correlation identifies the saved readings.
  for (const badBasis of [{ ...basis, priorEventIds: ["another-entry"] }, basis.correlation]) {
    const eventFinding = { ...saved.eventFinding, basis: badBasis };
    await tx.update(workspaceRecords).set({ data: sql`${JSON.stringify({ ...saved, eventFinding })}::jsonb` }).where(eq(workspaceRecords.id, saved.id));
    const invalid = (await readArchiveSources(tx)).activity.find(row => row.eventFinding && row.action?.parentId === record.id);
    const storedLegacyFinding: unknown = invalid?.eventFinding;
    expect(storedLegacyFinding).toEqual(eventFinding);
    expect(invalid).toMatchObject({ matchesSource: false });
  }
});
