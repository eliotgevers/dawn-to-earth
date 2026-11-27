import { unitSelection } from "@/components/workspace/selection";

export type ValidationCondition = { id: string; label: string; requiredOrigins: number };
export type ValidationRow = {
  id: string;
  conditionId: string;
  runId: string;
  originId: string | null;
  copiedFrom: string | null;
  role: "fit" | "holdout";
  source: string;
  predicted: number;
  observed: number;
};
export type StudyArchive = {
  title: string;
  quantity: string;
  unit: string;
  source: string;
  evidenceIds: string[];
  conditions: ValidationCondition[];
  rows: ValidationRow[];
};
export const validationDecisions = {
  supported: "Supported for this condition",
  bias: "Investigate model bias",
  insufficient: "Insufficient independent evidence",
} as const;
export type ValidationDecision = keyof typeof validationDecisions;
export type ValidationData = Awaited<ReturnType<typeof import("@/db/engineering/validation").readValidation>>;
export type ValidationStudy = ValidationData[number];
export type ValidationJudgment = ValidationStudy["judgments"][number];

export function modelStudyHref(study: ValidationStudy, judgment?: string, params?: Readonly<URLSearchParams>) {
  const query = new URLSearchParams(params);
  const serial = unitSelection(study.serial);
  const exact = unitSelection(study.serial, study.revisionId);
  const items = new Set(query.getAll("item").map((item) => (item === serial ? exact : item)));
  items.add(exact);
  query.delete("item");
  for (const item of items) query.append("item", item);
  query.set("modelStudy", study.id);
  if (judgment) query.set("validation", judgment);

  return `/engineering?${query}#${encodeURIComponent(study.recordId)}`;
}

// Older receipts stored a digest alone. It must still identify this exact source to reopen them.
export function judgmentMatchesStudy(study: ValidationStudy, {basis, studyId}: ValidationJudgment) {
  if (study.id !== studyId) return false;
  const edition = basis.edition;

  return edition ? edition.serial === study.serial && edition.revisionId === study.revisionId &&
    edition.recordId === study.recordId && edition.modelEditionId === study.modelEditionId : basis.sourceDigest === study.sourceDigest;
}

// A run identifies one archived reading. Re-exports may share that reading, but cannot change its measured facts.
function agrees(a: ValidationRow, b: ValidationRow) {
  return (
    a.originId === b.originId &&
    a.conditionId === b.conditionId &&
    a.predicted === b.predicted &&
    a.observed === b.observed
  );
}

// Evaluate provenance across the complete edition before a reviewer filters the view.
export function assessReadings(rows: readonly ValidationRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const runSources = new Map<string, ValidationRow>();
  const conflictingRuns = new Set<string>();
  const originals = new Map<string, number>();
  for (const row of rows) {
    const run = runSources.get(row.runId);
    if (run && !agrees(row, run)) conflictingRuns.add(row.runId);
    else if (!run) runSources.set(row.runId, row);
    const original = row.copiedFrom && byId.get(row.copiedFrom);
    if (original && !agrees(row, original)) {
      conflictingRuns.add(row.runId);
      conflictingRuns.add(original.runId);
    }
    if (row.originId && !row.copiedFrom) originals.set(row.originId, (originals.get(row.originId) ?? 0) + 1);
  }

  const fit = new Set(rows.filter((r) => r.role === "fit"));
  // Follow archive lineage both ways. Relabeling a fit-run export cannot create an independent reading.
  for (const row of fit) {
    for (const other of rows) {
      if (
        (row.originId && row.originId === other.originId) ||
        other.runId === row.runId ||
        row.copiedFrom === other.id ||
        other.copiedFrom === row.id
      )
        fit.add(other);
    }
  }

  const basisFor = (row: ValidationRow) => {
    if (row.role === "fit") return "Model fit";
    if (conflictingRuns.has(row.runId)) return "Conflicting source";
    if (fit.has(row)) return "Used for model fit";
    if (!row.originId || !row.runId) return "Origin unknown";
    if (row.copiedFrom) return "Copied reading";
    if (originals.get(row.originId) !== 1) return "Repeated origin";

    return "Independent";
  };

  return { basisFor, independent: rows.filter(row => basisFor(row) === "Independent") };
}

export function judgmentIssue(
  condition: ValidationCondition,
  independent: readonly ValidationRow[],
  rowIds: readonly string[],
  decision: ValidationDecision,
) {
  const eligible = independent.filter(row => row.conditionId === condition.id);
  const ids = new Set(rowIds);
  const selected = eligible.filter(row => ids.has(row.id));
  if (selected.length !== rowIds.length || ids.size !== rowIds.length)
    return "Select distinct independent observations from this condition.";
  if (!selected.length && (eligible.length || decision !== "insufficient"))
    return "Choose the independent observations supporting this judgment.";
  if (decision === "supported" && selected.length < condition.requiredOrigins)
    return `This condition requires ${condition.requiredOrigins} independent observations for a supported judgment.`;
}

export const residual = (row: ValidationRow) => row.observed - row.predicted;

export function residualSummary(rows: readonly ValidationRow[]) {
  let sum = 0, absoluteSum = 0;
  for (const row of rows) {
    const delta = residual(row);
    sum += delta;
    absoluteSum += Math.abs(delta);
  }

  const count = rows.length;

  return { count, mean: count ? sum / count : null, absoluteMean: count ? absoluteSum / count : null };
}

const numeric = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const signedNumeric = new Intl.NumberFormat("en", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
export function numberLabel(value: number | null, signed = false) {
  return value === null ? "Unavailable" : (signed ? signedNumeric : numeric).format(value);
}
