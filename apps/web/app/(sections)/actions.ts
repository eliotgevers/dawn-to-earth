"use server";

import { writeTransaction } from "@/db/connection";
import { saveOperationsStudy } from "@/db/operations/study";
import { recordToolDecision } from "@/db/operations/tools";
import type { ToolCommand, ToolId } from "@/db/workflows/cases";
import type { ItemSelection } from "@/components/workspace/selection";
import { isOperationsStudy, type StudyId } from "@/lib/archives/study";
import { isToolId } from "@/lib/workspace-routes";
import { refresh } from "next/cache";
import { writeForRequest } from "@/db/http";
import { writeWorkspace } from "@/db/workspace";
import { writeAcceptance } from "@/db/verification/acceptance";
import type { RecordEntry } from "@/lib/records/journal";

export async function saveWorkspaceAction(input: Record<string, unknown>, collection: "records" | "acceptance" = "records"): Promise<{
  error?: string; record?: RecordEntry; scenarioId?: string; id?: string; indexed?: boolean; saved?: boolean;
}> {
  const write = collection === "acceptance" ? writeAcceptance : writeWorkspace;

  const result = await writeForRequest(async db => write(db, input));

  if (!("status" in result && (result.status === 400 || result.status === 503))) refresh();

  return result;
}

export async function fileFinding(study: StudyId, selections: ItemSelection[], request: Parameters<typeof saveOperationsStudy>[2]) {
  if (!isOperationsStudy(study) || !Array.isArray(selections)) return { error: "Choose an archive and its Catalog scope." };

  const result = await writeForRequest(db => writeTransaction(db, tx => saveOperationsStudy(tx, study, request, selections)));

  if ("id" in result) refresh();

  return result;
}

export async function saveDecision(tool: ToolId, caseId: string | undefined, command: Omit<ToolCommand, "dossier">) {
  if (!isToolId(tool) || !caseId || !command || typeof command !== "object") return { error: "Choose a case before saving." };

  const result = await writeForRequest(db => recordToolDecision(db, tool, { ...command, caseId }));

  if (!("status" in result && result.status === 503)) refresh();

  return result;
}
