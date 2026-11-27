import { ScanLine, NotebookPen } from "lucide-react";
import { sameUnit } from "@/lib/records/journal";
import { GrafanaLinks } from "./grafana-links";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { archiveTraceWindows } from "@/lib/evidence/traces";
import { RunAnalysis } from "./run-analysis";
import { FrameComparison, type FrameRange, type Comparison } from "./archive-frames";
import {
  acceptanceState,
  citedWork,
  acceptanceReviewConnection,
  imageComparisonConnection,
  inspectInterval,
  sameArchiveEdition,
  type AcceptanceCheck,
} from "./acceptance";
import { useVerification, saveWorkspace } from "@/lib/workspace";
import { findingConnection, recordConnection, recordUnitLabel, type RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import { RecordFacts } from "@/components/records/layout";
import { ConnectionList } from "@/components/records/links";
import { CompareDialog } from "@/components/records/compare-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { LabeledSelect, FormDialog, NoteField } from "@/components/records/forms";

type Finding = ReturnType<typeof useVerification>["findings"][number];
function findingLinks(
  check: AcceptanceCheck,
  state: ReturnType<typeof acceptanceState>,
  saved: readonly Finding[],
  anchor: Finding | undefined,
  archive: RecordConnection,
  current: boolean,
  targets: ReturnType<typeof useVerification>["targets"],
  sources: readonly RecordConnection[],
) {
  const links: RecordConnection[] = [
    acceptanceReviewConnection(check),
    ...saved.filter(f => f.id !== anchor?.id).map(findingConnection),
  ];
  if (anchor?.issueId)
    links.push(citedWork(targets, "production", anchor.issueId, check.unit));
  if (anchor?.decisionId) {
    const capture = state.submissions.find(row => row.review?.id === anchor.decisionId);
    if (capture)
      links.push(recordConnection("verification", capture.id, check.unit, { label: "Recorded QA decision", view: "Acceptance Review" }));
  }
  if (anchor && (!current || anchor.analysisId))
    links.push({ ...archive, label: "Current " + archive.label.toLowerCase() });
  if (anchor?.archive && !current)
    links.push(citedWork(targets, "engineering", anchor.archive.requirementId, check.unit));
  if (!anchor || current) links.push(...sources);

  return links;
}

export function ArchiveInvestigation({
  check, comparison, links, article, children, actions, readOnly, observation, followUp,
}: Pick<ComponentProps<typeof ConnectionList>, "article" | "links"> & {
  check: AcceptanceCheck;
  comparison: Comparison;
  children: ReactNode;
  actions: ReactNode;
  observation?: string;
  followUp?: string;
  readOnly: boolean;
}) {
  const { findings, targets } = useVerification();
  const query = useSearchParams();
  const id = query.get("finding");
  const saved = findings.filter(
    (f) => f.checkId === check.id && sameUnit(f, check.unit) && f.archiveId === comparison.evidenceId,
  );
  const open = Boolean(id) || query.get("compare") === check.id;
  function showComparison(next: boolean) {
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set("compare", check.id);
      url.hash = comparison.evidenceId;
    } else {
      url.searchParams.delete("compare");
      url.searchParams.delete("finding");
    }
    window.history.replaceState(null, "", url);
  }
  const anchor = saved.find((f) => f.id === id);
  const state = acceptanceState(check);
  const current = Boolean(
    comparison.runId && comparison.rerunId && (!anchor || sameArchiveEdition(check, anchor.archive)),
  );
  const archive = imageComparisonConnection({ ...check, comparison })!;
  let content: ReactNode;
  let destinations: RecordConnection[];
  if (id && !anchor) {
    content = <p role="status">Finding unavailable for this unit, revision and archive.</p>;
    destinations = [archive];
  } else {
    destinations = findingLinks(check, state, saved, anchor, archive, current, targets, links);
    const source = anchor ? anchor.archive : comparison;
    if (anchor?.analysisId) {
      content = <RunAnalysis key={anchor.id} checkId={check.id} pinnedId={anchor.id} />;
    } else if (source) {
      content = <SourceArchive key={anchor?.id ?? check.id} check={check} state={state} source={source}
        anchor={anchor} current={current} editable={current && !readOnly} followUp={followUp}>
        {children}
      </SourceArchive>;
    } else {
      content = <>
        <strong>Saved finding · Frames {anchor?.first}–{anchor?.last}</strong>
        <p>{anchor?.observation}</p>
        <p role="status">The run editions were not recorded with this finding.</p>
      </>;
    }
  }
  return (
    <div className="grid min-w-0 gap-2.5 pt-2 wrap-anywhere">
      <div className="flex flex-wrap items-center gap-2">
        <CompareDialog title={`Image comparison · ${recordUnitLabel(check.unit)}`} triggerLabel="Review comparison"
          open={open} onOpen={() => showComparison(true)} onClose={() => showComparison(false)}>
          <section className="grid min-w-0 gap-3 wrap-anywhere" aria-label="Archived run investigation">
            {content}
          </section>
        </CompareDialog>
        {current && (!id || anchor) && actions}
      </div>
      {(!id || anchor) && (anchor?.observation || observation) && <div className="max-w-prose">
        <RecordFacts layout="primary" entries={[["Observation", anchor?.observation ?? observation]]} />
      </div>}
      {(!id || anchor) && <AcceptanceProgress state={state} followUp={current ? followUp : undefined} />}
      <ConnectionList sourceId={comparison.evidenceId} links={destinations} article={article} />
    </div>
  );
}

