"use client";
import { shortNoteField } from "@/components/records/presentation";
import { useCaseForm } from "@/components/records/case-form";
import { CaseHeading, CaseList, DecisionHistory } from "@/components/records/case-list";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "@/components/records/links";
import { PersonField, LabeledSelect, TextField, NoteField } from "@/components/records/forms";
import { connectionToRecord } from "@/components/records/schema";
import { recordConnection, recordHref } from "@/lib/records/links";
import type { ToolProps } from "@/components/workspace/workbench";
import {
  isRecoveryCase,
  reviewedRecovery,
  recoveryReview,
  type RecoveryCase,
} from "@/db/workflows/recovery";

export default function SupplierRecoveryDesk(props: ToolProps) {
  const { dossier } = props;
  if (dossier && isRecoveryCase(dossier)) return <RecoveryRecord {...props} record={dossier} />;
  return <CaseList label="Supplier recovery cases" rows={props.cases.filter(isRecoveryCase).map(record => {
    const { status } = recoveryReview(record, props.workspace);
    const ownerId = props.tasks.find(task => task.caseId === record.id && !task.completedAt)?.owner;
    return {
      record,
      detail: [record.unit.serial, record.unit.revision, props.personName(ownerId, "")].filter(Boolean).join(" · "),
      status,
    };
  })} />;
}

function RecoveryRecord({ record, workspace, tasks, submit, personName }: ToolProps & { record: RecoveryCase }) {
  const review = recoveryReview(record, workspace);
  const { issue, problem, history, last, status, limitation, reviewer } = review;
  const approved = reviewedRecovery(record, history);
  const previousId = last?.id ?? null;

  const [revising, setRevising] = useState(false);
  const { pending, error, message, recordForm } = useCaseForm(submit);
  const showRevise = !problem && last?.kind === "recovery-reviewed" && !revising;
  const owner = tasks.find(task => task.caseId === record.id && !task.completedAt)?.owner
    ?? reviewer?.owner ?? (!problem && !showRevise ? "technician" : undefined);
  return (
    <article className="grid min-w-0 gap-4 pt-2 wrap-anywhere">
      <CaseHeading record={record} back="All recovery cases" status={status === "Choose a recovery" ? undefined : status}>
        {owner && <p className="text-sm">Assigned to {personName(owner)}</p>}
        <p className="text-xs text-muted-foreground">
          {record.unit.serial} · {record.unit.revision} · {record.data.receipt}
        </p>
        <p>{record.data.finding}</p>
      </CaseHeading>
      {approved && (
        <p>
          <strong>Reviewed document forecast · {approved.readyOn}</strong>
          <br />
          <span className="block mt-0.5 text-xs text-muted-foreground">
            {approved.title} · Receiving and evidence acceptance keep their own decisions.
          </span>
        </p>
      )}
      {limitation && <p role="status">{limitation}</p>}
      {showRevise ? (
        <Button className="w-fit" size="sm" variant="outline" onClick={() => setRevising(true)}>
          Revise recovery
        </Button>
      ) : (reviewer || !problem) && (
        <section
          id={record.data.issueId}
          tabIndex={-1}
          aria-labelledby="recovery-action"
          className="scroll-mt-[calc(var(--header)+12px)] grid gap-3"
        >
          <RecoveryRequest review={review} />
          <RecoveryForm
            key={previousId}
            record={record}
            review={review}
            actors={workspace.actors}
            saving={pending}
            save={(event, action) => recordForm(event, action, { previousId }, "Saved to recovery history.", () => setRevising(false))}
            cancel={revising ? () => setRevising(false) : undefined}
          />
        </section>
      )}
      <output className="empty:hidden" role={error ? "alert" : "status"}>
        {message}
      </output>
      <ConnectionList
        title="Recovery handoff"
        links={[
          issue ? connectionToRecord("production", { ...issue, unit: record.unit })
            : recordConnection("production", record.data.issueId, record.unit, {
              view: "Issues", label: "Record unavailable", identity: record.data.issueId, unavailable: true,
            }),
          {
            href: recordHref("production", "reservation-" + encodeURIComponent(record.data.planningTaskId), record.unit, { view: "planning" }),
            location: "Production · Planning", label: "Supplier reservation", identity: record.data.planningTaskId,
          },
          recordConnection("verification", record.data.checkId, record.unit, {
            view: "Acceptance review", label: "Handoff receipt", identity: record.unit.serial,
          }),
        ]}
      />
      {history.length > 0 && (
        <section className="grid gap-1" aria-labelledby="recovery-history">
          <h3 className="text-[13px] font-semibold" id="recovery-history">Recovery history</h3>
          <DecisionHistory events={history} name={id => personName(id, id)} rowClass="grid gap-0.5 py-2">
            {event => <>
              <p>{String(event.data.rationale)}</p>
              {event.data.scopeChange ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{String(event.data.scopeChange)}</p>
              ) : null}
              {event.data.reference ? (
                <p className="mt-0.5 text-xs text-muted-foreground">Engineering reference · {String(event.data.reference)}</p>
              ) : null}
              {event.kind === "recovery-proposed" && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {String(event.data.source)} · Document expected {String(event.data.readyOn)}
                </p>
              )}
            </>}
          </DecisionHistory>
        </section>
      )}
    </article>
  );
}

