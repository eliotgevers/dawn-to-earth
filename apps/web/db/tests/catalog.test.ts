import assert from "node:assert/strict";
import type { CatalogEdit } from "../../components/catalog/store";
import { expect } from "bun:test";
import { packetBasis, unitReadiness } from "../../lib/readiness";
import { writeAcceptance } from "../verification/acceptance";
import { loadCatalog, readCatalogTab, saveCatalog } from "../catalog";
import { readReadinessBasis, readReadinessWorkspace } from "../verification/release";
import { deliveryPackets, verificationReviews } from "../schema";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

databaseTest("Catalog checks current assignments at save and preserves the prior edition", async (tx) => {
  const key = crypto.randomUUID();
  const system = { level: "system", id: key, title: "Document index" } satisfies CatalogEdit;
  const first = { level: "revision", id: key + "-a", systemId: key, version: "Edition A" } satisfies CatalogEdit;
  const second = { ...first, id: key + "-b", version: "Edition B" };
  const project = { level: "project", id: key + "-project", title: "Register handoff", revisionIds: [first.id] } satisfies CatalogEdit;
  const unit = { level: "unit", id: "CARD-" + key, create: true, title: "Filed cover", revisionId: first.id, projectId: project.id } satisfies CatalogEdit;
  for (const edit of [system, first, second, project, unit]) expect(await saveCatalog(tx, edit)).toEqual({ saved: true });
  const write = (edit: CatalogEdit) => saveCatalog(tx, edit);
  expect((await write({ ...unit, title: "Second submission" })).status).toBe(409);
  expect((await write({ ...unit, id: unit.id.toLowerCase() })).status).toBe(409);
  expect((await write({ ...second, version: first.version.toLowerCase() })).status).toBe(409);
  expect((await write({ ...project, revisionIds: [] })).status).toBe(409);
  expect((await write({ ...unit, create: false, revisionId: second.id })).status).toBe(409);
  expect((await loadCatalog(tx)).units.find(({ serial }) => serial === unit.id)?.title).toBe("Filed cover");

  expect(await write({ ...project, revisionIds: [first.id, second.id] })).toEqual({ saved: true });
  const archived = { level: "archive", entity: "project", id: project.id, archived: true } satisfies CatalogEdit;
  expect(await write(archived)).toEqual({ saved: true });
  expect(await write({ ...unit, create: false, title: "Retained assignment" })).toEqual({ saved: true });
  expect((await write({ ...unit, create: false, revisionId: second.id })).status).toBe(409);
  expect(await write({ ...archived, archived: false })).toEqual({ saved: true });
  expect(await write({ ...unit, create: false, revisionId: second.id })).toEqual({ saved: true });
  expect(await write({ ...project, revisionIds: [second.id] })).toEqual({ saved: true });
  const stored = (await loadCatalog(tx)).units.find(({ serial }) => serial === unit.id);
  expect(stored?.configurations.map(({ revisionId }) => revisionId)).toEqual([first.id, second.id]);
  expect((await write({ level: "remove", entity: "revision", id: first.id })).status).toBe(409);

  const reviewed = { ...first, id: key + "-reviewed", version: "Document review" };
  expect(await write(reviewed)).toEqual({ saved: true });
  const at = new Date();
  await tx.insert(verificationReviews).values({
    id: key, recordedAt: at,
    data: { id: key, test: "communication", decision: "Reviewed", evidenceIds: [], reason: "Archive reviewed",
      recordedAt: at.toISOString(), scope: { selection: `revision:${reviewed.id}` } },
  });
  expect((await write({ level: "remove", entity: "revision", id: reviewed.id })).status).toBe(409);
  const unused = { ...first, id: key + "-unused", version: "Unassigned draft" };
  expect(await write(unused)).toEqual({ saved: true });
  expect(await write({ level: "remove", entity: "revision", id: unused.id })).toEqual({ saved: true });
  expect((await write({ ...unused, create: false, version: "Stale editor" })).status).toBe(409);
});

