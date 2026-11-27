"use client";
import { useCaseForm, useDecisionFocus } from "@/components/records/case-form";
import { CaseHeading, CaseList, DecisionHistory } from "@/components/records/case-list";

import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "@/components/records/links";
import { PersonField, LabeledSelect, TextField, NoteField } from "@/components/records/forms";
import { connectionToRecord } from "@/components/records/schema";
import type { ToolProps } from "@/components/workspace/workbench";
import {
  fields,
  isComparison,
  nextDecision,
  stage,
  type Action,
  type ReconciliationCase,
} from "@/db/workflows/reconciliation";

export default function DataReconciliation(props: ToolProps) {
  const { dossier, cases, personName } = props;
  if (dossier && isComparison(dossier)) {
    return <Comparison {...props} row={dossier} />;
  }
  const queue = cases.filter(isComparison).map(record => {
    const last = record.history.at(-1);
    const target = record.data.sources.find(source => source.id === record.data.targetId)!;
    const status = stage(last);
    const closed = status === "Mapped" || status === "Different unit";
    const ownerId = last?.kind === "source-correction-requested" ? last.data.owner : "reviewer";
    const owner = personName(ownerId, "");
    const detail = [record.unit.serial, record.unit.revision, target.system, !closed && owner].filter(Boolean).join(" · ");
    return { record, detail, status, closed, search: [record.data.targetId, owner].join(" ") };
  }).sort((a, b) => Number(a.closed) - Number(b.closed) ||
    a.record.title.localeCompare(b.record.title) || a.record.id.localeCompare(b.record.id));
  return (
    <section aria-label="Reconciliation queue" className="grid gap-2">
      {dossier && <p role="status">This discrepancy is unavailable.</p>}
      <CaseList label="Discrepancies" rows={queue} />
    </section>
  );
}

type Field = ReconciliationCase["data"]["field"];
type Display = (field: Field, value: unknown) => string;

