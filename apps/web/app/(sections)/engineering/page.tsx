import { PendingSection } from "@/components/workspace/section-tabs";
import { coreView } from "@/lib/workspace-routes";
import { Suspense } from "react";
import { fileFinding } from "../actions";
import { readEngineering } from "@/db/records/assembly";
import { readForRequest } from "@/db/http";
import { readOperationsStudy } from "@/db/operations/study";
import { StudyWorkspace } from "@/components/operations/study";
import { AssemblyData } from "@/lib/workspace";
import { parseSelections } from "@/components/workspace/selection";
import { AssemblyRecordTabs } from "@/components/records/assembly-list";

export const metadata = { title: "Engineering" };
type Query = Awaited<PageProps<"/engineering">["searchParams"]>;

export default async function EngineeringPage({ searchParams }: PageProps<"/engineering">) {
  const params = await searchParams;
  const items = parseSelections(params.item);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;

  return <Suspense key={JSON.stringify([view, items])} fallback={
    <PendingSection section="engineering" active={coreView("engineering", view ?? null)} items={items} />
  }>
    <Records params={params} selections={items} />
  </Suspense>;
}

async function Records({ params, selections }: { params: Query; selections: ReturnType<typeof parseSelections> }) {
  const [data, history] = await Promise.all([
    readForRequest(readEngineering),
    params.compare ? readForRequest(reader => readOperationsStudy(reader, "docking", Array.isArray(params.finding) ? params.finding[0] : params.finding, selections)) : null,
  ]);
  if (!data) return <p role="status">Database is unavailable</p>;

  return <AssemblyData value={data}>
    <AssemblyRecordTabs board="engineering" interfaceStudy={params.compare ? {
      subject: history?.selected?.subject,
      unavailable: !history || history.unavailable,
      content: history ? <StudyWorkspace study="docking" history={history} record={fileFinding.bind(null, "docking", selections)} />
        : <p role="status">The saved interface archive is unavailable.</p>,
    } : undefined} />
  </AssemblyData>;
}
