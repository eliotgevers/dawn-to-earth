"use client";
import { useCaseForm, useDraftRows } from "@/components/records/case-form";
import { CaseHeading, CaseList, DecisionHistory, ComparedValues } from "@/components/records/case-list";

import { ClaimReview, type DraftJudgment } from "./claim-review";
import { agreementConnection } from "@/db/workflows/agreements";
import { unitSelection } from "@/components/workspace/selection";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonField, LabeledSelect, NoteField, TextField } from "@/components/records/forms";
import { ConnectionList } from "@/components/records/links";
import { methods } from "@/components/verification/model";
import { recordConnection, recordHref, recordLabel, type RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkCase, WorkEvent, WorkTask } from "@/db/workflows/cases";
import {
  comparison,
  reviewedTarget,
  compareStudy,
  outcomes,
  clauseCoverage,
  findingOutcomes,
  lastFinding,
  proposedBasis,
  proposalSource,
  reviewState,
  proposalJudgments,
  sourceOptions,
  type Comparison,
  type ObservationSheet,
} from "@/db/workflows/qualification";

export default function QualificationView(props: ToolProps) {
  const { dossier: record } = props;
  if (record) return <ComparisonReview record={record} {...props} />;
  return (
    <section className="grid gap-2.5 pt-2 wrap-anywhere" aria-label="Qualification comparisons">
      <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
        Compare a requirement with an archived qualification report and assign any uncovered clauses for verification.
      </p>
      <CaseList label="Requirements to compare" rows={props.cases.map(record => {
        const basis = comparison(record);
        const { status } = reviewState(record);
        const open = props.tasks.filter(task => task.caseId === record.id && !task.completedAt).length;
        return {
          record,
          detail: [basis.requirement, basis.revision, record.unit?.serial].filter(Boolean).join(" · "),
          filter: status,
          status: open ? `${status} · ${open} open` : status,
        };
      })} />
    </section>
  );
}

function ComparisonReview({ record, cases, tasks, workspace, personName, submit }: ToolProps & { record: WorkCase }) {
  const { history, proposal, decision, status, canPropose: editable } = reviewState(record);
  const sources = sourceOptions(record, cases);
  const current = comparison(record);
  const [sourceId, setSourceId] = useState(() => proposalSource(sources, proposal?.data)?.id);
  const draft = useDraftRows<DraftJudgment>(() => proposalJudgments(proposal).map(row => [row.rowId, row]));
  const basis = editable ? comparison(record, sources.find(source => source.id === sourceId) ?? record) : proposedBasis(current, proposal);
  const judgments = editable ? draft.rows : new Map(proposalJudgments(proposal).map(row => [row.rowId, row]));
  const { pending, message: feedback, recordForm: save } = useCaseForm(submit);
  const controls = { people: workspace.actors, pending, save };
  const name = (id: string) => personName(id, id);
  const assignments = tasks.filter(task => task.eventId === decision?.id && task.section === "verification");
  const openAssignments = assignments.filter(task => !task.completedAt).length;
  const target = reviewedTarget(basis, record.unit, editable ? undefined : proposal);

  return (
    <article className="grid gap-2.5 pt-2 wrap-anywhere min-w-0" aria-label={record.title}>
      <CaseHeading record={record} back="Comparisons" status={status}>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {basis.requirement} · {basis.revision}{target.unit && " · " + target.unit.serial}
        </p>
        <p>{basis.statement}</p>
        {basis.targetCriterion && <p className="mt-0.5 text-xs text-muted-foreground">Acceptance criterion · {basis.targetCriterion}</p>}
      </CaseHeading>
      <ComparisonSources
        basis={basis}
        alternatives={editable ? sources : []}
        selectReport={sourceId => {
          setSourceId(sourceId);
          draft.clear();
        }}
      />
      {basis.sheet && <SheetComparison key={`sheet-${basis.report}`} report={basis.report} sheet={basis.sheet} />}
      {decision?.kind === "reuse-returned" && (
        <p>
          <strong>Returned for revision</strong> · {String(decision.data.reason)}
        </p>
      )}
      <ClauseComparison
        key={basis.sourceId ?? basis.report}
        basis={basis}
        judgments={judgments}
        setChoice={draft.update}
        editable={editable}
        endorsed={decision?.kind === "reuse-endorsed"}
        assignments={assignments}
        history={history}
        {...controls}
      />
      <QualificationDecision key={proposal?.id ?? "draft"}
        basis={basis}
        proposal={proposal}
        decision={decision}
        openAssignments={openAssignments}
        editable={editable}
        judgments={[...judgments.values()]}
        name={name}
        {...controls}
      />
      {feedback && <p role="status">{feedback}</p>}
      <QualificationBasis workspace={workspace} basis={basis} target={target} openAssignments={openAssignments} />
      {history.length > 0 && <ReviewHistory history={history} current={current} name={name} />}
    </article>
  );
}

