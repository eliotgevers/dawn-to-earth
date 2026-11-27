import { fileBenchRun, saveReview } from "./verification/evidence";
import { saveInspectionFinding } from "./verification/acceptance";
import { readUnitWork } from "./records/assembly";
import { saveCatalog } from "./catalog";
import { assignImpact, completeImpact, saveEventFinding, saveRecord } from "./records/write";
import { fail, writeTransaction, type WorkspaceDatabase } from "./connection";
import { publishPlan, savePlanScenario } from "./planning";
import { recordPacketResponse, signPacket } from "./verification/release";

export async function writeWorkspace(db: WorkspaceDatabase, input: Record<string, unknown>) {
  if (input.operation === "import-bench-run" || input.operation === "file-station-capture") return fileBenchRun(db, input);
  if (input.operation === "assign-impact") return assignImpact(db, input);
  if (input.operation === "complete-impact") return completeImpact(db, input);

  return writeTransaction(db, async tx => {
    switch (input.operation) {
      case "catalog": return saveCatalog(tx, input.edit);
      case "record": return saveRecord(tx, input.record);
      case "event-finding": return saveEventFinding(tx, input);
      case "review": return saveReview(tx, input);
      case "save-plan": return savePlanScenario(tx, input);
      case "publish-plan": return publishPlan(tx, input, () => readUnitWork(tx, "planning"));
      case "save-finding": return saveInspectionFinding(tx, input);
      case "record-packet-response": return recordPacketResponse(tx, input);
      case "sign-packet": return signPacket(tx, input);
      default: return fail("Unknown workspace operation.", 400);
    }
  });
}
