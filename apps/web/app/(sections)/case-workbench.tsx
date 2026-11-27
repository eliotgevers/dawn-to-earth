import { Suspense, type ComponentType } from "react";
import { PendingSection } from "@/components/workspace/section-tabs";
import { tools, toolTab } from "@/lib/workspace-routes";
import { parseSelections } from "@/components/workspace/selection";
import { Workbench, type ToolProps } from "@/components/workspace/workbench";
import { readForRequest } from "@/db/http";
import { readToolContext } from "@/db/operations/tools";
import type { ToolId } from "@/db/workflows/cases";
import { saveDecision } from "./actions";

export type CasePageProps = { searchParams: Promise<{ case?: string | string[]; item?: string | string[] }> };

export async function renderWorkbench(tool: ToolId, View: ComponentType<ToolProps>, { searchParams }: CasePageProps) {
  const { case: requested, item } = await searchParams;
  const caseId = Array.isArray(requested) ? requested[0] : requested;
  const items = parseSelections(item);

  return <Suspense key={JSON.stringify([tool, caseId, items])} fallback={
    <PendingSection section={tools[tool].section} active={toolTab(tool).id} subview={tool} items={items} />
  }>
    <CaseRecords tool={tool} View={View} caseId={caseId} />
  </Suspense>;
}

async function CaseRecords({ tool, View, caseId }: { tool: ToolId; View: ComponentType<ToolProps>; caseId?: string }) {
  const state = await readForRequest(db => readToolContext(db, tool, caseId || undefined));

  if (!state) return <p role="status">Database is unavailable</p>;

  return <Workbench tool={tool} View={View} state={state} caseId={caseId} save={saveDecision.bind(null, tool, caseId)} />;
}