function SourceArchive({
  check, state, source, anchor, current, editable, followUp, children,
}: {
  check: AcceptanceCheck;
  state: ReturnType<typeof acceptanceState>;
  source: Comparison;
  anchor?: Finding;
  current: boolean;
  editable: boolean;
  followUp?: string;
  children: ReactNode;
}) {
  const [range, setRange] = useState({ first: anchor?.first ?? 1, last: anchor?.last ?? source.frames.length });
  const interval = inspectInterval(source, range.first, range.last);
  const firstDifference = source.frames.findIndex(frame => frame.original !== frame.repeat) + 1;
  return (
    <>
      {anchor && <p className="text-xs font-medium text-muted-foreground">Saved finding · Frames {anchor.first}–{anchor.last}</p>}
      {!current && <p role="status">These run editions are read-only. Open the current archive to submit evidence.</p>}
      <FrameComparison comparison={source} {...range} onChange={setRange}
        initialFrame={anchor?.first ?? (firstDifference || 1)} />
      {anchor?.observation && <p className="max-w-prose text-sm">{anchor.observation}</p>}
      <AcceptanceProgress state={state} followUp={current ? followUp : undefined} />
      {editable && <IntervalActions check={check} state={state} comparison={source} range={range} valid={Boolean(interval)} />}
      <ArchiveSources check={check} source={source} range={range} interval={interval}
        requirementId={anchor ? anchor.archive?.requirementId : check.requirementId}>
        {current && children}
      </ArchiveSources>
      {editable && <RunAnalysis checkId={check.id} />}
    </>
  );
}

function AcceptanceProgress({ state, followUp }: {
  state: ReturnType<typeof acceptanceState>;
  followUp?: string;
}) {
  const interval = state.current?.interval;
  return <RecordFacts entries={[
    ["Unit acceptance", state.stage + (interval ? ` · Submitted frames ${interval.start}–${interval.end}` : "")],
    ...(state.blocker ? [["Filed blocker", state.blocker] as const] : []),
    ...(followUp ? [["Follow-up", followUp] as const] : []),
  ]} />;
}

function ArchiveSources({ check, source, requirementId, range, interval, children }: {
  check: AcceptanceCheck;
  source: Comparison;
  requirementId?: string;
  range: FrameRange;
  interval: ReturnType<typeof inspectInterval>;
  children: ReactNode;
}) {
  return (
      <details className="min-w-0 text-sm">
        <summary className="w-fit cursor-pointer rounded-sm py-1 font-medium focus-visible:outline-2">Sources and Grafana</summary>
        <dl className="my-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr] sm:[&_dt]:text-muted-foreground">
          <dt>Unit and revision</dt><dd>{recordUnitLabel(check.unit)}</dd>
          <dt>Archive</dt><dd>{source.evidenceId}</dd>
          <dt>Requirement</dt><dd>{requirementId ?? "Unavailable"}</dd>
          <dt>Original</dt><dd>{source.run} · {source.runId ?? "Edition unavailable"}</dd>
          <dt>Rerun</dt><dd>{source.rerun} · {source.rerunId ?? "Edition unavailable"}</dd>
        </dl>
        <table className="my-2 text-left text-xs [&_:is(th,td)]:pr-4">
          <caption className="sr-only">Source label by frame</caption>
          <thead><tr><th>Frame</th><th>Original</th><th>Rerun</th></tr></thead>
          <tbody>{source.frames.map((frame, index) =>
            <tr key={index}><th scope="row">{index + 1}</th><td>{frame.original ? "Visible" : "Missing"}</td>
              <td>{frame.repeat ? "Visible" : "Missing"}</td></tr>)}</tbody>
        </table>
        {children}
        {interval && <>
          <p className="my-2 text-xs">Label visible in the selected interval · Original {interval.original}/{interval.count} · Rerun {interval.repeat}/{interval.count}</p>
          <GrafanaLinks windows={archiveTraceWindows(check, source, range.first, range.last)} />
        </>}
      </details>
  );
}

