import assert from "node:assert/strict";
import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import type { EvidenceReview, ReviewDecision } from "../../components/verification/model";
import { reviewHistory } from "../../components/verification/outcomes";
import { readAcceptanceChecks, writeAcceptance } from "../verification/acceptance";
import { acceptanceChecks, inspectionFindings, verificationReviews } from "../schema";
import { readVerificationWorkspace } from "../verification/evidence";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

const unit = { serial: "LK-014", revisionId: "bench-a", revision: "Rev A" };

const sibling = { ...unit, serial: "LK-016" };

databaseTest(
  "ordinary multi-evidence review persists once, rejects a stale head or wrong sibling, and keeps category history separate",
  async (tx) => {
    const ids: string[] = [];
    for (const title of ["Archive index", "Archive cover"]) {
      const result = await writeWorkspace(tx, {
        operation: "record",
        record: {
          kind: "evidence",
          test: "thermal",
          evidenceType: "Record",
          unit,
          title,
          description: "Named in the recorded index.",
          context: "Document register",
        },
      });
      assert("record" in result && result.record?.id);
      ids.push(result.record.id);
    }
    const save = (owner: typeof unit, decision: ReviewDecision, targets: {id: string; expectedReviewId?: string}[]) =>
      writeWorkspace(tx, {
        operation: "review",
        review: {
          test: "thermal",
          scope: { selection: "unit:" + owner.serial, revision: owner.revisionId },
          decision,
          reason: "Reviewed the recorded index.",
        },
        targets,
      });
    const original = ids.map((id) => ({ id }));
    const moved = { ...unit, revisionId: "bench-b" };
    expect(await writeWorkspace(tx, { operation: "catalog", edit: {
      level: "unit", id: unit.serial, revisionId: moved.revisionId, projectId: null, create: false,
    } })).toMatchObject({ saved: true });
    expect(await save(moved, "On hold", original)).toMatchObject({ status: 409 });
    expect(await save(sibling, "Approved", original)).toMatchObject({ status: 409 });
    expect(await save(unit, "On hold", original)).toMatchObject({ saved: true });
    expect(await save(unit, "Reviewed", [])).toMatchObject({ saved: true });
    expect(await save(unit, "Approved", original)).toMatchObject({ status: 409 });

    // Old decisions may have no method, while a later decision from another method is unrelated.
    const legacy: EvidenceReview = {
      id: crypto.randomUUID(), decision: "Approved", reason: "Original intake",
      evidenceIds: [ids[0]], scope: { selection: `unit:${unit.serial}`, revision: unit.revisionId },
      recordedAt: new Date(Date.now() + 1000).toISOString(),
    };
    const other: EvidenceReview = { ...legacy, id: crypto.randomUUID(), test: "vibration",
      recordedAt: new Date(Date.now() + 2000).toISOString() };
    await tx.insert(verificationReviews).values([legacy, other].map(data =>
      ({ id: data.id, recordedAt: new Date(data.recordedAt), data })));
    expect(await save(unit, "Reviewed", [{ id: ids[0], expectedReviewId: other.id }])).toMatchObject({ status: 409 });
    expect(await save(unit, "Reviewed", [{ id: ids[0], expectedReviewId: legacy.id }])).toMatchObject({ saved: true });
  },
);

