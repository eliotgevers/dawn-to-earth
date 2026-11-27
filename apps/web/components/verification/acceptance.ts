import { connectionToRecord, type LinkableRecord } from "@/components/records/schema";
import { sameUnit, type RecordUnit } from "@/lib/records/journal";
import type { ArchivedPair, evidence, decisions } from "@/db/schema";
import { recordConnection, recordHref, type RecordConnection } from "@/lib/records/links";

export const acceptanceArtifacts = {
  traveler: {
    help: "Copy the header as serial / revision. Leave it blank if it is missing.",
    missing: "The required traveler header is missing or incomplete.",
    mismatch: "The traveler identity does not match this build.",
    title: "Traveler identity",
    expectation: "Expected header",
    observation: "Observed header",
    link: "Traveler acceptance",
  },
  revision: {
    help: "Enter the revision shown on the source. Leave it blank if it is missing.",
    missing: "The required artifact is missing or incomplete.",
    mismatch: "The recorded revision does not match this build.",
    title: "Archive revision",
    expectation: "Required revision",
    observation: "Observed revision",
    link: "Archive revision acceptance",
  },
  image: {
    help: "Record the visible source identification.",
    missing: "The required artifact is missing or incomplete.",
    mismatch: "The source identification is missing in part of the selected interval.",
    title: "Image source identification",
    expectation: "Required in interval",
    observation: "Source identification",
    link: "Review image acceptance",
  },
  document: {
    help: "Record whether the receipt is filed in the archive.",
    missing: "The required artifact is missing or incomplete.",
    mismatch: "The required document has not been filed.",
    title: "Handoff receipt",
    expectation: "Required artifact",
    observation: "Receipt status",
    link: "Handoff receipt acceptance",
  },
} as const;

export type AcceptanceDecision = Omit<typeof decisions.$inferSelect, "recordedAt"> & {
  recordedAt: string;
  auditCaseId?: string;
};

export type AcceptanceCapture = Omit<typeof evidence.$inferSelect, "recordedAt"> & {
  recordedAt: string;
  review: AcceptanceDecision | null;
};

export type AcceptanceDefinition = {
  artifact?: keyof typeof acceptanceArtifacts;
  id: string;
  unit: RecordUnit;
  buildId: string;
  issueId?: string;
  requirementId: string;
  interfaceId?: string;
  changeId?: string;
  initial?: { mark: string; source: string; observation: string } | null;
  comparison?: {
    evidenceId: string;
    runId?: string;
    rerunId?: string;
    run: string;
    rerun: string;
    frames: readonly { original: boolean; repeat: boolean; originalImage?: string; repeatImage?: string }[];
  };
  owner: string;
  nextAction: string;
};

// Captures come from their own evidence table, never the persisted check definition.
export type AcceptanceCheck = AcceptanceDefinition & {captures?: readonly AcceptanceCapture[]};

export function sameArchiveEdition(check: AcceptanceCheck, snapshot?: ArchivedPair | null) {
  const source = check.comparison;
  return Boolean(source && snapshot && source.evidenceId === snapshot.evidenceId &&
    source.runId === snapshot.runId && source.rerunId === snapshot.rerunId &&
    check.requirementId === snapshot.requirementId);
}

export function inspectInterval(comparison: NonNullable<AcceptanceCheck["comparison"]>, start: unknown, end: unknown) {
  const { frames, run, rerun } = comparison;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) ||
    !Number.isInteger(end) || start < 1 || end < start || end > frames.length) return;
  const selected = frames.slice(start - 1, end);
  const original = selected.filter((frame) => frame.original).length;
  const repeat = selected.filter((frame) => frame.repeat).length;
  return {
    interval: { start, end }, count: selected.length, original, repeat,
    source: `${run} and ${rerun}, frames ${start}–${end}`,
    mark: repeat === selected.length ? "Visible throughout" : "Not visible throughout",
  };
}

// The evidence stores the cited ID. Its issued record owns the reference and distinguishes queued work from a build.
export function citedWork(targets: Record<string, LinkableRecord & {section: "engineering" | "production"}>,
  section: "engineering" | "production", id: string, unit: RecordUnit) {
  const target = targets[id];
  if (!target || target.section !== section) {
    return recordConnection(section, id, unit, { label: `Unavailable record · ${id}`, view: "" });
  }

  return connectionToRecord(section, { ...target, unit });
}

export function acceptanceHref(check: AcceptanceCheck, id = check.id) {
  return recordHref("verification", id, check.unit);
}

export function imageComparisonConnection(check: AcceptanceCheck) {
  const pair = check.comparison;
  if (!pair) return;
  const covers = [pair.run, pair.rerun].every(name => /\bcover\b/i.test(name));

  return {
    href: recordHref("verification", pair.evidenceId, check.unit, { compare: check.id }),
    label: covers ? "Cover scan comparison" : "Image comparison",
    location: "Verification · Investigation", identity: pair.run + " · " + pair.rerun,
  };
}

export function acceptanceReviewConnection(check: AcceptanceCheck) {
  const artifact = acceptanceArtifacts[check.artifact ?? "traveler"];
  return recordConnection("verification", check.id, check.unit, {
    label: artifact.link, view: "Acceptance Review", identity: check.unit.serial + " · " + check.unit.revision,
  });
}