function QualificationBasis({ workspace, basis, target, openAssignments }: {
  workspace: ToolProps["workspace"];
  basis: Comparison;
  target: ReturnType<typeof reviewedTarget>;
  openAssignments: number;
}) {
  const evidence = workspace.evidence.find(entry => entry.id === basis.evidenceId);
  const scope = { item: target.selection };
  const links: RecordConnection[] = [];
  if (evidence) links.push(recordConnection("verification", evidence.id, evidence.unit, {
    view: methods[evidence.test].label, label: `Source report · ${basis.report}`, identity: basis.reportTitle,
  }));
  for (const { scope, unit, requirementIds } of workspace.acknowledgedAgreements) {
    if (unit.revisionId !== basis.revisionId || !requirementIds.includes(basis.requirementId)) continue;
    if (target.selection.startsWith("unit:") && target.selection !== unitSelection(unit.serial, unit.revisionId)) continue;
    links.push(agreementConnection(scope, [unitSelection(unit.serial, unit.revisionId)]));
  }
  if (openAssignments) links.push({
    href: recordHref("verification", undefined, undefined, scope),
    location: "Verification · Overview", label: "Assigned work", identity: basis.requirement,
  });
  links.push({
    href: recordHref("engineering", basis.requirementId, undefined, scope),
    location: "Engineering · Requirements", label: recordLabel("requirement", basis.requirement, basis.statement), identity: basis.statement,
  });

  return <>
    <ConnectionList title="Qualification basis" links={links} article="qualification-acceptance" />
    {basis.evidenceId && !evidence && <p className="text-sm text-muted-foreground">
      Original evidence unavailable · {basis.report}
    </p>}
  </>;
}

type FormControls = {
  people: ToolProps["workspace"]["actors"];
  pending: boolean;
  save: ReturnType<typeof useCaseForm>["recordForm"];
};

function GapAssignment({
  task,
  history,
  people,
  pending,
  save,
}: FormControls & { task: WorkTask; history: WorkEvent[] }) {
  const finding = lastFinding(history, task.id);
  const owner = people.find(person => person.id === task.owner);
  return (
    <details id={task.sourceId}>
      <summary className="cursor-pointer text-sm font-medium">
        {task.completedAt ? "Finding recorded" : "Open verification assignment"} ·{" "}
        {owner ? owner.name + " · " + owner.role : task.owner}
      </summary>
      <p className="py-2">{task.title}</p>
      {finding && (
        <p className="mb-2 text-sm">
          <strong>{String(finding.data.outcome ?? "Finding recorded")}</strong> ·{" "}
          {String(finding.data.source)} · {String(finding.data.observation)}
        </p>
      )}
      {!task.completedAt && (
        <form
          key={finding?.id ?? task.id}
          className="grid max-w-xl gap-3"
          onSubmit={(event) => save(event, "document-gap", {
            taskId: task.id,
            previousFindingId: finding?.id ?? null,
          }, "Verification finding recorded.")}
        >
          <LabeledSelect
            name="outcome"
            label="Finding"
            options={findingOutcomes}
            required
          />
          <TextField label="Archive reference checked" name="source" required maxLength={160} />
          <NoteField label="Observation" name="observation" required maxLength={1000} />
          <PersonField people={people} name="actor" required showRole />
          <Button type="submit" size="sm" variant="outline" className="w-fit" disabled={pending}>
            Record finding
          </Button>
        </form>
      )}
    </details>
  );
}

