"use client";
import { fieldLabel } from "@/components/records/presentation";
import { CaseHeading, CaseList, DecisionHistory } from "@/components/records/case-list";

import { useState } from "react";
import { useCaseForm } from "@/components/records/case-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionList, ConnectionLink } from "@/components/records/links";
import { PersonField, LabeledSelect } from "@/components/records/forms";
import { connectionToRecord } from "@/components/records/schema";
import { acceptanceReviewConnection } from "@/components/verification/acceptance";
import { recordConnection, type RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import { isTraveler, travelerRecord, type Traveler } from "@/db/workflows/traveler";

export default function TravelerWorkbench(props: ToolProps) {
  const { dossier } = props;
  if (dossier && isTraveler(dossier)) return <ReleasedTraveler {...props} row={dossier} />;
  return (
    <CaseList label="Released travelers" rows={props.cases.filter(isTraveler).map(record => ({
      record,
      title: `${record.unit.serial} · ${record.title}`,
      detail: `${record.unit.revision} · Traveler ${record.data.edition}`,
      status: travelerRecord(record, props).status,
    }))} />
  );
}

function ReleasedTraveler(props: ToolProps & { row: Traveler }) {
  const { row, personName: name } = props;
  const [actor, setActor] = useState<string | null>(null);
  const form = useCaseForm(props.submit);
  const state = travelerRecord(row, props);
  const links: RecordConnection[] = [];
  if (state.issue)
    links.push(connectionToRecord("production", state.issue));
  const activeStep = !state.unavailable && !state.pause && state.next?.id;
  if (state.check && (!activeStep || !state.needsEvidence))
    links.push(acceptanceReviewConnection(state.check));
  const action = (
    <section id="traveler-action" aria-label="Traveler action">
      <TravelerAction
        key={state.target.previousId}
        row={row}
        state={state}
        actors={props.workspace.actors}
        actor={actor}
        setActor={setActor}
        form={form}
      />
    </section>
  );
  return (
    <article className="grid min-w-0 gap-5">
      <CaseHeading record={row} back="Released travelers" status={state.status}>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.unit.serial} · {row.unit.revision} · Traveler {row.data.edition}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state.build ? (
            <ConnectionLink connection={connectionToRecord("production", state.build)} />
          ) : "Work order · Unavailable"}
        </p>
      </CaseHeading>
      {state.pause && (
        <section aria-label="Open discrepancy" className="grid gap-1 border-l-2 pl-3">
          <strong className="text-sm">Open discrepancy</strong>
          <p className="wrap-break-word text-sm">{String(state.pause.data.note)}</p>
          <span className="block mt-0.5 text-xs text-muted-foreground">
            {state.assignedAction === "resume" ? "Resume assigned to" : "Disposition assigned to"}{" "}
            {name(state.owner)}
          </span>
          {state.disposition && (
            <p className="mt-0.5 text-xs text-muted-foreground">Disposition · {String(state.disposition.data.note)}</p>
          )}
        </section>
      )}
      {!activeStep && action}
      <section aria-labelledby="traveler-steps">
        <h3 id="traveler-steps" className="text-sm font-semibold">
          Released steps
        </h3>
        <ol className="divide-y">
          {row.data.steps.map((step) => (
            <li key={step.id} className="grid gap-2 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm">{step.label}</span>
                <span className="block mt-0.5 text-xs text-muted-foreground">{step.id === "handoff" && state.outdated ? "Evidence changed"
                  : state.completed.has(step.id) ? "Recorded" : step.id === state.next?.id ? "Next" : "Upcoming"}</span>
              </div>
              {step.id === activeStep && action}
            </li>
          ))}
        </ol>
      </section>
      <p role="status" className={form.message ? "mt-0.5 text-xs text-muted-foreground" : "sr-only"}>
        {form.message}
      </p>
      <ConnectionList title="Traveler handoff" links={links} />
      <TravelerHistory row={row} state={state} name={name} />
    </article>
  );
}

type TravelerState = ReturnType<typeof travelerRecord>;

function TravelerHistory({
  row,
  state,
  name,
}: {
  row: Traveler;
  state: TravelerState;
  name: (id: unknown) => string;
}) {
  return (
    <section aria-labelledby="traveler-history">
      <h3 id="traveler-history" className="text-sm font-semibold">
        Work history
      </h3>
      {state.history.length ? (
        <DecisionHistory events={state.history} name={name} anchor={event => event.id} rowClass="grid gap-1 py-2 text-sm">
          {e => <>
            <span className="wrap-break-word">{String(e.data.note)}</span>
            {e.data.inspected &&
            typeof e.data.inspected === "object" &&
            "expected" in e.data.inspected &&
            "observed" in e.data.inspected &&
            "source" in e.data.inspected ? (
              <span className="block mt-0.5 text-xs text-muted-foreground">
                Required {String(e.data.inspected.expected)} · Recorded{" "}
                {String(e.data.inspected.observed ?? "Unavailable")} ·{" "}
                {String(e.data.inspected.source ?? "Unavailable")}
              </span>
            ) : null}
            {typeof e.data.evidenceId === "string" && (
              <ConnectionLink sourceId={e.id} connection={recordConnection("verification", e.data.evidenceId, row.unit, {
                view: "Acceptance review", label: "Evidence handed off",
                identity: state.acceptance?.submissions.find(record => record.id === e.data.evidenceId)?.source ?? e.data.evidenceId,
              })} />
            )}
            {e.data.owner ? (
              <span className="text-xs text-muted-foreground">Assigned to {name(e.data.owner)}</span>
            ) : null}
          </>}
        </DecisionHistory>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">Unavailable</p>
      )}
    </section>
  );
}

