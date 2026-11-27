import { parseSelections } from "@/components/workspace/selection";
import { PendingSection } from "@/components/workspace/section-tabs";
import { coreView } from "@/lib/workspace-routes";
import { Suspense } from "react";
import { readForRequest } from "@/db/http";
import { readVerificationWorkspace } from "@/db/verification/evidence";
import { VerificationData } from "@/lib/workspace";
import { Verification } from "@/components/verification/verification";

export const metadata = { title: "Verification" };

export default async function VerificationPage({ searchParams }: PageProps<"/verification">) {
  const params = await searchParams;
  const items = parseSelections(params.item);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;

  return <Suspense key={JSON.stringify([view, items])} fallback={
    <PendingSection section="verification" active={coreView("verification", view ?? null)} items={items} />
  }>
    <Records />
  </Suspense>;
}

async function Records() {
  const data = await readForRequest(readVerificationWorkspace);

  return data ? (
    <VerificationData value={data}><Verification localWorkspace={!process.env.VERCEL} /></VerificationData>
  ) : <p role="status">Database is unavailable</p>;
}
