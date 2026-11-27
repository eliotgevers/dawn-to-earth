"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { unitSelection } from "@/components/workspace/selection";
import type { AskProposal } from "@/ai/proposals";
import { confirmAskProposal } from "@/app/api/ask/actions";

export function AskConfirmation({ proposal }: { proposal: AskProposal }) {
  const router = useRouter();
  const [status, setStatus] = useState<"draft" | "saving" | "saved" | "discarded">("draft");
  const [error, setError] = useState("");
  const { draft } = proposal;
  const review = draft.change.kind === "review";

  async function confirm() {
    const url = new URL(window.location.href);
    const items = url.searchParams.getAll("item");
    if (url.pathname !== "/verification" || url.hash.slice(1) !== draft.target.recordId ||
        items.length !== 1 || items[0] !== unitSelection(draft.target.serial, draft.target.revisionId)) {
      setError("The selected evidence changed. Reopen the original record to confirm this draft.");
      return;
    }

    setStatus("saving");
    setError("");
    try {
      const result = await confirmAskProposal(proposal);
      if (result.error) { setError(result.error); setStatus("draft"); return; }
      setStatus("saved");
      router.refresh();
    } catch {
      setError("Couldn’t save this change. Try again.");
      setStatus("draft");
    }
  }

  if (status === "discarded") return <p role="status">Draft discarded.</p>;
  if (status === "saved") return <p role="status">{review ? "Source review filed." : "Note added."}</p>;

  return <section aria-label="Review proposed change" className="grid gap-2 text-sm">
    <div><strong>{draft.title}</strong><p className="text-xs text-muted-foreground">{draft.target.serial} · {draft.target.revisionId}</p></div>
    <div><span className="text-xs text-muted-foreground">{review ? "Source review · Reviewed" : "Evidence note"}</span><p>{draft.description}</p></div>
    <p className="text-xs text-muted-foreground">Everyone who opens this demo evidence can see this {review ? "review" : "note"}.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={status === "saving"} onClick={confirm}>{review ? "File review" : "Add note"}</Button>
      <Button size="sm" variant="ghost" disabled={status === "saving"} onClick={() => setStatus("discarded")}>Discard</Button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
