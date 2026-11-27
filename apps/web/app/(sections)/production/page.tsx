import { parseSelections } from "@/components/workspace/selection";
import { PendingSection } from "@/components/workspace/section-tabs";
import { coreView } from "@/lib/workspace-routes";
import { Suspense } from "react";
import { readForRequest } from "@/db/http";
import { readProduction } from "@/db/records/assembly";
import { AssemblyData } from "@/lib/workspace";
import { AssemblyRecordTabs } from "@/components/records/assembly-list";

export const metadata = { title: "Production" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const params = await searchParams;
  const items = parseSelections(params.item);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;

  return <Suspense key={JSON.stringify([view, items])} fallback={
    <PendingSection section="production" active={coreView("production", view ?? null)} items={items} />
  }>
    <Records view={view} />
  </Suspense>;
}

async function Records({ view }: { view?: string }) {
  const data = await readForRequest(db => readProduction(db, view));

  return data ? (
    <AssemblyData value={data}><AssemblyRecordTabs board="production" /></AssemblyData>
  ) : <p role="status">Database is unavailable</p>;
}
