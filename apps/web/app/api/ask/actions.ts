"use server";

import { verifiedDraft } from "@/ai/proposals";
import { submitDemoReview, addDemoNote } from "@/app/(sections)/verification/actions";
import { visitorBinding } from "@/db/visitor-session";

export async function confirmAskProposal(proposal: unknown): Promise<{ error?: string }> {
  const draft = verifiedDraft(proposal, await visitorBinding());
  if (!draft) return { error: "This draft expired or belongs to a different session. Ask for a new draft." };

  const { target, id, description, change } = draft;
  if (change.kind === "review") {
    const result = await submitDemoReview({
      target: { ...target, recordId: change.reviewTargetId }, id, test: change.test, decision: "Reviewed",
      reason: description, expectedReviewId: change.expectedReviewId,
    });
    return "saved" in result ? {} : { error: result.error };
  }
  const result = await addDemoNote(target, { id, description });
  return "saved" in result ? {} : { error: result.error };
}
