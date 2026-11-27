import type { RecordedSeries } from "./numeric-series";
import type { ExchangeArchive } from "./document-exchanges";
import type { AcceptanceCheck } from "./acceptance";
import { type RecordIdentity, type RecordUnit } from "@/lib/records/journal";
import { combinedItemDetails, unitSelection, type ItemSelection, type SelectedItem } from "@/components/workspace/selection";
import type { Catalog } from "@/components/catalog/store";

const functional = ["Trace", "Inspection", "Functional check", "Record"];
const qualification = "qualification-acceptance";
export const methods = {
  leak: { label: "Leak", article: qualification, types: ["Trace", "Inspection", "Worksheet", "Record"] },
  pressure: { label: "Proof pressure", article: qualification, types: ["Trace", "Inspection", "Record"] },
  communication: { label: "Electronics", article: "spacecraft-interfaces", types: ["Message log", "Inspection", "Functional check", "Worksheet", "Review note", "Record"] },
  vibration: { label: "Vibration", article: qualification, types: functional },
  thermal: { label: "Thermal cycling", article: qualification, types: functional },
  "ground-firing": { label: "Ground firing", article: "satellite-propulsion", types: ["Archived report", "Archive note", "Record"] },
};
export type VerificationTest = keyof typeof methods;
export const methodIds = Object.keys(methods) as VerificationTest[];

export function isVerificationTest(value: unknown): value is VerificationTest {
  return typeof value === "string" && Object.hasOwn(methods, value);
}

export type FixtureExchange = {
  label: string;
  request: { message: string; atMs: number };
  expected: string;
  deadlineMs: number;
  reply?: { message: string; atMs: number };
};

export type TimedTracePoint = { elapsedSeconds: number; value: number };

type ProofPressureFixture = {
  points: TimedTracePoint[];
  target: number;
  inspection: { result: string; notes: string };
};

type PostTestChecks = { inspection: string; functionalResult: string };

export type EvidenceRecord = RecordIdentity & {
  reference?: string;
  authored?: true;
  importedRun?: true;
  sourceSheet?: string;
  exchangeArchive?: ExchangeArchive;
  numericSeries?: RecordedSeries[];
  type: string;
  observation?: string;
  source?: string;
  supports?: string;
  followUp?: string;
  relatedEvidenceIds?: readonly string[];
  recordedAt?: string;
  content?: "capture" | "bracket" | "validation-study";
  capture?: {
    reviewId: string;
    priorReviewIds?: readonly string[];
    replaces?: string;
    handoffId?: string;
    readOnly?: boolean;
  };
};

export type CatalogEvidence = EvidenceRecord & {
  unit: RecordUnit;
  test: VerificationTest;
  requirement: { id: string; title: string };
  build: { id: string; title: string };
  review?: { id: string; decision: "Reviewed" | "Follow-up needed"; reason: string; recordedAt: string };
};

export type VerificationRecords = {
  acceptanceChecks?: readonly AcceptanceCheck[];
  catalogEvidence?: readonly CatalogEvidence[];
  article: RecordUnit & { title: string; status?: string };
  bracketFollowUp: { method: string; observation: string };
  context: Record<VerificationTest, { interface: string; requirement: string; question: string }>;
  records: Record<VerificationTest, readonly EvidenceRecord[]>;
  communicationExchanges: readonly FixtureExchange[];
  leakFixture: { pressure: number[]; temperature: number[]; adjustedEstimate: number; fictionalLimit: number };
  proofPressureFixture: ProofPressureFixture;
  proofPressureRetestFixture: ProofPressureFixture;
  vibrationFixture: PostTestChecks & { reference: number[]; observed: number[] };
  thermalFixture: PostTestChecks & { cycle: number[] };
  groundFiringFixture: {
    trace: number[];
    annotation: string;
    review: { id: string; evidenceId: string; decision: "Reviewed"; reason: string; recordedAt: string };
  };
};

export type ReviewDecision = "Approved" | "On hold" | "Pass" | "Fail" | "Not applicable" |
  "Evidence incomplete" | "Retest requested" | "Returned for follow-up" | "Follow-up submitted" | "Reviewed" | "Follow-up needed";

export type ReviewScope = { selection: ItemSelection; revision?: string };

export function isAggregateReview(scope?: ReviewScope) {
  return Boolean(scope && !scope.selection.startsWith("unit:"));
}

export type EvidenceReview = {
  auditCaseId?: string;
  id: string;
  evidenceIds: readonly string[];
  scope?: ReviewScope;
  test?: VerificationTest;
  decision: ReviewDecision;
  focus?: string;
  reason: string;
  reviewer?: string;
  recordedAt: string;
};

export type ReviewTarget = {
  id: string;
  record: EvidenceRecord;
  mode: "capture" | "supporting" | "read-only";
  latest?: EvidenceReview;
};

function choice(value: ReviewDecision, label: string = value) {
  return { value, label };
}
const reviewed = choice("Reviewed");

