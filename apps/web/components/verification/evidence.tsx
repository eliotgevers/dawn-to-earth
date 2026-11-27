import { EmptyRecords } from "@/components/records/empty";
import { badgeTones, recordLink, fieldLabel, noteField } from "@/components/records/presentation";
import { RecordResults } from "@/components/records/results";
import { TestStation } from "./test-station";
import { ImportBenchRun } from "./bench-import";
import { GrafanaLinks } from "./grafana-links";
import { GroupedRecordRows, RecordFacts, RecordRow } from "@/components/records/layout";
import { useRouter, useSearchParams } from "next/navigation";
import { setListLocation } from "@/components/workspace/navigation";
import { citedWork } from "./acceptance";
import { ArchiveInvestigation } from "./investigation";
import { RevisionFileLink } from "@/components/catalog/revision-files";
import { ValidationEvidence } from "./validation-evidence";
import { ExchangeInspector } from "./exchange-inspector";
import { ConnectionList, SourceLink } from "@/components/records/links";
import { RecordActionButton, RecordNotes } from "@/components/records/actions";
import { bracketRecords, recordActivity, visibleRecordNotes, type RecordEntry, sameUnit } from "@/lib/records/journal";
import { recordConnection, type RecordConnection } from "@/lib/records/links";
import { RecordDialog, RecordDialogs, LabeledSelect } from "@/components/records/forms";
import { connectionToRecord, serialApplicability } from "@/components/records/schema";
import {
  type EvidenceRecord,
  type CatalogEvidence,
  methods, reviewRecord, type VerificationRecords,
  type VerificationTest,
  type ReviewScopeOption,
  isAggregateReview,
  reviewScopeOptions, sameReviewScope, type ReviewScope,
  reviewOptions, targetOptions,
  reviewStep,
  reviewRoles,
  type ReviewDecision,
  type ReviewTarget,
} from "@/components/verification/model";
import { includesUnit, unitSelection, serialFromSelection, type ItemSelection } from "@/components/workspace/selection";
import { formatUtcDateTime } from "@/lib/utc-time";
import { submitDemoReview } from "@/app/(sections)/verification/actions";
import { ScanSearch } from "lucide-react";
import { EvidenceCapture, RecordedReadings } from "@/components/verification/capture";
import { saveWorkspace, useVerification } from "@/lib/workspace";
import { evidenceRetentionReason, evidenceSearchText, methodRecords, reviewHistory } from "@/components/verification/outcomes";
import { useRef, type Ref, useId, useImperativeHandle, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { SelectionChip } from "@/components/workspace/item-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function evidenceFacts(
  record: EvidenceRecord | CatalogEvidence,
  data: VerificationRecords,
  test: VerificationTest,
) {
  const bracket = record.content === "bracket" ? data.bracketFollowUp : undefined;
  const context = record.content === "capture" && sameUnit(record.unit, data.article) ? data.context[test] : undefined;
  const owner = record.unit;
  const article = context ? `${data.article.title} · ${data.article.serial}` : owner?.serial;
  const result = [
    ["Observation", record.observation ?? bracket?.observation],
    ["Evidence supports", record.supports],
    ["Follow-up", record.followUp],
  ] as const;
  const source = [
    ["Source", record.source],
    ...(record.sourceSheet && /^[a-z0-9-]+\.svg$/.test(record.sourceSheet)
      ? [["Observation sheet", <SourceLink className={recordLink} href={`/inspection/${record.sourceSheet}`}>Open annotated comparison</SourceLink>]] as const : []),
    ["Test article", article],
    ...("requirement" in record ? [] : [["Requirement", context?.requirement] as const]),
    ["Recorded", record.recordedAt && formatUtcDateTime(record.recordedAt)],
  ] as const;
  return { result, source };
}

