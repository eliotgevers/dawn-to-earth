import assert from "node:assert/strict";
import { isToolId } from "../../lib/workspace-routes";
import { expect } from "bun:test";
import { recordToolDecision } from "../operations/tools";
import { databaseTest } from "./postgres.test-support";
import source from "../seed/records.json" with { type: "json" };

databaseTest("every tool verifies the case and recorder before applying a decision", async tx => {
  for (const [tool, cases] of Object.entries(source.toolCases)) {
    assert(isToolId(tool), `Unknown seeded workbench: ${tool}`);
    const command = { caseId: cases[0].id, action: "record", actor: "missing-person", data: {} };
    expect(await recordToolDecision(tx, tool, command)).toEqual({ error: "Unknown recorder.", status: 400 });
    const otherTool = tool === "audit" ? "inventory" : "audit";
    const wrongCase = { ...command, actor: "quality", caseId: source.toolCases[otherTool][0].id };
    expect(await recordToolDecision(tx, tool, wrongCase)).toMatchObject({ status: 404 });
  }
});
