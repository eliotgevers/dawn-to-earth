import { Suspense } from "react";
import { readForRequest } from "@/db/http";
import { readReadinessWorkspace } from "@/db/verification/release";
import { loadCatalog } from "@/db/catalog";
import { parseSelections } from "@/components/workspace/selection";
import { ReleaseReadiness } from "@/components/operations/readiness";
import { OperationsScopePicker, PendingSection } from "@/components/workspace/section-tabs";

export const metadata = { title: "Operations" };

export default async function OperationsPage({ searchParams }: PageProps<"/operations">) {
  const { item } = await searchParams;
  const items = parseSelections(item);

  return <Suspense key={JSON.stringify(items)} fallback={<PendingSection section="operations" active="readiness" items={items} />}>
    <Records scoped={items.length > 0} />
  </Suspense>;
}

async function Records({ scoped }: { scoped: boolean }) {
  const content = scoped
    ? await readForRequest(async db => <ReleaseReadiness workspace={await readReadinessWorkspace(db)} />)
    : await readForRequest(async db => <OperationsScopePicker active="readiness" catalog={await loadCatalog(db)} />);

  return content ?? <p role="status">Database is unavailable</p>;
}