const actionCopy = {
  complete: { label: "Record step", note: "Work note", saved: "Step recorded." },
  pause: {
    label: "Route discrepancy",
    note: "Discrepancy and requested follow-up",
    saved: "Discrepancy assigned.",
  },
  dispose: { label: "Record disposition", note: "Decision and reason", saved: "Disposition recorded." },
  resume: { label: "Resume traveler", note: "Work note", saved: "Traveler resumed." },
};

type TravelerFormProps = {
  actors: ToolProps["workspace"]["actors"];
  actor: string | null;
  setActor: (id: string | null) => void;
  form: ReturnType<typeof useCaseForm>;
};

function TravelerAction({ row, state, ...entry }: TravelerFormProps & { row: Traveler; state: TravelerState }) {
  const [pausing, setPausing] = useState(false);
  if (state.unavailable) {
    return <p className="mt-0.5 text-xs text-muted-foreground">This released traveler is available for history only.</p>;
  }
  const action = pausing && !state.pause ? "pause" : state.assignedAction;
  function switchForm(pause: boolean) {
    setPausing(pause);
    entry.form.setError("");
  }
  return (
    <div className="grid gap-3">
      {action === "complete" ? <StepSource row={row} state={state} /> : <h3 className="text-sm font-semibold">{actionCopy[action].label}</h3>}
      {(action !== "complete" || (state.next && !state.needsEvidence)) && (
        <TravelerForm key={action} {...entry} action={action} target={state.target} cancel={() => switchForm(false)} />
      )}
      {!state.pause && !pausing && (
        <Button type="button" className="w-fit" variant="outline" size="sm" disabled={entry.form.pending} onClick={() => switchForm(true)}>
          Pause for discrepancy
        </Button>
      )}
    </div>
  );
}

function TravelerForm({ action, target, cancel, actors, actor, setActor, form }: TravelerFormProps & {
  action: keyof typeof actionCopy;
  target: TravelerState["target"];
  cancel: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ready = actor && note.trim() && (choice || (action !== "pause" && action !== "dispose"));
  const copy = actionCopy[action];
  return (
    <form className="grid max-w-xl gap-3" onSubmit={event => form.recordForm(event, action, target, copy.saved)}>
      <PersonField people={actors} name="actor" value={actor} onChange={setActor} required showRole />
      {action === "pause" && (
        <PersonField label="Assign discrepancy to" name="owner" placeholder="Choose an owner"
          people={actors} value={choice} onChange={setChoice} required showRole />
      )}
      {action === "dispose" && (
        <LabeledSelect<string> label="Disposition" name="outcome" placeholder="Choose disposition"
          options={["Keep on hold", "Authorize resume"]}
          value={choice} onChange={setChoice} required />
      )}
      <label className={fieldLabel}>
        {copy.note}
        <Textarea name="note" value={note} onChange={e => setNote(e.target.value)} required maxLength={2000} rows={2} />
      </label>
      <div className="flex flex-wrap gap-2">
        {action === "pause" && (
          <Button type="button" size="sm" variant="outline" disabled={form.pending} onClick={cancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={form.pending || !ready}>{copy.label}</Button>
      </div>
    </form>
  );
}

function StepSource({ row, state }: { row: Traveler; state: TravelerState }) {
  return (
    <>
      {state.next && <p className="text-sm">{state.next.detail}</p>}
      {state.next?.id === "inspect" && state.observation && (
        <dl className="grid max-w-xl gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Required entry</dt>
          <dd>{state.observation.expected}</dd>
          <dt className="text-muted-foreground">Recorded entry</dt>
          <dd>{state.observation.observed || "Unavailable"}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="wrap-break-word">{state.observation.source || "Unavailable"}</dd>
        </dl>
      )}
      {state.needsEvidence && state.check && (
        <div className="grid justify-items-start gap-2">
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state.acceptance?.blocker ?? "The archive entry is unavailable."}
          </p>
          <ConnectionLink connection={acceptanceReviewConnection(state.check)} />
        </div>
      )}
      {state.next?.id === "handoff" && state.evidence && (
        <div className="grid gap-1">
          <span className="block mt-0.5 text-xs text-muted-foreground">Source to hand off</span>
          <ConnectionLink connection={recordConnection("verification", state.evidence.id, row.unit, {
            view: "Acceptance review", label: state.evidence.source, identity: state.evidence.id,
          })} />
          <span className="block mt-0.5 text-xs text-muted-foreground">
            {formatUtcDateTime(state.evidence.recordedAt)} · {row.unit.serial} · {row.unit.revision}
          </span>
        </div>
      )}
    </>
  );
}