function evidenceDestinations(
  record: EvidenceRecord | CatalogEvidence,
  data: VerificationRecords,
  test: VerificationTest,
  availableEvidence: readonly (CatalogEvidence | EvidenceRecord)[],
  targets: ReturnType<typeof useVerification>["targets"],
): RecordConnection[] {
  const links: RecordConnection[] = [];
  if ("requirement" in record) {
    links.push(citedWork(targets, "engineering", record.requirement.id, record.unit),
      citedWork(targets, "production", record.build.id, record.unit));
  }
  if (record.content === "bracket" && record.unit) {
    for (const {section, id} of [bracketRecords.requirement, bracketRecords.build, bracketRecords.issue]) {
      links.push(citedWork(targets, section, id, record.unit));
    }
  }
  const outgoing = new Set(record.relatedEvidenceIds);
  for (const id of outgoing) {
    const found = reviewRecord(data, id);
    if (found?.record?.id === id) {
      links.push(connectionToRecord("verification", { ...found.record, test: found.test }));
    } else {
      links.push(recordConnection("verification", id, record.unit, { label: `Unavailable evidence · ${id}`, view: "" }));
    }
  }
  // Later exhibits can cite an immutable source without rewriting its signed record.
  for (const target of availableEvidence) {
    if (target.id === record.id || outgoing.has(target.id) || !sameUnit(target.unit, record.unit)) continue;
    if (target.relatedEvidenceIds?.includes(record.id)) {
      links.push(connectionToRecord("verification", { ...target, test }));
    }
  }
  return links;
}