databaseTest(
  "source and authored evidence removal is audited, honors exact method and serial, and rechecks links during the write",
  async (tx) => {
    const mutate = (id: string, owner = unit, test = "communication") =>
      writeWorkspace(tx, {
        operation: "record",
        record: {
          kind: "evidence",
          test,
          title: "Archive receipt",
          description: "Removed from the active list.",
          context: "Archive",
          action: { type: "remove", parentId: id, unit: owner },
        },
      });
    const add = await writeWorkspace(tx, {
      operation: "record",
      record: {
        kind: "evidence",
        unit,
        test: "communication",
        evidenceType: "Record",
        title: "File receipt",
        description: "The returned page matches the source index.",
        context: "Intake register",
      },
    });
    assert("record" in add && add.record);
    const id = add.record.id;
    const amend = (owner: typeof unit) => writeWorkspace(tx, {operation: "record", record: {
      kind: "evidence", test: "communication", evidenceType: "Functional check", title: "Reader kept the previous file name",
      description: "The receipt shows an empty attachment field while the reader still displays the earlier file.", context: "Second intake register",
      action: {type: "edit", parentId: id, unit: owner},
    }});
    expect(await amend(sibling)).toMatchObject({ status: 409 });
    const amended = await amend(unit);
    assert("record" in amended && amended.record);
    expect(amended.record.action?.parentId).toBe(id);
    expect(await mutate(id, sibling)).toMatchObject({ status: 409 });
    expect(await mutate(id, unit, "thermal")).toMatchObject({ status: 409 });
    const review = (id: string) =>
      writeWorkspace(tx, {
        operation: "review",
        review: {
          test: "communication",
          scope: { selection: "unit:LK-014", revision: "bench-a" },
          decision: "Reviewed",
          reason: "Reviewed the receipt.",
        },
        targets: [{ id }],
      });
    expect(await review(id)).toMatchObject({ saved: true });
    const snapshot = await readVerificationWorkspace(tx);
    const current = snapshot.records.verification;
    const [evidence] = current.records.communication.filter(row => row.id === id);
    expect(evidence).toMatchObject({title: "Reader kept the previous file name", type: "Functional check", source: "Second intake register", unit});
    const journal = snapshot.evidenceHistory.filter(row => row.action?.parentId === id);
    expect(journal.map(row => row.id)).toEqual([amended.record.id]);
    const signed = snapshot.reviews.filter(entry => entry.evidenceIds.includes(id));
    expect(reviewHistory(current, signed, [])[0].links).toEqual([
      evidence,
    ]);
    expect(await mutate(id)).toMatchObject({ error: expect.stringMatching(/recorded review/) });
    const source = "communication-interface-note";
    expect(await mutate(source)).toMatchObject({ record: { action: { parentId: source } } });
    expect(await mutate(source)).toMatchObject({ status: 409 });
    expect(await review(source)).toMatchObject({ status: 409 });
    expect(await mutate("proof-pressure-original", unit, "pressure")).toMatchObject({ error: expect.stringMatching(/retest|review/) });
  },
);

databaseTest("an inspection and QA decision pin their runs, requirement, unit and interval", async (tx) => {
  const checkId = "acceptance-firefly-image";
  const [{ data: check }] = await tx.select().from(acceptanceChecks).where(eq(acceptanceChecks.id, checkId));
  assert(check.comparison);
  const { runId, rerunId, evidenceId: archiveId } = check.comparison;
  const scope = {
    checkId, serial: check.unit.serial, revisionId: check.unit.revisionId,
    requirementId: check.requirementId, runId, rerunId, archiveId,
  };
  const capture = {
    ...scope, operation: "capture", start: 2, end: 4, requestId: crypto.randomUUID(),
    observation: "The caption is legible in the selected frames.",
  };
  const finding = {
    ...scope, operation: "save-finding", target: check.issueId, first: 2, last: 4,
    observation: capture.observation, requestId: crypto.randomUUID(),
  };
  for (const mismatch of [
    { serial: "REF-FFLY-02" }, { rerunId: runId }, { archiveId: "wrong" }, { requirementId: "other" },
  ]) {
    expect(await writeAcceptance(tx, { ...capture, ...mismatch })).toMatchObject({ status: 409 });
    expect(await writeWorkspace(tx, { ...finding, ...mismatch })).toMatchObject({ status: 409 });
  }
  const saved = await writeAcceptance(tx, capture);
  assert("id" in saved && saved.id);
  const signed = await writeAcceptance(tx, {
    ...scope, operation: "review", evidenceId: saved.id, decision: "Approved",
    reason: "The selected record is attributable to this article.",
  });
  assert("id" in signed && signed.id);
  expect(await writeWorkspace(tx, { ...finding, target: signed.id })).toMatchObject({ id: finding.requestId });
  const [reviewed] = await readAcceptanceChecks(tx, [checkId], scope);
  const frozen = reviewed.captures.find(r => r.id === saved.id)?.archive;
  assert(frozen);
  expect(frozen).toMatchObject({ runId, rerunId, requirementId: scope.requirementId, evidenceId: archiveId });
  expect(frozen.frames[1].repeatImage).toBe(check.comparison.frames[1].repeatImage);
  // A later archive edition may be reviewed independently; old units and source versions remain retrievable.
  await tx.update(acceptanceChecks).set({ data: {
    ...check, comparison: { ...check.comparison, rerunId: "revision-two" },
  } }).where(eq(acceptanceChecks.id, checkId));
  expect(await writeAcceptance(tx, { ...capture, requestId: crypto.randomUUID() })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, {
    ...finding, rerunId: "revision-two", target: signed.id, requestId: crypto.randomUUID(),
  })).toMatchObject({ status: 409 });
  const [archiveFinding] = await tx.select().from(inspectionFindings).where(eq(inspectionFindings.id, finding.requestId));
  expect(archiveFinding.archive).toEqual(frozen);
  expect(archiveFinding.decisionId).toBe(signed.id);
});