function IntervalActions({
  check,
  state,
  comparison,
  range,
  valid,
}: {
  check: AcceptanceCheck;
  state: ReturnType<typeof acceptanceState>;
  comparison: Comparison;
  range: FrameRange;
  valid: boolean;
}) {
  const basis = {
    checkId: check.id, requirementId: check.requirementId, ...check.unit,
    archiveId: comparison.evidenceId, runId: comparison.runId, rerunId: comparison.rerunId, ...range,
  };
  const [draft, setDraft] = useState<typeof basis & { kind: "capture" | "finding"; requestId: string }>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const destinations = [
    ...(check.issueId ? [{ value: check.issueId, label: `Production issue · ${check.issueId}` }] : []),
    ...state.submissions.flatMap(({ archive, review }) => review && sameArchiveEdition(check, archive) ? [review] : [])
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
      .map(review => ({ value: review.id, label: `QA · ${review.decision} · ${formatUtcDateTime(review.recordedAt)}` })),
  ];
  async function save(data: FormData) {
    if (!draft) return;
    const observation = String(data.get("observation") ?? "").trim();
    if (!observation) return "Enter an observation.";
    const { kind, first, last, ...scope } = draft;
    const { error } = await saveWorkspace(kind === "capture"
      ? { ...scope, observation, operation: "capture", start: first, end: last }
      : { ...scope, observation, operation: "save-finding", target: data.get("target"), first, last },
      kind === "capture" ? "acceptance" : "records");
    if (error) return error;
    return () => {
      setFeedback(draft.kind === "capture" ? "Interval captured. QA review is pending." : "Finding saved.");
      setDraft(undefined);
    };
  }
  return (
    <>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(undefined);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {(["capture", "finding"] as const).map((kind) => (
            <DialogTrigger
              key={kind}
              render={
                <Button
                  type="button"
                  size="sm"
                  disabled={!valid}
                  variant="outline"
                  className="bg-popover"
                  onClick={() => {
                    setFeedback("");
                    setDraft({ ...basis, kind, requestId: crypto.randomUUID() });
                  }}
                />
              }
            >
              {kind === "capture" ? <ScanLine data-icon="inline-start" aria-hidden="true" /> : <NotebookPen data-icon="inline-start" aria-hidden="true" />}
              {kind === "capture"
                ? state.accepted
                  ? "Replace accepted evidence"
                  : "Capture interval"
                : "Add finding"}
            </DialogTrigger>
          ))}
        </div>
        {draft && (
          <FormDialog variant="outline"
            heading={
              draft.kind === "finding"
                ? "Add finding"
                : state.accepted
                  ? "Replace accepted interval"
                  : "Capture interval"
            }
            onSubmit={save}
            description={`${recordUnitLabel(draft)} · ${draft.requirementId} · Frames ${draft.first}–${draft.last}`}
            onPendingChange={setBusy}
          >
            <p className="text-sm">
              {draft.runId} →{" "}
              {draft.rerunId}
            </p>
            {draft.kind === "capture" && state.accepted && (
              <p className="mt-1 text-[13px] leading-normal text-muted-foreground">A replacement reopens this unit’s acceptance check for QA review.</p>
            )}
            {draft.kind === "finding" && (
              <LabeledSelect
                required
                label="Attach finding to"
                placeholder="Choose a destination"
                name="target"
                options={destinations}
              />
            )}
            <NoteField label="Observation" name="observation" required maxLength={1000} />
          </FormDialog>
        )}
      </Dialog>
      {feedback && <p role="status">{feedback}</p>}
    </>
  );
}