function EvidenceRecordList({
  sources,
  view,
  records,
  label = "Evidence records",
  onReview,
}: {
  sources: Pick<MethodProps, "localWorkspace" | "data" | "test" | "activity" | "reviews" | "selectedId" | "onSelect" | "removeNote">;
  view: ReturnType<typeof methodRecords>;
  records: Readonly<ReturnType<typeof methodRecords>["records"]>;
  label?: string;
  onReview: (id: string) => void;
}) {
  const { data, test, activity, reviews, selectedId, onSelect, removeNote } = sources;
  const {targets} = useVerification();
  const [previewId, setPreviewId] = useState<string>();
  const { groupedItem, outside, editable, availableEvidence } = view;
  return (
    <GroupedRecordRows
      records={records.toSorted((a, b) => (b.record.recordedAt ?? "").localeCompare(a.record.recordedAt ?? ""))}
      label={label}
      scope={({record}) => (groupedItem ? serialApplicability(record.unit, groupedItem) : undefined)}
    >
      {({record, id, latest, mode, retest, archived, status}) => {
        const expanded = selectedId === record.id;
        const reviewId = editable && (mode !== "read-only" || !sources.localWorkspace) ? id : undefined;
        const fields = expanded ? evidenceFacts(record, data, test) : null;
        const linkProps = {
          links: expanded ? evidenceDestinations(record, data, test, availableEvidence, targets) : [],
          article: methods[test].article,
        };
        const check = data.acceptanceChecks?.find(({ comparison, unit }) => comparison?.evidenceId === record.id && sameUnit(unit, record.unit));
        const handoff = record.capture?.handoffId;
        const pending = handoff && retest === "requested" ? latest : undefined;
        const recordUnit = !outside ? record.unit : undefined;
        const history = recordActivity(activity, record.id, record.unit ?? data.article);
        const finding = history.find((row) => row.eventFinding)?.eventFinding;
        const exchangeArchive = record.exchangeArchive ?? finding?.archive;
        const retained = evidenceRetentionReason(record, reviews, Boolean(check), Boolean(finding),
          (test === "communication" || test === "leak") && availableEvidence.some(other => other.importedRun && other.relatedEvidenceIds?.includes(record.id)));
        const subject = { id: record.id, title: record.title, kind: "evidence" as const, test };
        const canFileCapture = sources.localWorkspace && editable &&
          !archived && !record.importedRun && !record.capture?.readOnly;
        const returnReviewId = test === "communication" && record.importedRun && latest?.decision === "Returned for follow-up"
          ? latest.id : undefined;
        const archiveCapture = record.content === "capture" && sameUnit(record.unit, data.article);
        const hasRecording = archiveCapture || Boolean(record.numericSeries?.length);
        const previewOpen = expanded && previewId === record.id;
        const previewRegion = "recording-" + record.id;
        const actions = expanded && <>
          {recordUnit && !archived && <TestStation method={test} sourceId={record.id} unit={recordUnit} canFileCapture={canFileCapture} />}
          {test === "communication" && recordUnit && !archived &&
            <ImportBenchRun sourceId={record.id} title={record.title} unit={recordUnit}
              original={record.importedRun ? record.numericSeries?.[0] : undefined} returnReviewId={returnReviewId} />}
          {hasRecording && <Button size="sm" variant="outline" className="bg-popover" aria-expanded={previewOpen}
            aria-controls={previewRegion} onClick={() => setPreviewId(previewOpen ? undefined : record.id)}>
            <ScanSearch data-icon="inline-start" aria-hidden="true" />Preview recording
          </Button>}
          {reviewId && <RecordActionButton action="review"
            textOverride={check?.comparison ? "Review source" : undefined} onClick={() => onReview(reviewId)} />}
          {record.unit && exchangeArchive && <ExchangeInspector archive={exchangeArchive} unit={record.unit}
            sourceId={record.id} readOnly={!recordUnit || !record.exchangeArchive} />}
        </>;
        return (
          <RecordRow key={record.id} id={record.id} rowAnchor expanded={expanded} toggle={() => onSelect(record.id)}
            status={archived ? "Archived" : status ?? "Needs review"} tone="gray" title={record.title} reference={record.type}
            actions={recordUnit && <>
              {record.authored && !retained && <RecordDialog type="edit" unit={recordUnit} entry={{
                ...subject, evidenceType: record.type, description: record.observation ?? "", context: record.source ?? "",
              }} />}
              <RecordDialog type="remove" unit={recordUnit} entry={subject} retentionReason={retained}
                onSaved={() => removeNote(record.id)} />
            </>}>
            {fields && <>
              {check?.comparison ? (
                <ArchiveInvestigation check={check} comparison={check.comparison} readOnly={!recordUnit}
                  actions={actions} observation={record.observation} followUp={record.followUp} {...linkProps}>
                  <RecordFacts entries={[["Evidence supports", record.supports], ...fields.source.filter(([name]) => name !== "Test article")]} />
                </ArchiveInvestigation>
              ) : <div className="flex flex-wrap items-center gap-2 empty:hidden">{actions}</div>}
              {hasRecording && <section id={previewRegion} aria-label="Recorded evidence" hidden={!previewOpen}>
                {previewOpen && <>
                  <p className="mb-2 text-sm text-muted-foreground">{[record.unit?.serial, record.unit?.revision, record.source].filter(Boolean).join(" · ")}</p>
                  {archiveCapture
                    ? <EvidenceCapture data={data} test={test} retest={Boolean(record.capture?.replaces)} />
                    : <RecordedReadings series={record.numericSeries ?? []} />}
                </>}
              </section>}
              {!check?.comparison && <div className="max-w-prose pt-2"><RecordFacts layout="primary" entries={fields.result} /></div>}
              {record.unit && exchangeArchive && (
                <GrafanaLinks archive={exchangeArchive} sourceId={record.id} unit={record.unit} />
              )}
              {record.unit && <RevisionFileLink unit={record.unit} sourceId={record.id} />}
              {record.unit && record.numericSeries && record.numericSeries.length > 0 && (
                <GrafanaLinks series={record.numericSeries} method={test} recordId={record.id} unit={record.unit} />
              )}
              <div className="grid gap-2.5 pt-2 wrap-anywhere">
                {pending && (
                  <div id={handoff} className="mb-2.75 border-b pb-2.75 [&_dl>div]:grid-cols-[62px_minmax(0,1fr)] [&_dd]:whitespace-pre-wrap scroll-mt-[calc(var(--header)+12px)]" tabIndex={-1}>
                    <h3 className="text-[13px] font-semibold">Retest handoff</h3>
                    <RecordFacts
                      entries={[
                        ["Owner", "Technician"],
                        ["Reason", pending.reason],
                      ]}
                    />
                    {pending.focus && <p className="mt-0.5 text-xs text-muted-foreground">{pending.focus}</p>}
                  </div>
                )}
                {!check?.comparison && <>
                  <details>
                    <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2">Source and recording details</summary>
                    <div className="max-w-3xl pt-2"><RecordFacts entries={fields.source} /></div>
                  </details>
                  {record.content === "validation-study" && record.unit ? (
                    <ValidationEvidence sourceId={record.id} unit={record.unit}
                      {...linkProps} />
                  ) : (
                    <ConnectionList sourceId={record.id} {...linkProps} />
                  )}
                </>}
              </div>
              <RecordNotes
                key={JSON.stringify([record.id, recordUnit?.serial, recordUnit?.revisionId])}
                sharedDemo={!sources.localWorkspace}
                allowSharedNote={!archived && !record.authored && !record.importedRun}
                target={{ id: record.id, title: record.title, kind: "evidence", test }}
                notes={visibleRecordNotes(history)}
                unit={recordUnit}
              />
            </>}
          </RecordRow>
        );
      }}
    </GroupedRecordRows>
  );
}