function Comparison({ row, workspace, submit, personName: person }: ToolProps & { row: ReconciliationCase }) {
  const history = row.history;
  const last = history.at(-1);
  const state = stage(last);
  const step = nextDecision(row, last, workspace);
  const { target: source, build, problem, request } = step;
  const owner = person(request ? request.data.owner : source.owner);
  const display: Display = (field, value) => {
    if (typeof value !== "string" || !value) return "Unavailable";
    if (field === "revisionId")
      return workspace.catalog.revisions.find((r) => r.id === value)?.version ?? value;
    return value;
  };
  const focus = useDecisionFocus(history);
  const form = useCaseForm(submit);
  const editor = useRef<HTMLDetailsElement>(null);
  const actionLabel = step.choices.length === 1 ? actions[step.choices[0]].label
    : request ? "Respond to correction request" : "Resolve discrepancy";

  return (
    <article className="grid min-w-0 gap-4 pt-2 wrap-anywhere">
      <CaseHeading record={row} back="All discrepancies" status={state}>
        <p className="text-xs text-muted-foreground">{row.unit.serial} · {row.unit.revision}</p>
      </CaseHeading>
      <div id={source.id} tabIndex={-1} className="grid scroll-mt-[calc(var(--header)+12px)] gap-3">
        {step.choices.length > 0 && (
          <details ref={editor} className="group/editor">
            <summary id="recon-next-action" className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md border bg-popover px-2.5 text-[0.8rem] font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring dark:border-input dark:bg-input/30 dark:hover:bg-input/50 [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden="true" className="size-4 group-open/editor:rotate-90" />{actionLabel}
            </summary>
            <div className="mt-3 max-w-2xl border-l pl-3">
              <DecisionForm key={JSON.stringify([step.subject, step.choices])} row={row} step={step}
                people={workspace.actors} assignee={request ? owner : person("reviewer")} display={display} form={form}
                onSaved={event => {
                  if (editor.current) editor.current.open = false;
                  focus(event, source.id);
                }} />
            </div>
          </details>
        )}
        <p className="max-w-prose">{row.data.observation}</p>
        {step.choices.length > 0 && (
          request ? <p><strong>{owner} · {String(request.data.system)}</strong> · {String(request.data.targetId)}<br />{String(request.data.reason)}</p>
            : <p className="text-xs text-muted-foreground">Correction owner · {owner} ({source.system})</p>
        )}
        {problem && <p role="status">{problem}</p>}
        {step.changed && <p role="status">{step.changed}</p>}
        {step.choices.length > 0 && !request && !step.bases.length && <p>The retained sources do not establish a match.</p>}
        {form.message && <p role={form.error ? "alert" : "status"}>{form.message}</p>}
      </div>
      <SourceComparison row={row} display={display} />
      {history.length > 0 && (
        <section aria-labelledby="recon-history" className="border-t pt-3">
          <h3 className="text-[13px] font-semibold" id="recon-history">Reconciliation history</h3>
          <DecisionHistory events={history} name={person} rowClass="grid gap-0.5 py-2">
            {e => <>
              <p className="text-xs text-muted-foreground">{String(e.data.serial)} · {display("revisionId", e.data.revisionId)}</p>
              <p>{String(e.data.reason)}</p>
              {e.kind === "source-clarified" && (
                <p className="text-sm">
                  {String(e.data.reference)} · {String(e.data.targetId)} → {display(row.data.field, e.data.value)}
                </p>
              )}
              {e.kind === "identity-excluded" && (
                <p className="text-sm">
                  {String(e.data.reference)} · identifies {String(e.data.otherSerial)} ·{" "}
                  {display("revisionId", e.data.otherRevision)}
                </p>
              )}
              {e.kind === "mapping-recorded" && (
                <div className="text-sm">
                  <p>{String(e.data.targetId)} · {display(row.data.field, e.data.before)} → {display(row.data.field, e.data.value)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[...new Set([e.data.citation, e.data.sourceId, e.data.locator].filter(Boolean))].join(" · ")}
                  </p>
                </div>
              )}
              {e.kind === "source-correction-requested" && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {String(e.data.system)} · {person(String(e.data.owner))}
                </p>
              )}
            </>}
          </DecisionHistory>
        </section>
      )}
      {build && (
        <ConnectionList title="Build affected" links={[connectionToRecord("production", build)]} />
      )}
    </article>
  );
}