databaseTest("a customer receipt belongs only to its signed unit packet and scope version", async (tx) => {
  const snapshot = await readReadinessBasis(tx);
  const check = snapshot.records.verification.acceptanceChecks.find(
    (c) => c.id === "oasis-archive-edition",
  );
  assert(check, "Missing Oasis acceptance check");
  const scope = snapshot.agreements.find(entry => entry.scope.caseId === "agreement-oasis-report-handoff")?.scope;
  assert(scope, "Missing acknowledged Oasis scope");
  const unit = check.unit;
  const captured = await writeAcceptance(tx, {
    ...unit,
    checkId: check.id,
    operation: "capture",
    source: "Retained report index",
    mark: unit.revision,
    observation: "Both article and edition are identified.",
  });
  assert("id" in captured, "Failed to capture the report index");
  const signed = await writeAcceptance(tx, {
    ...unit,
    checkId: check.id,
    operation: "review",
    evidenceId: captured.id,
    decision: "Approved",
    reason: "Index and retained cover agree.",
  });
  expect(signed).toMatchObject({ id: expect.stringMatching(/.+/) });
  const disposition = await writeWorkspace(tx, {
    operation: "record",
    record: {
      kind: "issue",
      title: "Cover indexed",
      description: "Attachment and edition reconciled.",
      context: unit.serial,
      action: { parentId: check.issueId, type: "dispose", outcome: "Resolved", unit },
    },
  });
  assert(!("error" in disposition), "Cover disposition failed");
  const preview = async () => unitReadiness(await readReadinessBasis(tx, unit), unit).contents;
  const sign = {
    operation: "sign-packet",
    ...unit,
    basis: packetBasis(await preview()),
    signer: "quality",
  };
  const guardIssue = snapshot.records.production
    .find(({ id }) => id === "bench-button-guard-issue");
  assert(guardIssue, "Missing independent guard issue");
  expect(guardIssue.unit).toEqual(unit);
  const held = await writeWorkspace(tx, sign);
  expect(held).toMatchObject({ status: 409, error: expect.stringContaining("Readiness changed") });

  // The approved cover and the agreed scope leave the independent counter-guard issue open.
  const brush = await writeWorkspace(tx, {
    operation: "record",
    record: {
      kind: "evidence", test: "communication", evidenceType: "Record", unit,
      title: "Raised-guard sleeve-brush comparison",
      description: "The counter did not advance during the brush comparison on the raised guard.",
      context: "Bench counter follow-up to BG-02",
    },
  });
  assert("record" in brush, "Failed to record the guard observation");
  expect(brush.record.id).toBeTruthy();
  expect(await writeWorkspace(tx, {
    operation: "review",
    review: {
      test: "communication", scope: { selection: "unit:" + unit.serial, revision: unit.revisionId },
      decision: "Reviewed", reason: "Read the brush observation alongside the deliberate press in BG-02.",
    },
    targets: [{ id: brush.record.id }],
  })).toMatchObject({ saved: true });
  expect(await writeWorkspace(tx, sign)).toMatchObject({ status: 409 });
  const guardDisposition = await writeWorkspace(tx, {
    operation: "record",
    record: {
      kind: "issue", title: "Raised-guard brush comparison reviewed",
      description: "The added comparison records the missing brush outcome for this unit.",
      context: brush.record.id, action: { parentId: guardIssue.id, type: "dispose", outcome: "Resolved", unit },
    },
  });
  expect(guardDisposition).toMatchObject({ record: { id: expect.stringMatching(/.+/) } });
  const opened = await preview();
  expect(await writeWorkspace(tx, { ...sign, basis: packetBasis({
    ...opened, scopes: [{ ...scope, versionId: "unagreed-edition" }],
  }) })).toMatchObject({ status: 409 });
  const build = opened.builds[0];
  const edit = await writeWorkspace(tx, { operation: "record", record: {
    kind: "build", title: "Retained guard inspection worksheet", description: "Index entry checked against the cover.",
    context: unit.serial, action: { type: "edit", parentId: build.id, unit },
  } });
  expect(edit).toMatchObject({ record: { id: expect.stringMatching(/.+/) } });
  const updated = await preview();
  expect(updated.builds.find(row => row.id === build.id)?.title).toBe("Retained guard inspection worksheet");
  expect(await writeWorkspace(tx, sign)).toMatchObject({ status: 409, error: expect.stringContaining("Refresh") });
  expect(await writeWorkspace(tx, { ...sign, basis: packetBasis(updated) })).toMatchObject({ saved: true });
  const versions = async () => (await readReadinessWorkspace(tx)).packets.filter(row => row.serial === unit.serial);
  const [packet] = await versions();
  assert(packet.contents.scopes, "Packet has no recorded scope");
  expect(packet.contents.scopes[0]).toEqual(scope);
  expect(packet.receipt).toBeNull();
  // Another packet can cite this agreement while covering a different promised edition.
  const olderScope = { ...packet.contents.scopes[0], versionId: "earlier-agreed-edition" };
  await tx.insert(deliveryPackets).values({ ...packet, id: crypto.randomUUID(), version: packet.version + 1,
    contents: { ...packet.contents, scopes: [olderScope] } });
  const catalog = await readCatalogTab(tx, "projects");
  expect(catalog.agreements?.find(row => row.caseId === scope.caseId)?.packet?.id).toBe(packet.id);
  const receipt = {
    operation: "record-packet-response",
    packetId: packet.id,
    ...unit,
    version: packet.version,
    outcome: "Accepted",
    receivedFrom: "Project document desk",
    reference: "CORR-12",
    recordedBy: "research-partner",
  };
  expect(await writeWorkspace(tx, { ...receipt, serial: "REF-OASIS-02" })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, { ...receipt, version: packet.version + 1 })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, { ...receipt, recordedBy: "unknown-recorder" })).toMatchObject({ status: 400 });
  expect(await writeWorkspace(tx, receipt)).toMatchObject({ saved: true });
  expect(await writeWorkspace(tx, { ...receipt, outcome: "Returned" })).toMatchObject({ status: 409 });
  const [later, received] = await versions();
  expect(later.receipt).toBeNull();
  expect(received).toMatchObject({ id: packet.id, contents: packet.contents,
    receipt: { receivedFrom: "Project document desk", recordedBy: "research-partner" } });
});
