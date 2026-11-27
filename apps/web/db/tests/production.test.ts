import { expect } from "bun:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { productionFollowUp, productionRegister } from "../../components/production/builds";
import { combinedItemDetails } from "../../components/workspace/selection";
import { inventoryForPlanning, isRegister, stockRegister, type Action, type Order } from "../workflows/inventory";
import type { WorkEvent } from "../workflows/cases";
import { recordHref } from "../../lib/records/links";
import { readEngineering, readProduction } from "../records/assembly";
import { toolCases } from "../schema";
import { readToolState, recordToolDecision } from "../operations/tools";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

function savedRecord(result: Awaited<ReturnType<typeof writeWorkspace>>) {
  assert("record" in result && result.record, "Expected a saved record");
  return result.record;
}

databaseTest("an archived build leaves Overview but stays at its exact destination outside the selected unit", async tx => {
  const unit = { serial: "LK-014", revisionId: "bench-a", revision: "Rev A" };
  const record = { kind: "queue", title: "Inspect enclosure label", description: "Check the label.", context: "File the observation.", unit };
  const created = await writeWorkspace(tx, { operation: "record", record });
  const id = savedRecord(created).id;
  const archived = await writeWorkspace(tx, { operation: "record", record: { ...record, action: { type: "remove", parentId: id, unit } } });
  expect(savedRecord(archived).action?.type).toBe("remove");
  const workspace = await readProduction(tx);
  const selection = (serial: string) => combinedItemDetails(workspace.records.catalog, [`unit:${serial}@bench-a`]);
  const target = workspace.records.production.find(row => row.id === id);
  const own = productionRegister(workspace, selection("LK-014"), "build", target);
  expect(own?.rows.filter(row => row.id === id).map(row => row.build?.filter)).toEqual(["archived"]);
  expect(productionRegister(workspace, selection("LK-014"), "overview")?.rows.some(row => row.id === id)).toBe(false);
  const sibling = selection("LK-016");
  expect(sibling?.members[0]?.serial).toBe("LK-016");
  const linked = productionRegister(workspace, sibling, "build", target);
  expect(linked?.rows.some(row => row.id === id)).toBe(false);
  expect(linked?.linkedBuild?.record.unit).toEqual(unit);
});

databaseTest("only in-progress work on the exact revision can close once; an unresolved flag blocks it", async (tx) => {
  const owner = { serial: "LK-014", revisionId: "bench-a", revision: "Rev A" };
  const entry = { kind: "queue", title: "File document index", description: "Check index receipt", context: "Reviewed index", unit: owner };
  const save = (record: Record<string, unknown>) => writeWorkspace(tx, { operation: "record", record });
  const record = savedRecord(await save(entry));
  const change = savedRecord(await save({ ...entry, kind: "change", impacts: [{ section: "production", id: record.id }] }));
  const followUp = async () => productionFollowUp({changeId: change.id, ...owner}, await readEngineering(tx));
  const expected = [{ href: recordHref("production", record.id, owner), label: entry.title, identity: `${entry.title} · ${owner.serial} · ${owner.revision}`, location: "Production · Builds" }];
  const step = (type: "flag" | "start" | "complete", overrides: Record<string, unknown> = {}) => save({ ...entry, kind: type === "flag" ? "issue" : "queue",
    action: { type, unit: owner, parentId: record.id }, ...overrides });
  expect(await step("complete")).toMatchObject({ status: 409 });
  savedRecord(await step("start"));
  const flag = savedRecord(await step("flag"));
  expect(await followUp()).toMatchObject(expected);
  expect(await step("complete")).toMatchObject({ status: 409 });
  const removeFlag = () => save({ ...entry, kind: "issue", action: { type: "remove", unit: owner, parentId: flag.id } });
  expect(await removeFlag()).toMatchObject({ status: 409 });
  savedRecord(await save({ ...entry, kind: "issue", action: { type: "dispose", unit: owner, parentId: flag.id, outcome: "Resolved" } }));
  expect(await save({ ...entry, kind: "issue", action: { type: "dispose", unit: owner, parentId: flag.id, outcome: "Keep open" } })).toMatchObject({ status: 409 });
  expect(await step("complete")).toMatchObject({ status: 409 });
  savedRecord(await step("start"));
  expect(await step("complete", { action: { type: "complete", unit: { ...owner, serial: "LK-016" }, parentId: record.id } })).toMatchObject({ status: 409 });
  expect(savedRecord(await step("complete")).action?.type).toBe("complete");
  expect(await step("complete")).toMatchObject({ status: 409 });
  expect(await step("flag")).toMatchObject({ status: 409 });
  expect(await followUp()).toEqual([]);
  expect(savedRecord(await removeFlag()).action?.type).toBe("remove");
});

databaseTest(
  "PostgreSQL preserves exact issues and exposes only documented installations to the lot trace",
  async (tx) => {
    const [labels] = await tx.select().from(toolCases).where(eq(toolCases.id, "inventory-label-24"));
    assert(labels);
    const register = { ...labels, history: [] as WorkEvent[] };
    assert(isRegister(register));
    const [first, sibling] = register.data.orders;
    const lot = { ...register, id: "inventory-regression-" + crypto.randomUUID() };
    await tx.insert(toolCases).values(lot);
    type Move = { order?: Order; previousId?: string | null; reference?: string; locationId?: string };
    const write = async (action: Action, quantity: number, { order = first, ...overrides }: Move = {}) => {
      const movementId = crypto.randomUUID();
      const result = await recordToolDecision(tx, "inventory", {
        caseId: lot.id, actor: "research-partner", action,
        data: {
          movementId, quantity, previousId: stockRegister(lot).previousId,
          partId: lot.data.partId, lotId: lot.data.lotId, locationId: "stores",
          buildId: order.buildId, unitSerial: order.unit.serial, revisionId: order.unit.revisionId,
          reference: "Ref " + movementId, ...overrides,
        },
      });
      lot.history = (await readToolState(tx, "inventory", lot.id)).cases[0].history;
      return result;
    };
    const corrections = async () =>
      (await readToolState(tx, "containment")).relatedEvents.filter((e) => e.caseId === lot.id);
    function eventId(result: Awaited<ReturnType<typeof write>>) {
      assert("eventId" in result && result.eventId, "Expected a recorded movement");
      return result.eventId;
    }
    eventId(await write("reserve", 4));
    expect(await write("issue", 2, { previousId: null })).toMatchObject({ status: 409 });
    expect(await write("issue", 2, { order: sibling })).toMatchObject({ status: 409 });
    eventId(await write("issue", 2));
    expect(await corrections()).toHaveLength(0);
    const installed = eventId(await write("install", 1, { reference: "Archive register 21 / line 4" }));
    expect((await corrections()).map((e) => e.id)).toEqual([installed]);
    expect((await corrections())[0].data.lotCorrections).toEqual([
      {
        lotId: register.data.lotId,
        serial: first.unit.serial,
        revisionId: first.unit.revisionId,
        sourceId: first.installationId,
        fileId: "Archive register 21 / line 4",
      },
    ]);
    expect(await write("return", 2)).toMatchObject({ status: 409 });
    eventId(await write("return", 1, { locationId: "records" }));
    const plan = inventoryForPlanning([lot]);
    expect(plan.find((r) => r.buildId === first.buildId)).toMatchObject({
      issued: 1,
      reserved: 2,
      installed: 1,
    });
    expect(plan.find((r) => r.buildId === sibling.buildId)).toMatchObject({
      issued: 0,
      reserved: 0,
      installed: 0,
    });
  },
);
