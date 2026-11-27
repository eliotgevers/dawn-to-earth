import assert from "node:assert/strict";
import { expect } from "bun:test";
import { count, eq } from "drizzle-orm";
import type { Judgment } from "../workflows/qualification";
import { assignmentHref } from "../../lib/workspace-routes";
import { assemblyRecords, decisions, evidence, toolCases } from "../schema";
import { readToolState, recordToolDecision } from "../operations/tools";
import { isObject } from "../workflows/cases";
import { databaseTest } from "./postgres.test-support";

const caseId = "reuse-cover-index";
const unit = { serial: "REF-OASIS-01", revisionId: "public-tumbleweed-oasis-beta-ref", revision: "Mission integration" };

databaseTest("Oasis technical judgment returns to the proposer, then sends exact-artifact gaps to Verification without creating acceptance", async tx => {
  const judgments: Judgment[] = [
    { rowId: "cover-edition-reference", outcome: "applies", assumption: "recorded", reason: "Both archived examples identify the edition beside the cover." },
    { rowId: "cover-unit-reference", outcome: "does-not-support", assumption: "changed", reason: "A platform label cannot attribute the cover to this article." },
    { rowId: "cover-prior-edition", outcome: "new-evidence", assumption: "unknown", reason: "The earlier edition has no retained source sheet." },
  ];
  const command = (action: string, data: Record<string, unknown>, actor = "reviewer", onCase = caseId) =>
    recordToolDecision(tx, "qualification", { caseId: onCase, action, data, actor });
  const state = () => readToolState(tx, "qualification", caseId);
  const tally = async (table: typeof decisions | typeof evidence) => (await tx.select({ n: count() }).from(table))[0].n;
  const before = [await tally(decisions), await tally(evidence)];

  async function event(action: string, data: Record<string, unknown>, actor?: string) {
    const result = await command(action, data, actor);
    assert("eventId" in result, "Expected a recorded " + action);
    expect(result.eventId).toBeDefined();
    return result.eventId;
  }

  const propose = { report: "CR-08/A", judgments, previousProposalId: null };
  expect(await command("propose", propose, "reviewer", "reuse-interface-index")).toMatchObject({ status: 409 });
  const firstId = await event("propose", propose);
  const original = (await state()).cases.find(row => row.id === caseId)?.history.find(e => e.id === firstId);
  assert(original && Array.isArray(original.data.rows), "Proposal has no archived comparison");
  const originalRows: unknown[] = original.data.rows;
  const edition = originalRows.find(row => isObject(row) && row.id === "cover-edition-reference");
  assert(isObject(edition), "Edition comparison is missing");
  expect(edition.study).toMatchObject({ quantity: "Editions in the index", unit: "editions", proposedValue: 2, samples: [{ value: 2 }, { value: 2 }] });

  const returnId = await event("review", {
    proposalId: firstId, outcome: "return", reason: "Distinguish the platform cover from the configured article.",
  }, "quality");
  const returned = (await state()).tasks.find(t => t.eventId === returnId);
  assert(returned, "Return should create an Engineering assignment");
  expect(returned).toMatchObject({ owner: "reviewer", section: "engineering", unit });
  expect(assignmentHref(returned)).toContain("/engineering/qualification?case=reuse-cover-index#");

  const revisedId = await event("propose", { ...propose, previousProposalId: firstId });
  expect((await state()).tasks.find(t => t.id === returned.id)?.completedAt).toBeTruthy();
  const endorse = { proposalId: revisedId, outcome: "endorse", reason: "Keep the covered edition clause and investigate the two article gaps.", owner: "technician" };
  expect(await command("review", { ...endorse, proposalId: firstId }, "quality")).toMatchObject({ status: 409 });

  const reportId = "study-cover-register-r1";
  const [{ data: reportSource }] = await tx.select().from(toolCases).where(eq(toolCases.id, reportId));
  const changedReport = structuredClone(reportSource);
  assert(isObject(changedReport.excerpts));
  const excerpt = changedReport.excerpts["cover-edition-reference"];
  assert(isObject(excerpt) && isObject(excerpt.study) && Array.isArray(excerpt.study.samples));
  const sample: unknown = excerpt.study.samples[0];
  assert(isObject(sample) && typeof sample.value === "number", "Missing numeric report sample");
  sample.value++;
  await tx.update(toolCases).set({ data: changedReport }).where(eq(toolCases.id, reportId));
  expect(await command("review", endorse, "quality")).toMatchObject({ status: 409 });
  await tx.update(toolCases).set({ data: reportSource }).where(eq(toolCases.id, reportId));

  const requirementId = original.data.requirementId;
  assert(typeof requirementId === "string", "Proposal has no source requirement");
  const [{ data: requirement }] = await tx.select().from(assemblyRecords).where(eq(assemblyRecords.id, requirementId));
  const fields = requirement.fields.map(([key, value]) => [
    key, key === "Acceptance criterion" ? "A later criterion records the custodian as well." : value,
  ] as const);
  await tx.update(assemblyRecords).set({ data: { ...requirement, fields } }).where(eq(assemblyRecords.id, requirementId));
  expect(await command("review", endorse, "quality")).toMatchObject({ status: 409 });
  await tx.update(assemblyRecords).set({ data: requirement }).where(eq(assemblyRecords.id, requirementId));

  const signedId = await event("review", endorse, "quality");
  expect(await command("review", endorse, "quality")).toMatchObject({ status: 409 });
  const followUps = (await state()).tasks.filter(t => t.eventId === signedId);
  expect(followUps.map(t => t.sourceId).sort()).toEqual(["cover-prior-edition", "cover-unit-reference"]);
  const task = followUps.find(t => t.sourceId === "cover-prior-edition");
  assert(task, "Earlier edition has no Verification follow-up");
  expect(task).toMatchObject({ section: "verification", owner: "technician", unit });
  expect(assignmentHref(task)).toBe("/engineering/qualification?case=reuse-cover-index#cover-prior-edition");
  const finding = {
    taskId: task.id, previousFindingId: null, outcome: "Source located", source: "Archive / earlier cover, folio 3",
    observation: "The cited earlier edition is traceable to this cover.",
  };
  expect(await command("document-gap", finding, "technician", "reuse-interface-index")).toMatchObject({ status: 409 });
  const notedId = await event("document-gap", finding, "technician");
  const fresh = await state();
  expect(fresh.tasks.find(t => t.id === task.id)?.completedBy).toBe(notedId);
  expect(fresh.tasks.find(t => t.id !== task.id && t.eventId === signedId)?.completedAt).toBeNull();
  expect(fresh.cases.find(row => row.id === caseId)?.history.find(e => e.id === firstId)).toEqual(original);
  expect([await tally(decisions), await tally(evidence)]).toEqual(before);
});
