import { sameUnit, type RecordUnit, isRemovedRecord, type RecordEntry } from "@/lib/records/journal";
import { methodIds, methods, methodSources, evidenceReferences, affectsEvidence, isAggregateReview, isRetestDecision, reviewApplies, type ReviewTarget, type CatalogEvidence, type EvidenceRecord, type EvidenceReview, type VerificationRecords, type VerificationTest, reviewActor, reviewRoles, reviewEvidenceLinks, reviewRecord, reviewTest, sameReviewScope, type ReviewScopeOption } from "@/components/verification/model";
import { showsApplicability } from "@/components/records/schema";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";

type EvidenceRow = ReviewTarget & {
  record: EvidenceRecord | CatalogEvidence;
  status?: EvidenceReview["decision"];
  recordedAt?: string;
  retest?: "requested" | "replaced";
  archived: boolean;
  storedReview?: EvidenceReview;
  // Before a retest is requested, its historical link opens the original capture.
  opens?: string;
};

export function evidenceSearchText({ record, status }: EvidenceRow) {
  return [record.title, record.type, record.observation, record.source, record.unit?.serial, status].join(" ");
}

// Read a decision against its exact source edition. An older, unscoped entry belongs only to the original article.
export function evidenceDecisions(reviews: readonly EvidenceReview[], article?: RecordUnit,
  archive?: VerificationRecords["groundFiringFixture"]["review"]) {
  const byTarget = new Map<string, EvidenceReview[]>();
  for (const review of reviews) {
    for (const id of review.evidenceIds) {
      const list = byTarget.get(id);
      if (list) list.push(review);
      else byTarget.set(id, [review]);
    }
  }
  return (record: Pick<EvidenceRecord, "id" | "unit" | "capture"> & { review?: CatalogEvidence["review"] }, test?: VerificationTest) => {
    const { capture, unit } = record;
    const id = capture?.reviewId ?? record.id;
    const legacy = sameUnit(article, unit);
    const applicable = (byTarget.get(id) ?? []).filter(review =>
      (!review.test || review.test === test) && (review.scope || legacy) && reviewApplies(review, unit));
    const outcome = applicable.findLast(affectsEvidence);
    const stored = record.review ?? (legacy && capture?.readOnly && id === archive?.evidenceId ? archive : undefined);
    const storedReview = stored && { ...stored, test, evidenceIds: [record.review ? record.id : id] };
    // A read acknowledgment does not resolve a recorded request for follow-up.
    const followUp = applicable.findLast(review => review.decision === "Follow-up needed")
      ?? (stored?.decision === "Follow-up needed" ? storedReview : undefined);
    const conclusion = outcome ?? followUp ?? applicable.at(-1) ?? storedReview;
    return { id, latest: capture?.readOnly ? undefined : outcome, storedReview, conclusion };
  };
}

export function methodEvidence(data: VerificationRecords, test: VerificationTest, reviews: readonly EvidenceReview[], activity: readonly RecordEntry[], exact?: string,
  decision = evidenceDecisions(reviews, data.article, data.groundFiringFixture?.review)) {
  const rows = methodSources(data, test).map((record): EvidenceRow => {
    const { capture } = record;
    const { id, latest, storedReview, conclusion } = decision(record, test);
    const retest = capture?.handoffId && latest && isRetestDecision(latest.decision) ? "requested" : undefined;
    const mode = test === "ground-firing" || capture?.readOnly || retest ? "read-only" : capture ? "capture" : "supporting";
    return { record, id, latest, mode, retest, storedReview, status: conclusion?.decision, recordedAt: conclusion?.recordedAt ?? record.recordedAt,
      archived: isRemovedRecord(record.id, activity, record.unit ?? data.article), opens: record.id };
  });
  const originals = new Map(rows.filter(row => row.record.capture?.handoffId && !row.record.capture.readOnly)
    .map(row => [row.record.id, row]));
  for (const row of rows) {
    const replaces = row.record.capture?.replaces;
    if (!replaces) continue;
    const original = originals.get(replaces);
    if (!original || !sameUnit(original.record.unit, row.record.unit) || row.record.capture?.readOnly) {
      row.opens = undefined;
      continue;
    }
    if (row.latest) {
      original.retest = "replaced";
      original.mode = "read-only";
    } else row.latest = original.latest;
  }
  for (const row of rows) {
    const replaces = row.record.capture?.replaces;
    if (replaces && row.opens && !originals.get(replaces)?.retest) row.opens = replaces;
  }
  return rows.filter(row => row.record.id === exact || (!row.archived && row.opens === row.record.id));
}