type MethodProps = Parameters<typeof methodRecords>[0] & {
  selectedId?: string;
  localWorkspace: boolean;
  evidenceHeading?: Ref<HTMLHeadingElement>;
  noteSaved: (record: RecordEntry) => void;
  removeNote: (id: string) => void;
  onSelect: (id: string) => void;
};

export function VerificationMethod(props: MethodProps) {
  const { test, item, exact, data, reviewScopes, evidenceHeading, noteSaved } = props;
  const query = useSearchParams();
  const reviewForm = useRef<ReviewFormHandle>(null);
  const add = item && item.members.length > 0 && (
    <RecordDialog
      type="add"
      kind="evidence"
      test={test}
      units={item.members}
      requireUnitChoice={!item.unit}
      onSaved={noteSaved}
    />
  );
  const headingId = `test-evidence-${test}`;
  const reviewHeadingId = `record-review-${test}`;
  const view = methodRecords(props);
  const { linkedArticle, outside, scoped, records, editable, visibleReviews } = view;
  const archive = test === "ground-firing";
  const filterKey = archive ? "type" : "status";
  const historyHeadingId = `review-history-${test}`;
  const history = reviewHistory(data, visibleReviews, reviewScopes);
  const evidenceList = (rows: Readonly<typeof records>, label?: string) => (
    <EvidenceRecordList
      sources={props}
      view={view}
      records={rows}
      label={label}
      onReview={(id) => reviewForm.current?.focusEvidence(id)}
    />
  );
  const historyBody = history.length ? (
          <RecordResults records={history}
            searchLabel="Search reviews" statusLabel="Review decision"
            status={entry => entry.label}
            searchText={({ review, reviewer, scopeLabel, links }) =>
              [review.decision, review.reason, reviewer, scopeLabel, review.recordedAt, ...links.map(link => link.title)].join(" ")}>
            {matches => <ol className="mt-3 divide-y">
            {matches.map(({ review, reviewer, links, missingEvidence, scopeLabel, tone, retest, label }) => {
              return (
                <li key={review.id} id={review.id} tabIndex={-1} className="py-2.75 grid gap-2.5 pt-2 wrap-anywhere">
                  <RecordFacts
                    layout="primary"
                    entries={[
                      [
                        "Decision",
                        <Badge variant="outline" className={`h-6 max-sm:h-[22px] max-sm:px-[5px] ${badgeTones[tone]}`}>
                          {label}
                        </Badge>,
                      ],
                      ["Notes", review.reason],
                    ]}
                  />
                  <RecordFacts
                    entries={[
                      ["Target", scopeLabel ?? (!review.evidenceIds.length ? "Category review" : undefined)],
                      ["Reviewer", reviewer],
                      [
                        "Recorded",
                        <time className="mt-1 block text-xs text-muted-foreground" dateTime={review.recordedAt}>{formatUtcDateTime(review.recordedAt)}</time>,
                      ],
                      ...(retest ? [["Assigned to", "Technician"]] as const : []),
                    ]}
                  />
                  {review.evidenceIds.length > 0 && (
                    <ConnectionList
                      title="Linked evidence"
                      sourceId={review.id}
                      links={links.map(row => connectionToRecord("verification", { ...row, test }))}
                    />
                  )}
                  {missingEvidence.length > 0 && <p className="text-xs text-muted-foreground">
                    Cited evidence unavailable · {missingEvidence.join(", ")}
                  </p>}
                </li>
              );
            })}
          </ol>}
          </RecordResults>
        ) : <p className="text-sm text-muted-foreground">No reviews recorded for this scope.</p>;
  return (
    <RecordDialogs><div className="grid gap-5 [&>section+section]:border-t [&>section+section]:pt-3.75">
      {linkedArticle && <p className="mt-1 text-[13px] leading-normal text-muted-foreground">Linked evidence · {linkedArticle.serial}</p>}
      <section aria-labelledby={headingId}>
        <h2 id={headingId} ref={evidenceHeading} tabIndex={-1} className="mb-2 text-base font-semibold tracking-tight">
            Evidence
          </h2>
        {!item && <EmptyRecords unselected />}
        {outside && evidenceList(records, "Linked evidence")}
        {item && (
          <RecordResults
            resetKey={exact}
            records={scoped}
            search={{value: query.get("q") ?? "", onChange: value => setListLocation(test, "q", value || null)}}
            selectedStatus={query.get(filterKey) ?? "All"}
            onStatusChange={value => setListLocation(test, filterKey, value === "All" ? null : value)}
            status={row => archive ? row.record.type : row.status ?? "Needs review"}
            statusOptions={archive ? methods[test].types : undefined}
            statusLabel={archive ? "Archive record type" : "Evidence status"}
            actions={!outside && add}
            searchText={evidenceSearchText}
          >
            {evidenceList}
          </RecordResults>
        )}
      </section>
      <section aria-labelledby={reviewHeadingId}>
        <h2 id={reviewHeadingId} tabIndex={-1} className="scroll-mt-[calc(var(--header)+12px)]">
          Create Review
        </h2>
        {editable ? (
          <ReviewForm
            ref={reviewForm}
            sharedDemoReview={!props.localWorkspace}
            test={test}
            scopeOptions={reviewScopes}
            candidates={scoped}
          />
        ) : records.length ? (
          <p className="mt-1 text-[13px] leading-normal text-muted-foreground">This evidence is read-only.</p>
        ) : (
          <EmptyRecords />
        )}
      </section>
      <section aria-labelledby={historyHeadingId}>
        <h2 id={historyHeadingId} className="mb-2 text-base font-semibold tracking-tight">Review History</h2>
        {historyBody}
      </section>
    </div></RecordDialogs>
  );
}

