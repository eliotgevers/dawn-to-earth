import assert from "node:assert/strict";
import { expect } from "bun:test";
import { studyArchives, studyFilings, sourceFingerprint, type StudyFiling } from "../../lib/archives/study";
import { saveCatalog } from "../catalog";
import { readOperationsStudy, saveOperationsStudy } from "../operations/study";
import { catalogEntries } from "../schema";
import { databaseTest, type TestTransaction } from "./postgres.test-support";

async function fileUnit(tx: TestTransaction, { projectId, revisionId, serial }: StudyFiling) {
  assert(serial, "A unit filing requires a serial");
  const systemId = projectId + "-study-system";
  await tx.insert(catalogEntries).values([
    { kind: "systems", id: systemId, position: 0, data: { id: systemId, title: systemId, recordIds: [] } },
    { kind: "revisions", id: revisionId, position: 0, data: { id: revisionId, systemId, version: "A", recordIds: [] } },
    { kind: "projects", id: projectId, position: 0, data: { id: projectId, title: projectId, revisionIds: [revisionId], recordIds: [] } },
    { kind: "units", id: serial, position: 0, data: { serial, projectId, revisionId, configurations: [{ revisionId, recordIds: [], history: [] }] } },
  ]).onConflictDoNothing();
}

databaseTest("moving a unit cannot move an archived study, accept a stale finding, or expose its sibling's evidence", async tx => {
  const study = "aurora";
  const entry = studyFilings(study).find(row => row.filing?.serial === "REF-OASIS-01");
  assert(entry?.filing, "Missing Oasis unit archive");
  const { subject, filing } = entry;
  const { serial, projectId, revisionId } = filing;
  assert(serial, "Missing serial on Oasis archive");
  await fileUnit(tx, filing);
  const sibling = "STUDY-SIBLING-" + crypto.randomUUID();
  await fileUnit(tx, { ...filing, serial: sibling });
  const empty = crypto.randomUUID();
  expect(await saveCatalog(tx, { level: "project", id: empty, create: true, title: "Unassigned archive", revisionIds: [] })).toEqual({ saved: true });
  expect((await readOperationsStudy(tx, study, undefined, [`project:${empty}`])).targets).toHaveLength(0);
  expect((await readOperationsStudy(tx, study, undefined, [`unit:${sibling}`])).targets).toHaveLength(0);
  const selection = `unit:${serial}` as const;
  const before = await readOperationsStudy(tx, study, undefined, [selection]);
  const { scope: target } = before.targets[0];
  const archive = studyArchives[study];
  const source = archive.sourceFor(subject);
  assert(source, "Missing filed replay source");
  const request = {
    target, id: crypto.randomUUID(), edition: archive.edition, stamp: await sourceFingerprint(source),
    draft: { subject, first: 1, last: 1, outcome: "Finding", note: "The first returned frame has no visible tray marks." },
  };
  expect(await saveOperationsStudy(tx, study, request, [selection])).toEqual({ id: request.id });
  const replacement = crypto.randomUUID();
  expect(await saveCatalog(tx, { level: "revision", id: replacement, create: true, systemId: target.systemId, version: replacement })).toEqual({ saved: true });
  // A legitimate Catalog operation changes the edition and clears the current assignment.
  expect(await saveCatalog(tx, { level: "unit", id: serial, create: false, title: serial, revisionId: replacement, projectId: null })).toEqual({ saved: true });
  expect(await saveOperationsStudy(tx, study, { ...request, id: crypto.randomUUID() }, [selection])).toHaveProperty("error");
  expect(await saveOperationsStudy(tx, study, request, [selection])).toEqual({ id: request.id });
  for (const key of [selection, `unit:${sibling}`, `unit:${serial}@${replacement}`] as const) {
    expect(await readOperationsStudy(tx, study, request.id, [key])).toMatchObject({ targets: [], selected: null, unavailable: true });
  }
  const older = await readOperationsStudy(tx, study, request.id, [`unit:${serial}@${revisionId}`]);
  expect(older.selected?.source.scope).toMatchObject({ projectId, serial, revisionId, selection });
  expect(older.targets).toHaveLength(0);
});