export function targetOptions(test: VerificationTest, { mode, record: { capture }, latest }: ReviewTarget): ReadonlyArray<ReturnType<typeof choice>> {
  if (mode === "read-only") return [reviewed];
  const stage = reviewStep(latest);
  if (stage === "quality") {
    return [reviewed, choice("Returned for follow-up", capture?.handoffId ? "Request retest" : "Return for follow-up")];
  }
  if (stage === "technician") {
    return [reviewed, choice("Follow-up submitted", capture?.replaces ? "Submit retest evidence" : "Submit follow-up")];
  }
  return [
    reviewed,
    ...(mode === "supporting" || test === "communication" ? [choice("Approved", "Approve evidence"), choice("On hold", "Place on hold")]
      : [choice("Pass"), choice("Fail"), choice("Not applicable")]),
    choice("Evidence incomplete"),
    ...(capture?.handoffId ? [choice("Retest requested", "Request retest")] : []),
  ];
}

export function reviewOptions(test: VerificationTest, targets: readonly ReviewTarget[], scope?: ReviewScope) {
  if (!targets.length || isAggregateReview(scope)) return [
    reviewed,
    choice("Follow-up needed"),
    choice("Not applicable"),
  ];

  const [first, ...others] = targets.map((target) => targetOptions(test, target));
  return first.filter((choice) => others.every((options) =>
    options.some(({ value, label }) => value === choice.value && label === choice.label),
  ));
}

export function affectsEvidence(review: EvidenceReview) {
  return !isAggregateReview(review.scope) && review.decision !== "Reviewed" && review.decision !== "Follow-up needed";
}

export function reviewApplies(review: EvidenceReview, unit?: Pick<RecordUnit, "serial" | "revisionId">) {
  if (!review.scope) return true;
  return Boolean(unit && review.scope.selection === unitSelection(unit.serial) && review.scope.revision === unit.revisionId);
}

type EvidenceRegister = Pick<VerificationRecords, "records" | "catalogEvidence">;

export function methodSources(data: EvidenceRegister, test: VerificationTest) {
  return [...data.records[test], ...(data.catalogEvidence ?? []).filter(record => record.test === test)];
}

export function evidenceReferences({ id, capture }: Pick<EvidenceRecord, "id" | "capture">) {
  return capture ? [id, capture.reviewId, ...(capture.priorReviewIds ?? [])] : [id];
}

export function reviewRecord(data: EvidenceRegister, id: string) {
  const matches = (record: EvidenceRecord) => record.id === id || record.capture?.reviewId === id || record.capture?.handoffId === id;
  const earlier = (record: EvidenceRecord) => record.capture?.priorReviewIds?.includes(id);
  const catalogRecord = data.catalogEvidence?.find(matches);
  if (catalogRecord) return { test: catalogRecord.test, record: catalogRecord };
  for (const test of methodIds) {
    const records = data.records[test];
    const record = records.find(matches);
    if (record) return { test, record };
    if (records.some(earlier)) return { test };
  }
  const prior = data.catalogEvidence?.find(earlier);
  if (prior) return { test: prior.test };
}

export function reviewEvidenceLinks(
  data: Pick<VerificationRecords, "records" | "catalogEvidence">, { evidenceIds }: EvidenceReview, notes: readonly (RecordIdentity & Partial<EvidenceRecord>)[] = [],
) {
  return evidenceIds.flatMap((id) => {
    const record = reviewRecord(data, id)?.record ?? notes.find(note => note.id === id);
    return record ? [record] : [];
  });
}

export function reviewTest(data: Parameters<typeof reviewRecord>[0], review: EvidenceReview) {
  return review.test ?? (review.evidenceIds.length ? reviewRecord(data, review.evidenceIds[0])?.test : undefined);
}

export const reviewRoles = { quality: "Quality lead", technician: "Technician", reviewer: "Reviewer" };
export type ReviewRole = keyof typeof reviewRoles;

export function reviewStep(review?: EvidenceReview): ReviewRole {
  switch (review?.decision) {
    case "Evidence incomplete":
    case "Fail":
    case "On hold":
      return "quality";
    case "Returned for follow-up":
    case "Retest requested":
      return "technician";
    default:
      return "reviewer";
  }
}

export function reviewActor(decision: string): ReviewRole {
  if (decision === "Returned for follow-up") return "quality";
  if (decision === "Follow-up submitted") return "technician";
  return "reviewer";
}

export function isRetestDecision(decision: ReviewDecision) {
  return decision === "Retest requested" || decision === "Returned for follow-up";
}

export type ReviewScopeOption = { selection: ItemSelection; scope: ReviewScope; label: string; item: SelectedItem };

export function reviewScopeOptions(catalog: Catalog | undefined, selections: readonly ItemSelection[]): ReviewScopeOption[] {
  return selections.flatMap((selection) => {
    const item = combinedItemDetails(catalog, [selection]);
    if (!item?.label) return [];
    const revision = selection.startsWith("unit:") ? item.members[0]?.revisionId
      : selection.startsWith("revision:") ? item.revisions[0]?.id : undefined;
    return [{ selection, scope: { selection: item.unit ? unitSelection(item.unit.serial) : selection, revision }, label: item.label, item }];
  });
}

export function sameReviewScope(first: ReviewScope, second: ReviewScope) {
  return first.selection === second.selection && first.revision === second.revision;
}
