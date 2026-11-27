"use server";

import { z } from "zod";
import { readUnitEdition } from "@/db/catalog";
import { db } from "@/db/connection";
import { recordRemovals } from "@/db/records/history";
import { prepareReview, readOriginalEvidence } from "@/db/verification/evidence";
import { appendDemoEvidence, type VisitorTarget } from "@/db/visitor";
import { sameUnit } from "@/lib/records/journal";
import type { VerificationTest } from "@/components/verification/model";
import { unitSelection } from "@/components/workspace/selection";

const field = z.string().trim().min(1).max(180);
const exact = z.strictObject({ recordId: field, serial: field, revisionId: field });
const note = z.strictObject({ id: z.uuid(), description: z.string().trim().min(1).max(1000) });
const observation = z.strictObject({
  target: exact, id: z.uuid(), test: z.enum(["leak","pressure","communication","vibration","thermal","ground-firing"]),
  decision: z.literal("Reviewed"), reason: z.string().trim().min(1).max(500), expectedReviewId: field.optional(),
});
const scopeError = "Choose existing demo evidence from this unit and revision.";

async function evidence(target: VisitorTarget) {
  if (!db) return { error: "Database is unavailable" };
  const [edition, originals, removed] = await Promise.all([
    readUnitEdition(db, target.serial, target.revisionId), readOriginalEvidence(db, [target.recordId]),
    recordRemovals(db, [target.recordId], target.serial, target.revisionId),
  ]);
  const source = originals.get(target.recordId);
  if (!source || !edition?.registered || edition.archived || !sameUnit(edition.unit, source.unit) || removed.length)
    return { error: scopeError };

  return { title: source.title, test: source.test };
}

export async function getDemoEvidence(input: unknown): Promise<{title?:string; test?:VerificationTest; error?:string}> {
  const parsed = exact.safeParse(input);
  if (!parsed.success) return { error: scopeError };
  try { return await evidence(parsed.data); }
  catch { return { error: "Couldn’t open this evidence. Try again." }; }
}

type Receipt = { error?: string; saved?: true; id?: string };

export async function addDemoNote(input: unknown, change: unknown): Promise<Receipt> {
  const target = exact.safeParse(input), parsed = note.safeParse(change);
  if (!target.success || !parsed.success) return { error: "Choose exact evidence and enter 1 to 1,000 characters." };

  try {
    return await appendDemoEvidence("note", parsed.data.id, parsed.data.description, async () => {
      const found = await evidence(target.data);
      return found.error ? { error: found.error } : { target: target.data };
    });
  } catch { return { error: "The shared note could not be confirmed. Reopen the evidence before retrying." }; }
}

export async function submitDemoReview(input: unknown): Promise<Receipt> {
  const parsed = observation.safeParse(input);
  if (!parsed.success) return { error: "Choose one evidence record and enter up to 500 characters." };
  const { target, id, reason, decision, test, expectedReviewId } = parsed.data;
  const reader = db;
  if (!reader) return { error: "Database is unavailable" };

  try {
    return await appendDemoEvidence("review", id, reason, async () => {
      const prepared = await prepareReview(reader, {
        review: { test, decision, reason, scope: { selection: unitSelection(target.serial), revision: target.revisionId } },
        targets: [{ id: target.recordId, expectedReviewId }],
      });
      if ("error" in prepared) return { error: prepared.error };
      const source = prepared.selected[0]?.record;
      if (source?.unit?.serial !== target.serial || source.unit.revisionId !== target.revisionId) return { error: scopeError };

      return { target: { ...target, recordId: source.id } };
    });
  } catch { return { error: "The shared review could not be confirmed. Reopen the evidence before retrying." }; }
}