function SourceComparison({ row, display }: { row: ReconciliationCase; display: Display }) {
  const { field, sources } = row.data;
  const shared: string[] = [];
  const differingFields: Field[] = [];
  for (const key of ["serial", "revisionId", "receipt"] as const) {
    if (key === field) continue;
    const value = sources[0][key];
    if (value !== null && sources.every(source => source[key] === value)) {
      shared.push(fields[key] + " " + display(key, value));
    } else {
      differingFields.push(key);
    }
  }
  return (
    <section aria-label="Source comparison" className="grid gap-3 border-t pt-3">
      <table className="w-full max-w-3xl table-fixed text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr><th scope="col" className="w-3/5 pr-3 font-medium">Source</th><th scope="col" className="font-medium">{fields[field]}</th></tr>
        </thead>
        <tbody>
          {sources.map(source => (
            <tr key={source.id} className="align-top">
              <th scope="row" className="pt-2 pr-3 font-normal">
                <strong>{source.system}</strong>
                <span className="block text-xs text-muted-foreground">{source.document}</span>
              </th>
              <td className="pt-2">{display(field, source[field])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">Source details</summary>
        <ul className="my-2 grid gap-2">
          {sources.map(source => (
            <li key={source.id}>
              {source.system} · {source.id} · <time dateTime={source.sourceDate}>{source.sourceDate}</time>
              {differingFields.map(key => <span key={key} className="block">{fields[key]} · {display(key, source[key])}</span>)}
            </li>
          ))}
        </ul>
        {shared.length > 0 && <p>All sources · {shared.join(" · ")}</p>}
      </details>
    </section>
  );
}

const actions = {
  map: { label: "Record a mapping", reason: "Reason for mapping" },
  route: { label: "Request a source correction", reason: "Question for the owner" },
  clarify: {
    label: "Cite an owner clarification",
    reason: "What does the clarification establish?",
  },
  exclude: {
    label: "The source identifies a different unit",
    reason: "Why is this unit excluded?",
  },
  unconfirmed: {
    label: "Report insufficient evidence",
    reason: "What remains unresolved?",
  },
};


function DecisionForm({ row, step, people, assignee, display, form, onSaved }: {
  row: ReconciliationCase;
  step: ReturnType<typeof nextDecision>;
  people: ToolProps["workspace"]["actors"];
  assignee: string;
  display: Display;
  form: ReturnType<typeof useCaseForm>;
  onSaved: (event: string) => void;
}) {
  const { request, target: source, choices, bases, subject } = step;
  const [action, setAction] = useState<Action | null>(request && choices.length > 1 ? null : choices[0]);
  const [citationId, setCitationId] = useState<string | null>(bases.length === 1 ? bases[0].basisId : null);
  const basis = bases.find(entry => entry.basisId === citationId);
  const field = row.data.field;
  const disabled = form.pending || (action === "map" && !basis);

  function save(event: React.FormEvent<HTMLFormElement>) {
    if (!action || disabled) return event.preventDefault();
    form.recordForm(event, action, { ...subject, basisId: citationId ?? undefined },
      "Saved to reconciliation history.", onSaved);
  }

  return (
    <form className="grid min-w-0 gap-3" onSubmit={save} aria-labelledby="recon-next-action">
      {choices.length > 1 && (
        <div className="max-w-md">
          <LabeledSelect<Action> label="Action" placeholder="Choose an action" required value={action}
            options={choices.map(value => ({ value, label: actions[value].label }))} onChange={setAction} />
        </div>
      )}
      {action === "map" && <>
        {bases.length > 1 && <LabeledSelect label="Mapping citation" placeholder="Choose a citation"
          required value={citationId} onChange={setCitationId} options={bases.map(b => ({ value: b.basisId, label: b.sourceId }))} />}
        {basis && <p className="text-sm">
          <strong>{fields[field]} on {source.id}</strong> · {display(field, source[field])} → {display(field, basis.value)}
          <br />{basis.citation} · {basis.locator}
        </p>}
      </>}
      {(action === "clarify" || action === "exclude") && <ClarificationFields row={row} exclude={action === "exclude"} />}
      {action && (
        <>
          <NoteField label={actions[action].reason} key={action} name="reason" required maxLength={1200} rows={2} />
          <span className="block mt-0.5 text-xs text-muted-foreground">Assigned to {assignee}</span>
          <PersonField people={people} name="actor" required />
          <Button className="w-fit" size="sm" type="submit" disabled={disabled}>
            {action === "route" ? "Route to " + source.system : request ? "Save owner response" : "Record mapping"}
          </Button>
        </>
      )}
    </form>
  );
}

function ClarificationFields({ row, exclude }: { row: ReconciliationCase; exclude: boolean }) {
  return (
    <fieldset className="grid min-w-0 gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Identifiers quoted by the clarification</legend>
      <TextField label="Clarification reference" name="reference" maxLength={120} required placeholder="Document and page or entry" />
      <div className="grid gap-2 md:grid-cols-3">
        {[
          ["attestedTarget", "Original source row"],
          ["attestedSerial", exclude ? "Other serial" : "Serial"],
          ["attestedRevision", exclude ? "Other revision ID" : "Revision ID"],
        ].map(([name, label]) => (
          <TextField key={name} label={label}
            name={name} maxLength={120} required
            aria-describedby={name === "attestedRevision" ? "recon-revision" : undefined}
          />
        ))}
      </div>
      <p id="recon-revision" className="mt-0.5 text-xs text-muted-foreground">
        Case unit · {row.unit.serial} · {row.unit.revisionId}
      </p>
      {!exclude && row.data.field === "receipt" && (
        <TextField label="Corrected receipt line" name="value" maxLength={120} required />
      )}
    </fieldset>
  );
}
