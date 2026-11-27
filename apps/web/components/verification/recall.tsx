"use client";
import { useCaseForm, useDecisionFocus } from "@/components/records/case-form";
import { CaseList } from "@/components/records/case-list";
import { WorkspaceLink } from "@/components/workspace/section-tabs";
import { toolHref } from "@/lib/workspace-routes";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonField, LabeledSelect, NoteField, TextField } from "@/components/records/forms";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionLink } from "@/components/records/links";
import { connectionToRecord } from "@/components/records/schema";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import { isQAReviewer } from "@/db/workflows/cases";
import { reviewOutcomes, isRecallCase, inspections, type RecallCase } from "@/db/workflows/recall";

const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const period = (since: string, through: string) => since === through ? since : `${since} – ${through}`;

export default function CalibrationRecall(props: ToolProps) {
  if (props.dossier && isRecallCase(props.dossier)) return <RecallDetail {...props} work={props.dossier} />;

  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold">Corrected certificates</h2>
      <CaseList label="Corrected certificates" rows={props.cases.filter(isRecallCase).map(record => {
        const tasks = props.tasks.filter(task => task.caseId === record.id);
        return {
          record,
          status: tasks.some(task => !task.completedAt) ? "Open QA work" : tasks.length ? "QA work recorded" : "No QA assignments",
          detail: `${record.data.corrected} · ${period(record.data.since, record.data.through)}`,
        };
      })} />
    </section>
  );
}

type Inspection = ReturnType<typeof inspections>[number];

function RecallDetail(props: ToolProps & { work: RecallCase }) {
  const { work, workspace, submit } = props;
  const rows = inspections(work, props);
  const certificate = work.data;
  const [selected, setSelected] = useState<string[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Freeze the reviewed assignment and previous finding when the dialog opens.
  const [review, setReview] = useState<Inspection | null>(null);
  const focusReview = useDecisionFocus(work.history);
  const form = useCaseForm(submit);
  const { pending, error, message, record, setError } = form;
  const person = (id: string) => props.personName(id, id);
  const eligible = rows.filter(row => row.assignable);
  const choice = selected.filter(id => eligible.some(row => row.evidenceId === id));
  const groups = Object.groupBy(rows, row => row.status);

  function queue(event: FormEvent) {
    event.preventDefault();
    if (!actor) return;
    record({ action: "queue", actor, data: { evidenceIds: choice, ownerId: owner, note: reason } }, () => {
      setSelected([]);
      setReason("");
    }, `Queued ${countLabel(choice.length, "inspection")} for QA review.`);
  }

  function inspectionRow(row: Inspection) {
    const { evidence, evidenceId, task, request, decisions } = row;
    return (
      <li key={evidenceId} id={evidenceId} className="grid scroll-mt-20 gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          {row.assignable && evidence ? (
            <label className="inline-flex items-start gap-2 font-medium">
              <input
                className="mt-1 accent-primary" type="checkbox" checked={choice.includes(evidenceId)} disabled={pending}
                onChange={(event) => setSelected(event.target.checked ? [...choice, evidenceId] : choice.filter((id) => id !== evidenceId))}
              />
              {evidence.title}
            </label>
          ) : <p className="font-medium">{evidence?.title ?? evidenceId}</p>}
          <p className="text-xs text-muted-foreground">{row.serial} · {evidence?.unit.revision ?? row.revisionId} · {row.basis}</p>
          <p className="mt-1 text-xs">
            Instrument {row.instrument ?? "Unavailable"} · Capture date {row.captured ?? "Unavailable"}
          </p>
          {evidence && (
            <>
              {evidence.review ? <details className="mt-1 max-w-prose text-xs">
                <summary className="cursor-pointer">Archived review · {evidence.review.decision}</summary>
                <p className="mt-1">{evidence.review.reason}</p>
                <p className="text-muted-foreground">{evidence.review.id} · {formatUtcDateTime(evidence.review.recordedAt)}</p>
              </details> : <p className="mt-1 text-xs">Archived review · Unavailable</p>}
              <ConnectionLink connection={connectionToRecord("verification", evidence)} />
            </>
          )}
          {request && <p className="mt-2 text-xs"
            id={rows.find(entry => entry.request?.id === request.id)?.evidenceId === evidenceId ? request.id : undefined}>
            <strong>Review request</strong> · {String(request.data.certificate ?? "Unavailable")} · {person(request.actor)} · {formatUtcDateTime(request.at)}
            <br />{String(request.data.note)}
            {row.missing && <><br />Missing at assignment · {row.missing}</>}
          </p>}
          {decisions.map((decision) => (
            <p key={decision.id} id={decision.id} tabIndex={-1} className="mt-2 text-xs"><strong>{String(decision.data.outcome)}</strong> · {person(decision.actor)} · {formatUtcDateTime(decision.at)}<br />{String(decision.data.note)}{typeof decision.data.provenanceSource === "string" && <><br />Provenance source · {decision.data.provenanceSource}</>}</p>
          ))}
        </div>
        {task && <div className="grid content-start justify-items-start gap-1">
          <Badge variant="secondary">{task.completedAt ? "Review recorded" : decisions.length ? "Awaiting provenance" : "Queued for QA"}</Badge>
          <span className="text-xs text-muted-foreground">{person(task.owner)}</span>
          {!task.completedAt && row.reviewProblem && <span className="block mt-0.5 text-xs text-muted-foreground">{row.reviewProblem}</span>}
          {!task.completedAt && !row.reviewProblem && evidence && <Button type="button" variant="outline" size="sm"
            aria-label={`Record QA outcome for ${evidence.title}`} onClick={() => {
              setError("");
              setReview(row);
            }}>Record outcome</Button>}
        </div>}
      </li>
    );
  }

  return (
    <section className="grid min-w-0 gap-5" aria-label={work.title}>
      <div>
        <WorkspaceLink direction="back" href={toolHref("recall")}>Certificates</WorkspaceLink>
        <h2 className="mt-2 text-lg font-semibold">{work.title}</h2>
        <p className="text-sm text-muted-foreground">{certificate.corrected} replaces {certificate.previous} · {certificate.instrument}</p>
        <p className="mt-2 max-w-prose text-sm">{certificate.correction}</p>
      </div>
      <div className="text-sm">
        <p><strong>Affected capture dates</strong> · {period(certificate.since, certificate.through)} (inclusive)</p>
        <p className="text-muted-foreground">{certificate.register}</p>
      </div>
      <form onSubmit={queue} className="grid min-w-0 gap-5">
        {(["Matched", "Uncertain"] as const).map((status) => (
          <fieldset key={status} className="min-w-0">
            <legend className="font-semibold">{status} · {groups[status]?.length ?? 0}</legend>
            {groups[status] ? <ul className="divide-y">{groups[status].map(inspectionRow)}</ul>
              : <p className="pt-2 text-sm text-muted-foreground">No inspections in this group.</p>}
          </fieldset>
        ))}
        {groups.Excluded && <details>
          <summary className="cursor-pointer text-sm font-medium">Excluded · {groups.Excluded.length}</summary>
          <ul className="divide-y">{groups.Excluded.map(inspectionRow)}</ul>
        </details>}
        {eligible.length > 0 && <fieldset className="grid min-w-0 max-w-xl gap-3 border-t pt-3">
          <legend className="pr-2 font-semibold">Assign QA review</legend>
          <PersonField
            people={workspace.users.filter(isQAReviewer)}
            label="Review owner"
            placeholder="Choose a reviewer"
            value={owner}
            onChange={setOwner}
          />
          <PersonField people={workspace.actors} value={actor} onChange={setActor} />
          <label className="grid gap-1.5 text-sm font-medium">Reason for review
            <Textarea required maxLength={600} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || !choice.length || !owner || !reason.trim() || !actor}>Queue for QA</Button>
            <span aria-live="polite" className="text-xs text-muted-foreground">{choice.length} selected</span>
          </div>
        </fieldset>}
      </form>
      {!review && message && <p role={error ? "alert" : "status"} className="text-sm">{message}</p>}
      {review?.task && <RecallReview review={review} taskId={review.task.id} owner={person(review.task.owner)}
        certificate={certificate} actors={workspace.actors} form={form}
        onClose={() => { setReview(null); setError(""); }}
        onSaved={id => { focusReview(id); setReview(null); }} />}
    </section>
  );
}


