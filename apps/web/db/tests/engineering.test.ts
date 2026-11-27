import assert from "node:assert/strict";
import type { RecordEntry } from "../../lib/records/journal";
import type { ItemSelection } from "../../components/workspace/selection";
import { expect } from "bun:test";
import { recordValues } from "../../components/records/schema";
import { readEngineering } from "../records/assembly";
import { readTimeline } from "../records/timeline";
import { writeWorkspace } from "../workspace";
import { databaseTest } from "./postgres.test-support";

databaseTest("editing a change clears its affected links on reopen and preserves its original unit-edition history", async tx => {
  const unit = { serial: "LK-016", revisionId: "bench-a", revision: "Rev A" };
  const sibling = { ...unit, serial: "LK-014" };
  const write = (record: Omit<RecordEntry, "id" | "recordedAt">) => writeWorkspace(tx, { operation: "record", record });
  async function record(input: Omit<RecordEntry, "id" | "recordedAt">) {
    const result = await write(input);
    assert("record" in result, "Expected an authored record");
    return result.record;
  }
  const requirement = await record({
    kind: "requirement", unit, title: "Keep the cover label visible",
    description: "The archived closure image must show the full index label.", context: "",
  });
  const proposal = {
    kind: "change" as const, title: "Move the index label to the cover",
    description: "Place the index on the reader-facing cover.", context: "The lid hides the current label.",
    currentState: "The index is on the inner edge.", primary: {},
  };
  const change = await record({
    ...proposal, unit, impacts: [{ section: "engineering", id: requirement.id }],
  });
  const base = "/engineering?item=unit%3ALK-016%40bench-a#";
  const open = async () => {
    const row = (await readEngineering(tx)).records.engineering.find(row => row.id === change.id);
    assert(row, "Saved change missing from Engineering");
    return row;
  };
  expect((await open()).impacts).toMatchObject([{ section: "engineering", id: requirement.id, target: { title: requirement.title, unit } }]);

  const edit = { ...proposal, title: "Keep the index on the removable card",
    description: "A removable card leaves the cover clear.", currentState: undefined, impacts: [] };
  const amend = (owner: typeof unit) => write({ ...edit, action: { type: "edit", parentId: change.id, unit: owner } });
  for (const other of [sibling, { ...unit, revisionId: "bench-b", revision: "Rev B" }]) {
    expect(await amend(other)).toMatchObject({ status: 409 });
  }
  expect((await open()).title).toBe(proposal.title);
  expect(await amend(unit)).toMatchObject({ record: { id: expect.any(String) } });

  const reopened = await open();
  expect(reopened).toMatchObject({ id: change.id, unit, title: edit.title, impacts: [], links: [] });
  expect(recordValues(reopened).description).toBe(edit.description);
  expect(recordValues(reopened).currentState ?? "").toBe("");
  const historyFor = async (selection: ItemSelection) => (await readTimeline(tx, [selection])).events
    .filter(event => event.links.some(link => link.href.endsWith("#" + change.id)));
  const events = await historyFor("unit:LK-016@bench-a");
  expect(events.map(({ title, note, links }) => [title, note, links.map(({ href, label, location, identity }) => ({ href, label, location, identity }))])).toEqual([
    ["Change proposed", proposal.description, [{ href: base + change.id, label: proposal.title, location: "Engineering · Changes", identity: proposal.title + " · LK-016 · Rev A" }]],
    ["Record edited", edit.description, [{ href: base + change.id, label: edit.title, location: "Engineering · Changes", identity: edit.title + " · LK-016 · Rev A" }]],
  ]);
  expect(await historyFor("unit:LK-014@bench-a")).toEqual([]);

  // An older client editing text alone omits affected records. It must retain the last explicit selection.
  const amendedTitle = "Use the removable card for the index";
  expect((await record({ kind: "change", title: amendedTitle,
    description: edit.description, context: edit.context, action: { type: "edit", parentId: change.id, unit } })).id).toBeDefined();
  const afterTextEdit = await open();
  expect(afterTextEdit).toMatchObject({ id: change.id, title: amendedTitle, impacts: [], links: [] });
  expect(recordValues(afterTextEdit).currentState ?? "").toBe("");
});