function reviewDraftChoices(
  test: VerificationTest, selected: readonly ReviewTarget[], decision: ReviewDecision | null,
  scope: ReviewScopeOption | undefined, targets: readonly ReviewTarget[],
) {
  const aggregate = isAggregateReview(scope?.scope);
  const allowedDecisions = reviewOptions(test, selected, scope?.scope);
  const offered = new Map(allowedDecisions.map((option) => [option.value, option]));
  // Before choosing evidence, offer its possible decisions. Preserve the original label of an incompatible draft.
  if (!aggregate && (!selected.length || (decision && !offered.has(decision)))) {
    for (const target of targets) {
      for (const option of targetOptions(test, target)) {
        if (!selected.length || option.value === decision) offered.set(option.value, option);
      }
    }
  }
  if (decision && !offered.has(decision)) offered.set(decision, { value: decision, label: decision });
  const action = allowedDecisions.find(({ value }) => value === decision);
  const latest = !aggregate && selected.length === 1 ? selected[0].latest : undefined;
  const changed = selected.some((pin) => !targets.some((current) =>
    current.id === pin.id && current.mode === pin.mode && current.latest?.id === pin.latest?.id));
  let error = "";
  if (changed) error = "Evidence changed. Remove the affected selection and select it again before saving.";
  else if (!action && decision) {
    if (aggregate) error = "Choose a decision that applies to this review target.";
    else if (selected.length) error = "Choose a decision that applies to the selected evidence.";
    else error = "Choose evidence for this decision.";
  }
  const stage = reviewStep(latest);
  const handoff = !aggregate && selected.length > 0 && (stage !== "reviewer" || decision === "Retest requested");
  const handoffStage = latest && (stage !== "reviewer" || latest.decision === "Follow-up submitted")
    ? reviewRoles[stage] : undefined;
  return { action, decisionOptions: [...offered.values()], latest, handoffStage,
    submitLabel: handoff && action ? action.label : "Record review", changed, error };
}

function ReviewEvidenceSelect({
  selected, targets, onChange,
}: {
  selected: readonly ReviewTarget[];
  targets: readonly ReviewTarget[];
  onChange: (ids: string[]) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const values = selected.map(({ id }) => id);
  // Offer issued exhibits before subsequent operator entries.
  const options = targets.toSorted((a, b) => Number(!!a.record.authored) - Number(!!b.record.authored))
    .map(({ id, record }) => ({ value: id, label: record.title }));
  return (
    <LabeledSelect<string, true>
      multiple
      disabled={!options.length}
      options={options}
      label={
        <>
          Evidence <span className="font-normal text-muted-foreground">(optional)</span>
        </>
      }
      display={options.length ? "Choose evidence" : "Unavailable"}
      value={values}
      onChange={onChange}
      trigger={trigger}
    >
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected evidence">
          {selected.map(({ id, record }) => (
            <SelectionChip key={id} evidence label={record.title} trigger={trigger}
              onRemove={() => onChange(values.filter(value => value !== id))} />
          ))}
        </ul>
      )}
    </LabeledSelect>
  );
}