function ReviewHistory({
  history,
  current,
  name,
}: {
  history: WorkEvent[];
  current: Comparison;
  name: (id: string) => string;
}) {
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium">Decision history ({history.length})</summary>
      <DecisionHistory events={history} name={name}>
        {event => {
          if (event.kind !== "reuse-proposed") return <p>{String(event.data.reason ?? event.data.observation)}</p>;
          const judgments = proposalJudgments(event);
          const rows = proposedBasis(current, event).rows;
          return <div>
            <strong>{String(event.data.report)}</strong>
            {judgments.length ? <ul>{judgments.map(row => (
              <li key={row.rowId}>
                {rows.find(source => source.id === row.rowId)?.title ?? row.rowId} · {outcomes[row.outcome]} · {row.reason}
                {row.citations?.length ? <p className="mt-0.5 text-xs text-muted-foreground">Cited · {row.citations.join(" · ")}</p> : null}
              </li>
            ))}</ul> : <p>All clauses sent for new verification.</p>}
          </div>;
        }}
      </DecisionHistory>
    </details>
  );
}

function ClauseComparison({
  basis,
  judgments, setChoice,
  editable,
  endorsed,
  assignments,
  history,
  ...controls
}: FormControls & {
  basis: Comparison;
  judgments: ReadonlyMap<string, DraftJudgment>;
  setChoice: (id:string, j?:DraftJudgment)=>void;
  editable: boolean;
  endorsed: boolean;
  assignments: WorkTask[];
  history: WorkEvent[];
}) {
  const tasksByClause = new Map(assignments.map((task) => [task.sourceId, task]));
  return (
    <ul className="divide-y" aria-label="Clause comparison">
      {basis.rows.map((row) => {
        const choice = judgments.get(row.id);
        const analysis = row.study && compareStudy(row.study, choice?.assumption);
        const result = analysis?.result ?? clauseCoverage(row);
        const used = choice?.outcome === "applies";
        const task = tasksByClause.get(row.id);
        return (
          <li
            key={row.id}
            id={task ? undefined : row.id}
            tabIndex={task ? undefined : -1}
            className="grid min-w-0 gap-2 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold">{row.title}</h3>
              <Badge variant="outline">{result}</Badge>
            </div>
            <ComparedValues className="gap-x-5 gap-y-2" before={["Required", row.expected]}
              after={[row.locator ? "Archived finding · " + row.locator : "Archived finding", row.recorded ?? "Unavailable"]} />
            {row.study && analysis && <ClaimReview study={row.study} analysis={analysis} rowId={row.id} title={row.title} draft={choice} editable={editable} onChange={j=>setChoice(row.id,j)}/>}
            {row.study && (editable || used) ? null : editable && result === "Match" ? (
              <>
                <label className="inline-flex w-fit items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={used}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setChoice(row.id, checked ? {rowId:row.id,outcome:"applies",assumption:"recorded",reason:""} : undefined);
                    }}
                  />
                  Propose reuse<span className="sr-only"> for {row.title}</span>
                </label>
                {used && (
                  <NoteField label={<>Reuse rationale<span className="sr-only"> for {row.title}</span></>}
                    labelClassName="max-w-2xl" form="qualification-proposal" required maxLength={1000}
                    value={choice.reason} onChange={e => setChoice(row.id, { ...choice, reason: e.target.value })} />
                )}
              </>
            ) : !editable && used ? (
              <p className="text-sm">
                <strong>{endorsed ? "Reuse endorsed" : "Proposed reuse"}</strong> · {choice.reason}
              </p>
            ) : task ? (
              <GapAssignment task={task} history={history} {...controls} />
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">Needs verification · {row.followUp}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SheetComparison({ report, sheet }: { report: string; sheet: ObservationSheet }) {
  const [selected, setSelected] = useState<string | null>(null);
  const view = sheet.views.find(entry => entry.label === selected) ?? sheet.views[0];
  return (
    <section aria-label={report + " source comparison"} className="grid min-w-0 gap-3">
      <div className="grid items-end gap-2 sm:grid-cols-2">
        <h3 className="text-[13px] font-semibold">{report} · Observation sheet</h3>
        <LabeledSelect label="Compare window view" value={view.label}
          options={sheet.views.map(entry => entry.label)}
          onChange={value => { if (value) setSelected(value); }} />
      </div>
      <div className="grid grid-cols-2 gap-3" aria-live="polite">
        {[sheet.control, view].map(entry => (
          <figure key={entry.label} className="grid min-w-0 content-start gap-1">
            {entry.crop ? (
              <svg viewBox={entry.crop.join(" ")} role="img" aria-label={entry.label + ". " + entry.observation}
                className="aspect-[146/74] w-full rounded-md bg-muted">
                <image href={`/inspection/${encodeURIComponent(sheet.file)}`} width={sheet.width} height={sheet.height} />
              </svg>
            ) : <div className="grid aspect-[146/74] place-items-center rounded-md bg-muted text-sm">Unavailable</div>}
            <figcaption className="text-sm"><strong>{entry.label}</strong><br />{entry.observation}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function ComparisonSources({
  basis,
  alternatives,
  selectReport,
}: {
  basis: Comparison;
  alternatives: WorkCase[];
  selectReport: (sourceId: string) => void;
}) {
  const chooseReport = alternatives.length > 1;
  return <ComparedValues className="gap-3 rounded-lg bg-muted/45 p-3"
    before={["Requested baseline", basis.baseline]}
    after={[
      chooseReport ? <LabeledSelect
        label="Prior qualification report"
        value={basis.sourceId}
        options={alternatives.map(source => ({
          value: source.id,
          label: `${source.data.report} · ${source.data.sourceFor ? source.title : source.data.reportTitle}`,
        }))}
        onChange={id => { if (id) selectReport(id); }}
      /> : "Prior qualification evidence",
      <>
        {!chooseReport && <p>{basis.report} · {basis.reportTitle}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{basis.previousBaseline}</p>
      </>,
    ]}
  />;
}

function QualificationDecision({
  basis,
  proposal,
  decision,
  openAssignments,
  editable,
  judgments,
  name,
  people,
  pending,
  save,
}: FormControls & {
  basis: Comparison;
  proposal?: WorkEvent;
  decision?: WorkEvent;
  openAssignments: number;
  editable: boolean;
  judgments: DraftJudgment[];
  name: (id: string) => string;
}) {
  const [outcome, setOutcome] = useState<"endorse" | "return" | null>(null);
  const reused = judgments.filter(row => row.outcome === "applies").length;
  const gapCount = basis.rows.length - reused;
  if (!editable && decision) return (
    <section className="grid gap-2 border-t pt-3" aria-label="Verification work">
      <h3 className="text-[13px] font-semibold">Verification work</h3>
      <p>{reused} of {basis.rows.length} clauses endorsed for design reuse · {openAssignments} open {openAssignments === 1 ? "assignment" : "assignments"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {name(decision.actor)} · {formatUtcDateTime(decision.at)} · {String(decision.data.reason)}
      </p>
    </section>
  );
  const reviewing = !editable && proposal;
  return (
    <form key={reviewing ? "review" : "proposal"} id={reviewing ? undefined : "qualification-proposal"}
      className="grid max-w-xl gap-3 border-t pt-3"
      onSubmit={event => reviewing ? save(event, "review", { proposalId: reviewing.id }, "Review recorded.") : save(event, "propose", {
        report: basis.report, sourceId: basis.sourceId, judgments, previousProposalId: proposal?.id ?? null,
      }, "Proposal saved for review.")}>
      <h3 className="text-[13px] font-semibold">{reviewing ? "Review proposal" : "Submit for review"}</h3>
      {reviewing ? <>
        <p className="mt-0.5 text-xs text-muted-foreground">Submitted by {name(reviewing.actor)} · {formatUtcDateTime(reviewing.at)}</p>
        <LabeledSelect label="Decision" name="outcome" value={outcome} onChange={setOutcome} required options={[
          { value: "endorse", label: "Endorse proposed coverage" },
          { value: "return", label: "Return for revision" },
        ]} />
        <NoteField label="Decision reason" name="reason" required maxLength={1000} />
      </> : <p>{reused} of {basis.rows.length} clauses proposed for reuse · {gapCount} for verification</p>}
      <PersonField people={people} name="actor" label={reviewing ? "Reviewed by" : "Proposed by"} required showRole />
      {reviewing && outcome === "endorse" && gapCount > 0 && (
        <PersonField people={people} name="owner" required showRole
          label={`Verification owner (${gapCount} open ${gapCount === 1 ? "clause" : "clauses"})`} />
      )}
      <Button type="submit" size="sm" disabled={pending} className="w-fit">{reviewing ? "Record decision" : "Submit proposal"}</Button>
    </form>
  );
}