function RecoveryRequest({ review }: { review: ReturnType<typeof recoveryReview> }) {
  const { reviewer, proposal, last, basis } = review;
  return <>
    <h3 className="text-[13px] font-semibold" id="recovery-action">{reviewer?.heading ?? "Compare recovery options"}</h3>
    {last?.kind === "recovery-returned" && <p><strong>Reason for return</strong> · {String(last.data.rationale)}</p>}
    {proposal && basis && (
      <div className="grid gap-1">
        <p>
          <strong>{basis.title}</strong> · Proposed document date {String(proposal.data.readyOn)}
        </p>
        <p>{String(proposal.data.rationale)}</p>
        <dl className="grid gap-1 text-sm">
          <div>
            <dt className="inline font-medium">Document basis · </dt>
            <dd className="inline">{String(proposal.data.source)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Scope of approval · </dt>
            <dd className="inline">{basis.approval}</dd>
          </div>
        </dl>
        {last?.kind === "substitute-basis-recorded" && (
          <p>
            Engineering basis · {String(last.data.reference)} · {String(last.data.rationale)}
          </p>
        )}
      </div>
    )}
  </>;
}

function RecoveryForm({
  record,
  review,
  actors,
  saving,
  save,
  cancel,
}: {
  record: RecoveryCase;
  review: ReturnType<typeof recoveryReview>;
  actors: ToolProps["workspace"]["actors"];
  saving: boolean;
  save: (event: React.FormEvent<HTMLFormElement>, action: string) => void;
  cancel?: () => void;
}) {
  const [actor, setActor] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const option = record.data.alternatives.find((o) => o.key === choice);
  const { reviewer, problem, limitation } = review;
  return (
    <form
      className="grid min-w-0 gap-3"
      onSubmit={event => save(event, reviewer ? choice : "propose")}
    >
      {!reviewer ? (
        <>
          <fieldset className="grid min-w-0 gap-3 lg:grid-cols-3">
            <legend className="sr-only">Recovery options</legend>
            {record.data.alternatives.map((o) => (
              <label
                key={o.key}
                className="group grid min-w-0 cursor-pointer content-start gap-1.5 rounded-md border border-border p-3 has-checked:border-primary focus-within:ring-2 focus-within:ring-ring"
              >
                <span className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="option"
                    className="mt-1"
                    required
                    checked={o.key === choice}
                    value={o.key}
                    aria-label={o.title}
                    aria-describedby={"basis-" + o.key}
                    onChange={() => setChoice(o.key)}
                  />
                  <strong>{o.title}</strong>
                </span>
                <span className="text-sm font-medium">Earliest · {o.earliest}</span>
                <span id={"basis-" + o.key} className="hidden gap-2 group-has-checked:grid lg:grid">
                  {[["Material", o.material], ["Documentation", o.document], ["Approval", o.approval]].map(([label, value]) => (
                    <span key={label} className="text-sm">
                      <strong>{label}</strong><br />{value}
                    </span>
                  ))}
                  <span className="block mt-0.5 text-xs text-muted-foreground">{o.source}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {option && (
            <TextField label="Expected document date" labelClassName="max-w-xs"
              key={option.key} type="date" name="readyOn" required
              min={option.earliest} defaultValue={option.earliest} />
          )}
        </>
      ) : (
        <>
          <div className="max-w-sm">
            <LabeledSelect<string>
              label="Decision"
              value={choice}
              placeholder="Choose a decision"
              required
              onChange={(value) => setChoice(value ?? "")}
              options={[
                ...(limitation ? [] : [reviewer.decision]),
                { value: "return", label: problem ? "Close outstanding review" : "Return to record owner" },
              ]}
            />
          </div>
          {choice === "record-basis" && (
            <TextField label="Engineering decision reference" name="reference" required maxLength={150} />
          )}
        </>
      )}
      <NoteField label={reviewer ? "Decision reason" : "Reason for recovery"} className={shortNoteField} name="rationale" required maxLength={1500} rows={2} />
      <PersonField people={actors} name="actor" value={actor} onChange={setActor} />
      <div className="flex flex-wrap items-center gap-2">
        {cancel && (
          <Button type="button" variant="outline" size="sm" onClick={cancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={saving || !actor || (reviewer && !choice)}>
          {reviewer
            ? "Record decision"
            : option?.key === "substitute"
              ? "Request Engineering review"
              : "Route to Quality"}
        </Button>
      </div>
    </form>
  );
}
