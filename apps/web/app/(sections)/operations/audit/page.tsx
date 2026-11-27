import { Suspense } from "react";
import { saveDecision } from "@/app/(sections)/actions";
import AuditReplay from "@/components/operations/audit";
import { OperationsScopePicker, PendingSection } from "@/components/workspace/section-tabs";
import { combinedItemDetails, includesUnit, parseSelections } from "@/components/workspace/selection";
import { Workbench } from "@/components/workspace/workbench";
import { loadCatalog } from "@/db/catalog";
import { readForRequest } from "@/db/http";
import { readToolContext } from "@/db/operations/tools";
import { tools } from "@/lib/workspace-routes";

export const metadata = { title: tools.audit.name };

export default async function AuditPage({ searchParams }: PageProps<"/operations/audit">) {
  const { item, case: id } = await searchParams;
  const selections = parseSelections(item);
  return <Suspense key={JSON.stringify([item, id])} fallback={<PendingSection section="operations" active="audit" items={selections} />}>
    <Records selections={selections} id={id} />
  </Suspense>;
}

async function Records({ selections, id }: { selections: ReturnType<typeof parseSelections>; id?: string | string[] }) {
  if (!selections.length) {
    const catalog = await readForRequest(db => loadCatalog(db));
    return catalog ? <OperationsScopePicker active="audit" catalog={catalog} />
      : <p role="status">Database is unavailable</p>;
  }

  const caseId = (Array.isArray(id) ? id[0] : id) || undefined;
  const state = await readForRequest(db => readToolContext(db, "audit", caseId));
  if (!state) return <p role="status">Database is unavailable</p>;
  const { catalog } = state.workspace;
  if (caseId && !includesUnit(combinedItemDetails(catalog, selections), state.dossier?.unit)) {
    return <><h1>Operations</h1><OperationsScopePicker active="audit" catalog={catalog} selections={selections}>
      <p role="status">Unavailable</p>
    </OperationsScopePicker></>;
  }
  return <Workbench tool="audit" View={AuditReplay} state={state} caseId={caseId} save={saveDecision.bind(null, "audit", caseId)} />;
}