type ReviewFormHandle = { focusEvidence: (id: string) => void };

function ReviewForm({
  sharedDemoReview,
  test,
  scopeOptions,
  candidates,
  ref,
}: {
  scopeOptions: readonly ReviewScopeOption[];
  candidates: readonly ReviewTarget[];
  sharedDemoReview: boolean;
  test: VerificationTest;
  ref?: Ref<ReviewFormHandle>;
}) {
  const fieldId = useId();
  const router = useRouter();
  const requestId = useRef<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<ReviewScope | null>(null);
  const [requestedId, setRequestedId] = useState<string>();
  const { records: { catalog } } = useVerification();
  const [selected, setSelected] = useState<ReviewTarget[]>([]);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [feedback, setFeedback] = useState("");
  const headingId = `record-review-${test}`;
  function exactUnitOption(selection: ItemSelection) {
    const [option] = reviewScopeOptions(catalog, [selection]);
    const unit = option?.item.members[0];
    if (!unit || !option.item.unit || !scopeOptions.some(parent => includesUnit(parent.item, unit))) return;

    return { ...option, label: unit.serial + " · " + unit.revision };
  }

  const listed = chosen && scopeOptions.find(option => sameReviewScope(option.scope, chosen));
  const extra = !listed && chosen?.revision && chosen.selection.startsWith("unit:")
    ? exactUnitOption(unitSelection(serialFromSelection(chosen.selection), chosen.revision)) : undefined;
  const scope = chosen ? listed ?? extra : scopeOptions.length === 1 ? scopeOptions[0] : undefined;
  const requested = candidates.find(row => row.id === requestedId);
  const targetOptions = requested
    ? scopeOptions.filter(option => includesUnit(option.item, requested.record.unit))
    : extra ? [...scopeOptions, extra] : scopeOptions;
  const targetsFor = (option: ReviewScopeOption) => candidates.filter(({ record }) => includesUnit(option.item, record.unit));
  const targets = scope ? targetsFor(scope) : [];
  const { action, decisionOptions, latest, handoffStage, submitLabel, changed, error: selectionError } =
    reviewDraftChoices(test, selected, decision, scope, targets);
  const scopeChoices = targetOptions.map(({ selection, label }) => ({ value: selection, label }));
  const evidenceValues = selected.map(({ id }) => id);
  const notes = useRef<HTMLTextAreaElement>(null);
  function selectEvidence(next: string[], nextScope?: ReviewScopeOption) {
    const target = nextScope ?? scope;
    if (!target) return;
    const available = nextScope ? targetsFor(nextScope) : targets;
    setChosen(target.scope);
    setSelected([...new Set(next)].flatMap((id) => {
      const current = available.find((record) => record.id === id);
      if (nextScope && !current) return [];
      return selected.find((pin) => pin.id === id) ?? current ?? [];
    }));
    setFeedback("");
  }

  function focusReview() {
    const heading = document.getElementById(headingId);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }

  function startSourceReview(source: ReviewTarget, target: ReviewScopeOption) {
    const sameTarget = scope ? sameReviewScope(scope.scope, target.scope) : !chosen;
    const next = selected.some(row => row.id === source.id) ? selected : [...selected, source];
    const compatible = sameTarget && next.every(row => includesUnit(target.item, row.record.unit)) &&
      (!decision || reviewOptions(test, next, target.scope).some(option => option.value === decision));
    const hasDraft = selected.length > 0 || decision || notes.current?.value.trim();
    if (!compatible && hasDraft) {
      if (!window.confirm("Start a new review for this source? Your current evidence selection, decision and notes will be discarded.")) {
        setRequestedId(undefined);
        focusReview();
        return;
      }
      setDecision(null);
      if (notes.current) notes.current.value = "";
    }
    setSelected(compatible ? next : [source]);
    setChosen(target.scope);
    setRequestedId(undefined);
    setFeedback("");
    focusReview();
  }

  useImperativeHandle(ref, () => ({
    focusEvidence(id) {
      if (saving) return;
      const source = candidates.find(row => row.id === id);
      if (!source?.record.unit) return;
      const unit = source.record.unit;
      const eligible = scopeOptions.filter(option => includesUnit(option.item, unit));
      const draftInScope = scope && includesUnit(scope.item, unit) &&
        (selected.length || decision || notes.current?.value.trim());
      const target = draftInScope ? scope : exactUnitOption(unitSelection(unit.serial, unit.revisionId)) ??
        (eligible.length === 1 ? eligible[0] : undefined);
      if (target) startSourceReview(source, target);
      else {
        setRequestedId(id);
        setFeedback("");
        focusReview();
      }
    },
  }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || requested) return;
    const reason = notes.current?.value.trim() ?? "";
    if (!scope) return setFeedback("Choose a target.");
    if (selectionError) return setFeedback(selectionError);
    if (!action || !reason) return setFeedback("Choose a decision and enter notes.");
    const source = selected[0];
    const unit = source?.record.unit;
    if (sharedDemoReview && (!unit || selected.length !== 1 || isAggregateReview(scope.scope) || action.value !== "Reviewed"))
      return setFeedback("Choose one evidence record on an exact unit and revision for your shared review.");
    setSaving(true);
    const { error } = await (sharedDemoReview && unit ? submitDemoReview({
      id: requestId.current ??= crypto.randomUUID(),
      target: { recordId: source.id, serial: unit.serial, revisionId: unit.revisionId },
      reason, test, decision: "Reviewed", expectedReviewId: source.latest?.id,
    }) : saveWorkspace({
      operation: "review",
      review: { test, scope: scope.scope, decision: action.value, reason },
      targets: selected.map(({ id, latest }) => ({ id, expectedReviewId: latest?.id })),
    })).finally(() => setSaving(false));
    if (error) return setFeedback(error);
    if (sharedDemoReview) router.refresh();
    requestId.current = undefined;
    setSelected([]);
    setDecision(null);
    if (notes.current) notes.current.value = "";
    setFeedback(sharedDemoReview ? "Review filed in the shared Review History." : "Review recorded.");
    document.getElementById(headingId)?.focus();
  }

  return (
    <form
      className="mt-3 grid max-w-[680px] gap-2.5"
      onSubmit={submit}
      aria-describedby={`${fieldId}-feedback`}
      aria-labelledby={headingId}
    >
      {sharedDemoReview && <p className="text-xs text-muted-foreground">Your observation will appear in the shared Review History. Filing it leaves QA decisions and assignments with their owners.</p>}
      {requested && <div role="status" className="text-sm">
        Choose a target for “{requested.record.title}”.{" "}
        <button type="button" className="underline" onClick={() => setRequestedId(undefined)}>Cancel</button>
      </div>}
      {(targetOptions.length > 1 || requested || (chosen && !scope)) && (
        <LabeledSelect
          label="Target"
          placeholder="Choose a target"
          required
          options={scopeChoices}
          value={requested ? null : scope?.selection ?? null}
          onChange={(value) => {
            const next = targetOptions.find(option => option.selection === value);
            if (!next) return;
            if (requested) startSourceReview(requested, next);
            else selectEvidence(evidenceValues, next);
          }}
        />
      )}
      <LabeledSelect
        label="Decision"
        placeholder="Choose a decision"
        required
        options={sharedDemoReview ? decisionOptions.filter(option => option.value === "Reviewed") : decisionOptions}
        value={decision}
        onChange={(next) => {
          if (scope) setChosen(scope.scope);
          setDecision(next);
          setFeedback("");
        }}
      />
      <ReviewEvidenceSelect selected={selected} targets={targets} onChange={(ids) => selectEvidence(ids)} />
      <label className={fieldLabel}>
        <span>Notes</span>
        <Textarea className={`${noteField} min-h-[78px]!`} ref={notes} onChange={() => { if (scope && !chosen) setChosen(scope.scope); }} required maxLength={500} rows={3} />
      </label>
      {handoffStage && (
        <p className="text-[13px] wrap-anywhere whitespace-pre-wrap">
          <strong>{handoffStage}:</strong> {latest?.reason}
        </p>
      )}
      <Button variant="outline" className="justify-self-start bg-popover" type="submit" disabled={saving || Boolean(requested)}>
        {sharedDemoReview ? "File shared review" : submitLabel}
      </Button>
      <p id={`${fieldId}-feedback`} className="text-xs text-muted-foreground empty:absolute" role="status">
        {changed ? selectionError : feedback}
      </p>
    </form>
  );
}