// Acceptance, a recorded decision and a retest chain each depend on the original evidence remaining active.
export function evidenceRetentionReason(
  record: Pick<EvidenceRecord, "id" | "capture" | "content" | "importedRun"> & Pick<Partial<CatalogEvidence>, "review">,
  reviews: readonly EvidenceReview[],
  acceptanceSource: boolean,
  hasEventFinding = false,
  citedByBenchRun = false,
) {
  if (record.importedRun) return "The recorded run retains its filed source and sample values.";
  if (citedByBenchRun) return "A filed bench run cites this evidence.";
  if (record.content === "validation-study") return "The archived observations are retained as the source for model validation.";
  if (hasEventFinding) return "A recorded exchange finding cites this source and its event history.";
  if (acceptanceSource) return "This record supplies the archived comparison for a unit acceptance check.";
  const ids = new Set(evidenceReferences(record));
  if (record.review || reviews.some((review) => review.evidenceIds.some((id) => ids.has(id))))
    return "A recorded review relies on this evidence. Its source and decision must stay together.";
  if (record.capture?.replaces || record.capture?.handoffId)
    return "This capture belongs to a retest handoff. Both the original and its follow-up must stay available.";
  if (record.capture?.readOnly) return "This capture is part of a retained, read-only report.";
}

// A superseded capture remains readable. Only current evidence contributes a conclusion or unit coverage.
export function methodStatus(item: Pick<SelectedItem, "members">, outcomes: readonly EvidenceRow[]) {
  const current = outcomes.filter(({ retest }) => retest !== "replaced");
  const decisions = new Set(current.flatMap(({ status }) => status ? [status] : []));
  if (!current.length) return { status: "Unavailable", tone: "gray", rank: 4 };
  if (decisions.size > 1) return { status: "Mixed", tone: "amber", rank: 0 };
  if (item.members.some((member) => !current.some(({ record }) => sameUnit(member, record.unit))))
    return { status: "Partial coverage", tone: "amber", rank: 2 };

  const [decision] = decisions;
  switch (decision) {
    case "Retest requested":
    case "Returned for follow-up":
    case "Follow-up needed":
    case "On hold":
    case "Evidence incomplete":
    case "Fail":
      return { status: decision, tone: "amber", rank: 0 };
    case "Follow-up submitted":
      return { status: "Needs review", tone: "gray", rank: 1 };
    default:
      if (!decision || current.some(({ status }) => !status)) return { status: "Needs review", tone: "gray", rank: 2 };
      return { status: decision, tone: decision === "Not applicable" ? "gray" : "green", rank: 3 };
  }
}

export function verificationOverviewRows(item: SelectedItem, data: VerificationRecords, reviews: readonly EvidenceReview[],
  evidenceHistory: readonly RecordEntry[], scopes: readonly ReviewScopeOption[]) {
  const decisions = evidenceDecisions(reviews, data.article, data.groundFiringFixture?.review);
  const scopedReviews = Map.groupBy(reviews.filter(review => reviewInSelection(review, data, item, scopes)),
    review => reviewTest(data, review));
  return methodIds
    .map((test) => {
      const rows = methodEvidence(data, test, reviews, evidenceHistory, undefined, decisions)
        .filter(row => includesUnit(item, row.record.unit));
      const evidence = new Map(rows.map(({ record }) => [record.id, record.title]));
      const latest = scopedReviews.get(test)?.at(-1);
      return {
        id: test, title: methods[test].label,
        ...methodStatus(item, rows),
        evidenceCount: evidence.size,
        evidenceNames: [...evidence.values()].join(" "),
        activity: [...rows.map(({ recordedAt }) => recordedAt), latest?.recordedAt].filter(
          (value): value is string => Boolean(value),
        ).sort().at(-1),
      };
    })
    .toSorted((first, second) => first.rank - second.rank);
}