export type AcceptanceAction = { label: string; href?: string; evidence?: AcceptanceCapture };

export function acceptanceActions(check: AcceptanceCheck, {accepted, reviewable, canApprove}: ReturnType<typeof acceptanceState>) {
  const captureLabel = accepted ? "Replace accepted evidence" : check.comparison ? "Compare image runs" : "Capture follow-up";
  const comparison = imageComparisonConnection(check);
  const comparisonLink = comparison && (accepted || (reviewable && canApprove)) ? [comparison] : [];
  const actions: AcceptanceAction[] = comparisonLink.length ? [] : [{label: captureLabel, href: comparison?.href}];
  if (reviewable) {
    const review = { label: "Review follow-up", evidence: reviewable };
    if (canApprove) actions.unshift(review);
    else actions.push(review);
  }
  return { actions, captureLabel, comparisonLink };
}

export function acceptanceTask(check: AcceptanceCheck, state: ReturnType<typeof acceptanceState>): RecordConnection | undefined {
  if (state.accepted) return;
  const [next] = acceptanceActions(check, state).actions;
  return next.href ? { href: next.href, label: next.label, location: "Verification · Investigation" }
    : { ...acceptanceReviewConnection(check), label: next.label };
}

export function findAcceptance(
  checks: readonly AcceptanceCheck[] | undefined,
  recordId: string,
  unit: RecordUnit | undefined,
  key: "buildId" | "issueId",
) {
  return checks?.find((check) => check[key] === recordId && sameUnit(check.unit, unit));
}

export function expectedTravelerHeader(unit: RecordUnit) {
  return `${unit.serial} / ${unit.revision}`;
}

function parseHeader(mark?: string) {
  const parts = mark?.split("/").map((part) => part.trim());
  return parts?.length === 2 && parts[0] && parts[1] ? parts.join(" / ") : undefined;
}

export function acceptanceEvidence(check: AcceptanceCheck, mark?: string) {
  switch (check.artifact) {
    case "image":
      return { expected: "Visible throughout", observed: mark || undefined };
    case "document":
      return { expected: "Filed", observed: mark === "Filed" ? mark : undefined };
    case "revision":
      return { expected: check.unit.revision, observed: mark?.trim() || undefined };
    default:
      return { expected: expectedTravelerHeader(check.unit), observed: parseHeader(mark) };
  }
}

type RecordedMark = Pick<AcceptanceCapture, "imported" | "mark" | "archive"> & {recordedAt: string | Date};

// The transaction and the read view use the same rule for ties, missing marks and superseded editions.
export function captureEligibility(check: AcceptanceCheck, current?: RecordedMark, previous?: RecordedMark) {
  const ambiguous = !!previous && !!current && previous.imported === current.imported &&
    +new Date(previous.recordedAt) === +new Date(current.recordedAt);
  const {expected, observed} = acceptanceEvidence(check, current ? current.mark : check.initial?.mark);
  const match = !ambiguous && observed === expected;
  const archiveChanged = !!(check.comparison && current && !sameArchiveEdition(check, current.archive));
  return {expected, observed, ambiguous, match, archiveChanged, canApprove: match && !archiveChanged};
}

// Each capture retains the decision signed against that evidence ID. Historical and
// imported captures can precede a replacement without becoming its sign-off.
export function acceptanceState(check: AcceptanceCheck) {
  const submissions = (check.captures ?? []).filter(capture => capture.checkId === check.id && sameUnit(capture, check.unit))
    .map(capture => {
      const review = capture.review;
      if (!review) return capture;
      const { observed, expected } = acceptanceEvidence(check, capture.mark);
      const valid = review.evidenceId === capture.id && Date.parse(review.recordedAt) >= Date.parse(capture.recordedAt)
        && (review.decision === "On hold" || observed === expected);
      return valid ? capture : { ...capture, review: null };
    })
    .sort((a, b) => Number(a.imported) - Number(b.imported) || Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || b.id.localeCompare(a.id));
  const [current, previous] = submissions;
  const { expected, observed, ambiguous, match, archiveChanged, canApprove } = captureEligibility(check, current, previous);
  const signed = current?.review ?? undefined;
  const review = current?.archive && archiveChanged ? undefined : signed;
  const accepted = match && review?.decision === "Approved";
  const stage = accepted ? "Verified" : review ? "Returned" : current && canApprove ? "Waiting for review" : "Waiting for evidence";
  const artifact = acceptanceArtifacts[check.artifact ?? "traveler"];
  const finding = ambiguous ? "Two follow-ups have the same recorded time."
    : archiveChanged ? "Capture the current run editions for this requirement." : !observed ? artifact.missing : !match ? artifact.mismatch : undefined;
  const blocker = accepted ? undefined : [finding, review?.reason].filter(Boolean).join(" ")
    || (current ? "The follow-up is waiting for QA review." : "A follow-up has not been captured.");
  const nextAction = stage === "Verified" ? "File the reviewed artifact."
    : stage === "Waiting for review" ? "QA · Review the current artifact." : "Technician · " + check.nextAction;
  return {
    artifact,
    submissions,
    current,
    reviewable: !ambiguous && !signed ? current : undefined,
    review,
    expected,
    accepted,
    match,
    canApprove,
    ambiguous,
    blocker,
    nextAction,
    stage,
  };
}