function RecallReview({ review, taskId, owner, certificate, actors, form, onClose, onSaved }: {
  review: Inspection;
  taskId: string;
  owner: string;
  certificate: RecallCase["data"];
  actors: ToolProps["workspace"]["actors"];
  form: ReturnType<typeof useCaseForm>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const choices = reviewOutcomes(review.status);
  const [outcome, setOutcome] = useState<(typeof choices)[number] | null>(null);
  const { pending, error, recordForm } = form;
  const uncertain = review.status === "Uncertain";
  const recover = uncertain && outcome !== null && outcome !== "Provenance unresolved";

  function resolve(event: FormEvent<HTMLFormElement>) {
    recordForm(event, "resolve", { taskId, previousReview: review.decisions[0]?.id ?? null, outcome },
      outcome === "Provenance unresolved" ? "Finding recorded. The QA assignment is still open." : "QA outcome recorded.", onSaved);
  }

  return (
    <Dialog open onOpenChange={open => {
      if (!open && !pending) onClose();
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record QA outcome</DialogTitle>
          <DialogDescription>{review.evidence?.title} · {review.serial} · {review.evidence?.unit.revision}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={resolve}>
          <p className="text-sm">Assigned to {owner}</p>
          <LabeledSelect label="Outcome" value={outcome} onChange={setOutcome} placeholder="Choose an outcome"
            options={choices} />
          {uncertain && <fieldset hidden={!recover} disabled={!recover} className={recover ? "grid gap-2" : "hidden"}>
            <legend className="mb-2 text-sm font-semibold">Recovered provenance</legend>
            {!review.instrument && <LabeledSelect name="instrument" label="Recorded instrument" placeholder="Choose an instrument"
              options={[...new Set(certificate.entries.flatMap(entry => entry.instrument ? [entry.instrument] : []))]
                } />}
            {!review.captured && <TextField label="Capture date" type="date" required max={review.evidence?.recordedAt?.slice(0, 10)} name="captured" />}
            <TextField label="Source reference" required maxLength={160} name="source" />
          </fieldset>}
          <PersonField people={actors} name="actor" required />
          <NoteField label="Findings and source" required maxLength={600} name="note" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-row justify-end">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || !outcome}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
