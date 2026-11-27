import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDemoEvidence } from "@/app/(sections)/verification/actions";
import { db } from "@/db/connection";
import { readReviewCandidates } from "@/db/verification/evidence";
import { isVerificationTest, targetOptions } from "@/components/verification/model";
import { visitorBinding } from "@/db/visitor-session";

const text = z.string().trim().min(1).max(1000);
const key = z.string().regex(/^[\w.-]{1,160}$/);
const target = z.strictObject({ recordId: key, serial: key, revisionId: key });
const change = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("add-note") }),
  z.strictObject({ kind: z.literal("review"), test: z.string().refine(isVerificationTest), reviewTargetId: key, expectedReviewId: key.optional() }),
]);
const draftSchema = z.strictObject({
  target, title: z.string().min(1).max(1000), id: z.uuid(),
  description: text, change, expires: z.number().int().positive(),
});
const signedSchema = z.strictObject({ draft: draftSchema, signature: z.string().regex(/^[0-9a-f]{64}$/) });
export type AskProposal = z.infer<typeof signedSchema>;
export type ProposalRequest = { message: string } | {
  literal?: string; propose: (description: string) => AskProposal; example: string; maxLength: number;
};

function signature(draft: AskProposal["draft"], binding: string) {
  return createHmac("sha256", binding).update("ask-shared-proposal-v1\n" + JSON.stringify(draft)).digest();
}

export function verifiedDraft(input: unknown, binding?: string) {
  const parsed = signedSchema.safeParse(input);
  if (!binding || !parsed.success) return;
  const { draft, signature: supplied } = parsed.data;
  if (draft.expires < Date.now() || !timingSafeEqual(signature(draft, binding), Buffer.from(supplied, "hex"))) return;

  return draft;
}

// Only the latest user request may offer a change. The model receives no write or confirmation tool.
export async function prepareProposal(question: string, scope: readonly string[], recordId?: string): Promise<ProposalRequest | undefined> {
  const input = question.trim();
  const review = /^(?:please\s+)?mark\s+(?:(?:this|the)\s+)?(?:source|evidence)\s+(?:as\s+)?reviewed\b/i.exec(input);
  const note = /^(?:please\s+)?(?:add|draft|write|save|leave)\s+(?:(?:a|an|the|new|shared)\s+)*note\b/i.exec(input);
  if (!note && !review) return;

  const unit = scope.length === 1 && /^unit:([\w.-]+)@([\w.-]+)$/.exec(scope[0]);
  if (!unit || !recordId || !key.safeParse(recordId).success)
    return { message: "Open a Verification evidence record with its exact unit and revision selected, then ask again." };
  const target = { recordId, serial: unit[1], revisionId: unit[2] };
  const result = await getDemoEvidence(target);
  if (!("title" in result) || !result.title) return { message: "This evidence record is unavailable." };

  let action: z.infer<typeof change> = { kind: "add-note" };
  const id = randomUUID();
  let example = "Add a note: your text";
  if (review) {
    if (!isVerificationTest(result.test)) return { message: "The verification method for this evidence is unavailable." };
    if (!db) return { message: "The evidence review is unavailable." };
    const candidates = await readReviewCandidates(db, result.test, [recordId]);
    const source = candidates.find(row => row.record.id === recordId && row.record.unit?.serial === target.serial &&
      row.record.unit.revisionId === target.revisionId && !row.archived);
    if (!source || !targetOptions(result.test, source).some(choice => choice.value === "Reviewed"))
      return { message: "This source is unavailable for a review." };
    action = { kind: "review", test: result.test, reviewTargetId: source.id, expectedReviewId: source.latest?.id };
    example = "Mark source reviewed: your reason";
  }

  const title = result.title;
  const binding = await visitorBinding(true);
  if (!binding) return { message: "Changes are unavailable in this session." };
  const remainder = input.slice((review ?? note)![0].length).trimStart();

  const maxLength = review ? 500 : 1000;
  if (remainder.startsWith(":") && remainder.slice(1).trim().length > maxLength)
    return { message: "Use up to " + maxLength + " characters for this draft." };

  return {
    example, maxLength, literal: remainder.startsWith(":") ? remainder.slice(1).trim() : undefined,
    propose(description) {
      const draft = draftSchema.parse({ target, title, id, description, change: action, expires: Date.now() + 10 * 60_000 });
      return { draft, signature: signature(draft, binding).toString("hex") };
    },
  };
}
