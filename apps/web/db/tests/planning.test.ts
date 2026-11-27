import { expect } from "bun:test";
import assert from "node:assert/strict";
import { desc, eq } from "drizzle-orm";
import { forecastPlan } from "../../lib/planning";
import { readProduction } from "../records/assembly";
import { planScenarios, planningTasks, publishedPlans, toolCases } from "../schema";
import { recordToolDecision } from "../operations/tools";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

databaseTest("saving a scenario validates the editable reservations and pins the published version", async (tx) => {
  const tasks = await tx.select().from(planningTasks);
  const [current] = await tx.select().from(publishedPlans).orderBy(desc(publishedPlans.version)).limit(1);
  const draft = {
    operation: "save-plan", baseVersion: current?.version ?? 0, title: "Document review schedule",
    slots: tasks.map(({ id: task, day, person, station }) => ({ task, day, person, station })),
  };
  expect(await writeWorkspace(tx, { ...draft, baseVersion: draft.baseVersion + 1 })).toMatchObject({ status: 409 });
  const external = draft.slots.map((slot, index) => index ? slot : { ...slot, person: "research-partner" });
  expect(await writeWorkspace(tx, { ...draft, slots: external })).toMatchObject({ status: 400 });
  const first = await writeWorkspace(tx, { ...draft, slots: draft.slots.map(slot => ({ ...slot, forecast: "approved" })) });
  assert("scenarioId" in first && typeof first.scenarioId === "string");
  const { scenarioId } = first;
  const [saved] = await tx.select().from(planScenarios).where(eq(planScenarios.id, scenarioId));
  expect(saved).toMatchObject({ slots: draft.slots, baseVersion: draft.baseVersion });

  // Give each task its own Monday, in the seed calendar's dependency order.
  const slots = tasks.toSorted((a, b) => a.day.localeCompare(b.day)).map((task, i) => ({
    task: task.id, person: task.person, station: task.station,
    day: new Date(Date.UTC(2029, 0, 1 + 7 * i)).toISOString().slice(0, 10),
  }));
  const second = await writeWorkspace(tx, { ...draft, slots, title: "Space out the inspections" });
  assert("scenarioId" in second && typeof second.scenarioId === "string");
  const edit = await writeWorkspace(tx, {operation: "record", record: {
    kind: "issue", title: "Supplier index omits the recorded article", description: "Index title corrected.", context: "Intake",
    action: {type: "edit", parentId: "receipt-supplier-index", unit: {serial: "LK-022", revisionId: "bench-b", revision: "Rev B"}},
  }});
  assert("record" in edit && edit.record);
  // Equal titles must give the preview and the narrower publish query the same recovery decision.
  const [source] = await tx.select().from(toolCases).where(eq(toolCases.id, "recovery-lk-022-index"));
  for (const caseId of ["planning-recovery-b", "planning-recovery-a"]) {
    await tx.insert(toolCases).values({ ...source, id: caseId, title: "Same receipt decision" });
    const command = (action: string, actor: string, data: Record<string, unknown>) => recordToolDecision(tx, "recovery", { caseId, action, actor, data });
    const proposal = await command("propose", "technician", { previousId: null, option: "wait",
      rationale: "Wait for the correction listed on the receipt.", readyOn: "2026-12-01" });
    assert("eventId" in proposal && typeof proposal.eventId === "string");
    const reviewed = await command("review", "quality", { previousId: proposal.eventId, rationale: "Retain the reviewed due date." });
    expect(reviewed).toMatchObject({ eventId: expect.any(String) });
  }
  const workspace = await readProduction(tx, "planning");
  assert(workspace.schedule);
  const forecast = forecastPlan({ ...workspace.schedule, execution: workspace.execution }, slots, workspace.records, workspace.local);
  expect(forecast.rows.get("receipt-intake")?.recovery?.caseId).toBe("planning-recovery-a");
  expect(forecast.stamp).toContain("Supplier index omits the recorded article");
  expect(forecast.conflicts).toBe(0);
  const publish = { operation: "publish-plan", scenario: second.scenarioId, baseVersion: draft.baseVersion, stamp: forecast.stamp };
  expect(await writeWorkspace(tx, { ...publish, scenario: scenarioId })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, { ...publish, stamp: "stale preview" })).toMatchObject({ status: 409 });
  expect(await writeWorkspace(tx, publish)).toMatchObject({ saved: true });
  expect(await writeWorkspace(tx, publish)).toMatchObject({ status: 409 });
  const [commitment] = await tx.select().from(publishedPlans).where(eq(publishedPlans.version, draft.baseVersion + 1));
  expect(commitment).toMatchObject({ scenario: second.scenarioId, dates: forecast.deliveries.map(d => d.date) });
  expect(Object.keys(commitment.dates[0]).sort()).toEqual(["checkId", "day", "forecast"]);
});