export function reviewInSelection(
  review: EvidenceReview, data: VerificationRecords, item: SelectedItem | undefined, scopes: readonly ReviewScopeOption[],
) {
  const scope = review.scope;
  if (!scope) return includesUnit(item, data.article);
  if (isAggregateReview(review.scope)) return scopes.some((option) => sameReviewScope(option.scope, scope));
  return !!item?.members.some((unit) => reviewApplies(review, unit));
}

export function methodRecords({ test, data, item, activity, reviews, reviewScopes, exact }: {
  test: VerificationTest;
  data: VerificationRecords;
  item?: SelectedItem;
  activity: readonly RecordEntry[];
  reviews: readonly EvidenceReview[];
  reviewScopes: readonly ReviewScopeOption[];
  exact?: string;
}) {
  const rows = methodEvidence(data, test, reviews, activity, exact);
  const available = rows.filter(row => row.opens === row.record.id && !row.archived);
  const scoped = available.filter(({ record }) => includesUnit(item, record.unit));
  const outside = Boolean(exact && !scoped.some(({ record }) => record.id === exact));
  const linked = outside ? rows.find(row => row.opens === exact && row.record.id === exact) : undefined;
  const records = outside ? (linked ? [linked] : []) : scoped;
  const visibleReviews = reviews.filter((review) => {
    if (reviewTest(data, review) !== test) return false;
    if (!outside) return reviewInSelection(review, data, item, reviewScopes);
    return !!linked && (review.scope || sameUnit(linked.record.unit, data.article)) &&
      reviewApplies(review, linked.record.unit) && review.evidenceIds.includes(linked.id);
  });
  for (const { storedReview } of records) {
    if (storedReview) visibleReviews.push(storedReview);
  }

  const editable = reviewScopes.length > 0 && !outside;
  return {
    records, scoped, outside, visibleReviews, linkedArticle: linked?.record.unit, editable,
    availableEvidence: available.map(row => row.record),
    groupedItem: !outside && showsApplicability(item) ? item : undefined,
  };
}

export function reviewHistory(data: VerificationRecords, reviews: readonly EvidenceReview[],
  scopes: readonly ReviewScopeOption[]) {
  const entries = reviews.toSorted((first, second) => second.recordedAt.localeCompare(first.recordedAt));
  return entries.map(review => {
    const links = reviewEvidenceLinks(data, review);
    const retest = !isAggregateReview(review.scope) && isRetestDecision(review.decision) &&
      links.some(({capture, unit}) => capture?.handoffId && reviewApplies(review, unit));
    return {
      id: review.id, review, links, retest,
      missingEvidence: links.length === review.evidenceIds.length ? [] : review.evidenceIds.filter(id => !reviewRecord(data, id)?.record),
      label: retest ? "Retest requested" : review.decision,
      reviewer: review.reviewer ?? reviewRoles[reviewActor(review.decision)],
      scopeLabel: scopes.find(({ scope }) => review.scope && sameReviewScope(scope, review.scope))?.label
        ?? (review.scope?.selection.startsWith("unit:") ? review.scope.selection.slice(5) : undefined),
      tone: review.decision === "Approved" || review.decision === "Pass" ? "green"
        : review.decision === "Not applicable" || review.decision === "Reviewed" ? "gray" : "amber",
    };
  });
}
