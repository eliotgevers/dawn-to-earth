"use client";
import { DecisionDialog, useDecisionFocus } from "@/components/records/case-form";
import { RecordResults } from "@/components/records/results";
import { CaseHeading } from "@/components/records/case-list";
import { MissingRecord, WorkspaceLink } from "@/components/workspace/section-tabs";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { setListLocation } from "@/components/workspace/navigation";
import { includesUnit } from "@/components/workspace/selection";
import { Badge } from "@/components/ui/badge";
import { PersonField, LabeledSelect, NoteField, TextField } from "@/components/records/forms";
import { ConnectionList, ConnectionLink } from "@/components/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import { toolHref } from "@/lib/workspace-routes";
import { auditSearchText, findingHistory, isAuditCase, replaySources, subjects, type AuditCase } from "@/db/workflows/audit";

const unavailable = "Unavailable";
export default function AuditReplay(props: ToolProps) {
  const search = useSearchParams().get("q") ?? "";
  const { selectedItem: item } = props;

  if (!item) return null;
  const row = props.dossier;
  if (row && (!isAuditCase(row) || !includesUnit(item, row.unit)))
    return (
      <div className="grid gap-2.5 pt-2 wrap-anywhere">
        <WorkspaceLink direction="back" href={toolHref("audit")}>All decisions</WorkspaceLink>
        <MissingRecord id={row.id} />
      </div>
    );
  if (!row) {
    const cases = props.cases.filter(isAuditCase);
    cases.sort((a, b) => Date.parse(b.data.review.at) - Date.parse(a.data.review.at) || a.id.localeCompare(b.id));
    const archived = new Set(cases.map(row => row.data.review.id));
    const earlier = props.workspace.reviewsWithoutSnapshot.filter(row => includesUnit(item, row.unit) && !archived.has(row.id));
    const records = [...cases, ...earlier];
    if (!records.length) return <p className="mt-0.5 text-xs text-muted-foreground">{unavailable}</p>;
    return (
      <section aria-label="Archived decisions" className="grid gap-2.5 pt-2 wrap-anywhere">
        <RecordResults records={records} searchLabel="Search decisions" emptyMatch={unavailable}
          search={{ value: search, onChange: text => setListLocation(undefined, "q", text || null) }}
          searchText={auditSearchText}>
          {matches => {
            const partial = matches.filter(row => "decision" in row);
            return <>
              <ul className="divide-y">
                {matches.filter(row => "data" in row).map((c) => {
                  const open = findingHistory(c).filter(finding => finding.stage?.next).length;
                  return (
                    <li key={c.id} className="relative grid gap-1 py-3 wrap-anywhere">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Badge variant="secondary">{c.data.review.decision}</Badge>
                        <ConnectionLink id={`audit-case-${c.id}`} sourceId={`audit-case-${c.id}`} className="after:absolute after:inset-0"
                          connection={{ href: toolHref("audit", c.id), label: c.title }} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {c.unit.serial} · {c.unit.revision} · {formatUtcDateTime(c.data.review.at)}
                        {open > 0 && " · " + open + (open === 1 ? " open finding" : " open findings")}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {partial.length > 0 && (
                <section aria-label="Decisions without an archived snapshot">
                  <h3 className="text-[13px] font-semibold">Decisions without an archived snapshot</h3>
                  <ul className="divide-y">
                    {partial.map(({ id, decision, reason, reviewer, recordedAt, unit, source }) => (
                      <li key={id} className="grid gap-1 py-2">
                        <strong>{decision}</strong>
                        <p>{reason}</p>
                        <span className="block mt-0.5 text-xs text-muted-foreground">
                          {reviewer || unavailable} · {formatUtcDateTime(recordedAt)}
                          {" · "}{unit.serial} · {unit.revision}
                        </span>
                        {source ? (
                          <ConnectionLink connection={source} />
                        ) : (
                          <span className="block mt-0.5 text-xs text-muted-foreground">Source evidence · {unavailable}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>;
          }}
        </RecordResults>
      </section>
    );
  }
  return <DecisionDetail row={row} {...props}/>;
}

function DecisionDetail({ row, ...props }: ToolProps & { row: AuditCase }) {
  const restore = useDecisionFocus(row.history, true);
  const { requirement, evidence, review } = row.data;
  const { links, changes, requirementRef } = replaySources(row, props.workspace);
  const histories = findingHistory(row, props.tasks).sort(
    (a, b) =>
      Number(a.last.kind === "finding-closed") - Number(b.last.kind === "finding-closed") ||
      b.first.at.localeCompare(a.first.at),
  );
  const person = (id: string) => props.personName(id, id);
  return (
    <article className="grid gap-2.5 pt-2 wrap-anywhere min-w-0">
      <CaseHeading back="All decisions" record={row} status={review.decision}>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.unit.serial} · {row.unit.revision} · {formatUtcDateTime(review.at)}
        </p>
      </CaseHeading>
      <FindingAction row={row} {...props} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section aria-label="At the decision" className="grid content-start gap-2">
          <h3 className="text-[13px] font-semibold">At the decision</h3>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-medium">
                {row.data.checkId ? "Recorded acceptance criterion" : "Requirement on file"}
              </dt>
              <dd>{requirement.expected}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">Requirement · {requirementRef ?? requirement.id}</dd>
            </div>
            <div>
              <dt className="font-medium">Evidence</dt>
              <dd>{evidence.source}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">{formatUtcDateTime(evidence.at)}</dd>
              <dd>{evidence.observation}</dd>
              {row.data.checkId && <dd>Recorded result · {evidence.observed || unavailable}</dd>}
              {evidence.interval && (
                <dd>
                  Frames {evidence.interval.start}–{evidence.interval.end}
                </dd>
              )}
            </div>
            <div>
              <dt className="font-medium">Decision reason</dt>
              <dd>{review.reason}</dd>
            </div>
            <div>
              <dt className="font-medium">Reviewer</dt>
              <dd>{review.actor ?? unavailable}</dd>
            </div>
          </dl>
        </section>
        <section aria-label="Recorded afterwards" className="grid content-start gap-2 text-sm">
          <h3 className="text-[13px] font-semibold">Recorded afterwards</h3>
          {changes.length ? (
            <ol className="divide-y">
              {changes.map((c) => (
                <li key={c.id} className="py-1.5">
                  <time className="block mt-0.5 text-xs text-muted-foreground" dateTime={c.at}>
                    {formatUtcDateTime(c.at)}
                  </time>
                  <strong>{c.title}</strong>
                  <p>{c.detail}</p>
                  {c.reviewer !== undefined && (
                    <span className="block mt-0.5 text-xs text-muted-foreground">Reviewer · {c.reviewer ?? unavailable}</span>
                  )}
                  {c.link && (
                    <ConnectionLink connection={c.link} />
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p>{unavailable}</p>
          )}
        </section>
      </div>
      <ConnectionList links={links} title="Current source records" />
      <section className="grid gap-2" aria-label="Audit findings">
        <h3 className="text-[13px] font-semibold">Audit findings</h3>
        {histories.length ? (
          <ol className="divide-y">
            {histories.map(finding => {
              const { first, stage, task } = finding;
              return (
                <li
                  id={String(first.data.findingId)}
                  key={first.id}
                  tabIndex={-1}
                  className="scroll-mt-[calc(var(--header)+12px)] grid gap-2 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{stage?.status ?? unavailable}</Badge>
                    <strong>{subjects[first.data.subject as keyof typeof subjects]} finding</strong>
                  </div>
                  <p id={first.id}>{String(first.data.reason)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Raised by {person(first.actor)} · {formatUtcDateTime(first.at)}
                  </p>
                  {finding.history.slice(1).map((ev) => (
                    <div key={ev.id} id={ev.id}>
                      <strong>{ev.title}</strong>
                      <p>{String(ev.data.reason)}</p>
                      {ev.data.reference ? <p>Reference · {String(ev.data.reference)}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {person(ev.actor)} · {formatUtcDateTime(ev.at)}
                      </p>
                    </div>
                  ))}
                  {stage?.next && task && (
                    <div className="flex flex-wrap items-center gap-2">
                      <FindingAction row={row} {...props} finding={finding} mode={stage.next} onSaved={restore} />
                      <span className="block mt-0.5 text-xs text-muted-foreground">Assigned to {person(task.owner)}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">{unavailable}</p>
        )}
      </section>
    </article>
  );
}

type Mode = "raise" | "respond" | "review";
const actions = { raise: "Raise finding", respond: "Record follow-up", review: "Review response" };
const noteLabels = {
  raise: "What is missing or inconsistent?",
  respond: "Work completed",
  review: "Decision reason",
};

function FindingAction({
  row,
  finding,
  workspace,
  submit,
  onSaved,
  mode = "raise",
}: ToolProps & {
  row: AuditCase;
  finding?: ReturnType<typeof findingHistory>[number];
  mode?: Mode;
  onSaved?: (event: string, finding: string) => void;
}) {
  const [draft, setDraft] = useState<{ finding?: typeof finding; subject?: string }>({});
  const { first, last } = draft.finding ?? {};
  const { subject } = draft;
  const subjectDescription: Record<string, string> = {
    requirement: row.data.requirement.expected,
    evidence: row.data.evidence.source,
    review: row.data.review.reason,
  };
  return (
    <DecisionDialog heading={actions[mode]} variant={finding ? "outline" : "default"} showRole
      description={[row.unit.serial, row.unit.revision, row.title].join(" · ")}
      people={workspace.actors} submit={submit} onOpen={() => setDraft({ finding })}
      command={fields => {
        if (finding?.last.id !== last?.id) return "This finding changed. Reopen the current action.";
        const subject = fields.subject as keyof typeof subjects;
        const action = mode === "review" ? fields.decision : mode;
        if (!action) return "Choose a closure decision.";
        if (mode === "raise" && (!subject || !fields.owner)) return "Choose a record and follow-up owner.";
        return {
          action: String(action),
          data: { unit: row.unit.serial, revision: row.unit.revisionId, decisionId: row.data.review.id,
            sourceId: row.data[subject]?.id, findingId: first?.data.findingId, previousId: last?.id },
        };
      }}
      saved={event => { if (first) onSaved?.(event, String(first.data.findingId)); }}>
      {first && (
        <div className="grid gap-1">
          <strong>Finding</strong>
          <p id={first.id}>{String(first.data.reason)}</p>
          {last && last.id !== first.id && (
            <>
              <strong>{last.title}</strong>
              <p>{String(last.data.reason)}</p>
              {last.data.reference ? <p>Reference · {String(last.data.reference)}</p> : null}
            </>
          )}
        </div>
      )}
      {mode === "raise" && (
        <>
          <LabeledSelect<string>
            label="Record with a gap"
            name="subject"
            placeholder="Choose a record"
            required
            value={subject || null}
            onChange={value => setDraft({ ...draft, subject: value ?? undefined })}
            options={Object.entries(subjects).map(([value, label]) => ({ value, label }))}
          />
          {subject && <p className="mt-0.5 text-xs text-muted-foreground">{subjectDescription[subject]}</p>}
          <PersonField people={workspace.users} label="Follow-up owner" name="owner" required showRole />
        </>
      )}
      {mode === "review" && (
        <LabeledSelect<string>
          label="Closure decision"
          name="decision"
          required
          options={[
            { value: "close", label: "Close finding" },
            { value: "return", label: "Return to owner" },
          ]}
        />
      )}
      {mode === "respond" && (
        <TextField label="Follow-up reference" name="reference" required maxLength={200} />
      )}
      <NoteField label={noteLabels[mode]} name="reason" rows={3} maxLength={1200} required />
    </DecisionDialog>
  );
}
