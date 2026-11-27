"use client";
import { recordLink } from "@/components/records/presentation";
import { useCaseForm } from "@/components/records/case-form";
import { CaseList, DecisionHistory } from "@/components/records/case-list";
import { WorkspaceLink } from "@/components/workspace/section-tabs";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonField, LabeledSelect } from "@/components/records/forms";
import { ConnectionLink, ConnectionList, ContentLinkLabel } from "@/components/records/links";
import { toolHref } from "@/lib/workspace-routes";
import { recordConnection, type RecordConnection } from "@/lib/records/links";
import type { ToolProps } from "@/components/workspace/workbench";
import { type WorkCase, type WorkEvent, isQAReviewer } from "@/db/workflows/cases";
import { lotReview, submittedScope, type TraceRow } from "@/db/workflows/containment";

export default function ContainmentMap(props: ToolProps) {
  const { dossier: record } = props;
  if (!record) return (
    <section aria-label="Supplier lot notices" className="grid gap-2">
      <h2 className="text-base font-semibold">Supplier lot notices</h2>
      <CaseList label="Supplier lot notices" rows={props.cases.map(record => {
        const { trace, status } = lotReview(record, props.relatedEvents);
        return { record, detail: `${trace.lotId} · ${trace.notice}`, status };
      })} />
    </section>
  );
  return <LotDetails {...props} record={record} />;
}

function LotDetails({ record, relatedEvents, workspace, submit, personName: person }: ToolProps & { record: WorkCase }) {
  const { trace, history, latest, submission, status } = lotReview(record, relatedEvents);
  const [revisingId, setRevisingId] = useState<string>();
  const [selection, setSelection] = useState<{ ids: string[]; stamp?: string }>({ ids: [] });
  const { message, pending, setError, recordForm: save } = useCaseForm(submit);
  const staleDraft = Boolean(selection.ids.length && selection.stamp !== trace.stamp);
  const clear = () => setSelection({ ids: [] });
  const submitted = submittedScope(submission);
  const selected = new Set(selection.ids);
  const reviewing = status === "Awaiting QA" ? submission : undefined;
  const confirmed = status === "Scope confirmed" && revisingId !== latest?.id ? latest : undefined;
  const stage = reviewing ? "pending" : confirmed ? "confirmed" : "select";

  return (
    <article className="grid min-w-0 gap-5">
      <div className="grid justify-items-start gap-2">
        <WorkspaceLink direction="back" href={toolHref("containment")}>Back to lots</WorkspaceLink>
        <h2 className="text-lg font-semibold">{record.title}</h2>
        <p>{trace.reason}</p>
        <p className="text-xs text-muted-foreground">{trace.notice} · {trace.lotId}</p>
        {trace.receiptCaseId && (
          <ConnectionLink connection={{
            href: toolHref("exchange", trace.receiptCaseId),
            label: "Supplier bundle", location: "Verification · Bundles", identity: trace.notice,
          }} />
        )}
      </div>
      <InstallationRegister
        rows={trace.rows}
        selected={selected}
        submitted={new Set(submitted.map((row) => row.id))}
        stage={stage}
        disabled={pending}
        clearStale={staleDraft ? clear : undefined}
        toggle={(id, checked) => {
          setSelection((before) => ({
            stamp: trace.stamp,
            ids: checked ? [...before.ids, id] : before.ids.filter((value) => value !== id),
          }));
          setError("");
        }}
      />
      {confirmed ? (
        <section className="grid justify-items-start gap-2 border-t pt-4">
          <h3 className="font-semibold">Scope confirmed</h3>
          <p className="text-sm">{String(confirmed.data.note)}</p>
          <Button variant="outline" type="button" onClick={() => setRevisingId(confirmed.id)}>
            Revise scope
          </Button>
        </section>
      ) : (
        <ScopeForm
          key={`${latest?.id ?? ""}:${stage}`}
          review={reviewing}
          person={person}
          scope={submitted}
          users={workspace.actors}
          disabled={pending || (!reviewing && (staleDraft || !selected.size))}
          latest={latest}
          updated={status === "Trace updated"}
          save={save}
          onSaved={clear}
          selection={selection}
          stamp={trace.stamp}
        />
      )}
      <p role="status" aria-live="polite" className="text-sm empty:hidden">
        {message}
      </p>
      <ReviewHistory history={history} person={person} />
    </article>
  );
}

function ScopeForm({ users, person, review, scope, disabled, latest, updated, save, onSaved, selection, stamp }: {
  users: ToolProps["workspace"]["actors"];
  person: ToolProps["personName"];
  review?: WorkEvent;
  scope: TraceRow[];
  disabled: boolean;
  latest?: WorkEvent;
  updated: boolean;
  save: ReturnType<typeof useCaseForm>["recordForm"];
  onSaved: () => void;
  selection: { ids: string[]; stamp?: string };
  stamp: string;
}) {
  const [actor, setActor] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <form className="grid max-w-2xl gap-3 border-t pt-4" onSubmit={event => save(event,
      review ? "review-scope" : "request-review",
      { previousEventId: latest?.id ?? null, ...(review ? { stamp } : { stamp: selection.stamp, installationIds: selection.ids }) },
      review ? "QA decision recorded." : "Scope sent for QA review.", onSaved,
    )}>
      <h3 className="font-semibold">{review ? "QA review" : "Containment scope"}</h3>
      {review ? <>
        <p>Assigned to <strong>{person(review.data.owner)}</strong> · {scope.map(row => row.unit.serial).join(", ")}</p>
        <p className="text-sm">{String(review.data.note)}</p>
        <p className="text-sm text-muted-foreground">
          The decision records which installations need follow-up. Unit acceptance and delivery remain separate.
        </p>
        <LabeledSelect<string> label="Scope decision" name="outcome" value={choice} onChange={setChoice}
          options={[
            { value: "Confirmed", label: "Confirm scope" },
            { value: "Returned", label: "Return for follow-up" },
          ]} />
      </> : <>
        {updated && <p role="status">Installation evidence changed since the last review. Select the scope for another review.</p>}
        {latest?.kind === "scope-returned" && <p><strong>QA returned this scope.</strong> {String(latest.data.note)}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <PersonField people={users} label="Submitted by" name="actor" value={actor} onChange={setActor} />
          <PersonField people={users.filter(isQAReviewer)} label="QA owner" name="owner" placeholder="Choose a reviewer"
            value={choice} onChange={setChoice} />
        </div>
      </>}
      <label className="grid gap-1 text-sm">
        {review ? "Decision reason" : "Reason for scope"}
        <Textarea name="note" required maxLength={2000} value={note} onChange={event => setNote(event.target.value)} />
      </label>
      {review && <PersonField people={users} name="actor" value={actor} onChange={setActor} />}
      <Button className="w-fit" variant="outline" type="submit" disabled={disabled || !actor || !choice || !note.trim()}>
        {review ? "Record scope decision" : "Send for QA review"}
      </Button>
    </form>
  );
}

function InstallationRegister({
  rows,
  selected,
  submitted,
  stage,
  disabled,
  clearStale,
  toggle,
}: {
  rows: TraceRow[];
  selected: Set<string>;
  submitted: Set<string>;
  stage: "select" | "pending" | "confirmed";
  disabled: boolean;
  clearStale?: () => void;
  toggle: (id: string, checked: boolean) => void;
}) {
  const matches = rows.filter((row) => row.state === "Recorded match");
  const unresolved = rows.filter((row) => row.state === "Unconfirmed" || row.state === "Conflicting records").length;
  return (
    <fieldset className="@container min-w-0">
      <legend className="font-semibold">Installed units</legend>
      <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
        {matches.length} recorded {matches.length === 1 ? "match" : "matches"} · {unresolved} unresolved ·{" "}
        {rows.filter((row) => row.state === "Different lot").length} other lot
      </p>
      <ul className="divide-y mt-2">
        {rows.map((row) => (
          <li
            key={row.id}
            id={row.id}
            tabIndex={-1}
            className="grid scroll-mt-3 items-start gap-1 py-3 target:bg-muted @3xl:grid-cols-3 @3xl:gap-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              {row.state !== "Different lot" && stage === "select" ? (
                <label className="inline-flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.has(row.id)}
                    disabled={disabled || Boolean(clearStale)}
                    onChange={(event) => toggle(row.id, event.target.checked)}
                  />
                  {row.unit.serial} · {row.unit.revision}
                </label>
              ) : (
                <strong>
                  {row.unit.serial} · {row.unit.revision}
                </strong>
              )}
              <Badge variant="outline">{row.state}</Badge>
              <span className="text-sm text-muted-foreground">{row.stage}</span>
              {stage !== "select" && submitted.has(row.id) && (
                <strong className="text-sm">{stage === "pending" ? "In review" : "In confirmed scope"}</strong>
              )}
            </div>
            <div className="grid min-w-0 gap-1 text-sm">
              <p>
                {row.imports.length > 0 && "Original entry · "}
                {row.source}
              </p>
              <span className="text-muted-foreground">Installed lot · {row.lots.join(" / ") || "Unavailable"}</span>
            </div>
            <InstallationLinks row={row} />
          </li>
        ))}
      </ul>
      {stage === "select" && <>
        {clearStale && <div className="flex flex-wrap items-center gap-2">
          <p role="status">Your selection predates a change to the lot trace.</p>
          <Button type="button" variant="outline" onClick={clearStale}>Clear selection</Button>
        </div>}
        <p className="text-sm">{selected.size
          ? `${selected.size} selected · ${matches.filter(row => selected.has(row.id)).length} of ${matches.length} recorded matches included`
          : "Select the installations QA should check."}</p>
      </>}
    </fieldset>
  );
}

function InstallationLinks({ row }: { row: TraceRow }) {
  const sources: RecordConnection[] = row.imports.map(source => {
    const eventId = encodeURIComponent(source.eventId);
    if (source.tool === "inventory") return {
      href: toolHref("inventory", source.caseId) + "#" + eventId,
      location: "Production · Stock", label: "Installation · " + source.fileId, identity: source.receiptTitle,
    };
    return {
      href: toolHref("exchange", source.caseId) + "#receipt-" + eventId + "--" + encodeURIComponent(source.fileId),
      location: "Verification · Bundles", label: "Receipt · " + source.fileId, identity: source.receiptTitle,
    };
  });
  return <ConnectionList title="Installation sources" links={[
    recordConnection("production", row.buildId, row.unit, {
      view: "Builds", label: "Build work · " + row.unit.serial, identity: row.buildId,
    }),
    ...sources,
  ]} />;
}

function ReviewHistory({ history, person }: { history: WorkEvent[]; person: (id: unknown) => string }) {
  if (!history.length) return null;
  return (
    <section className="border-t pt-4" aria-label="Containment review history">
      <h3 className="font-semibold">Review history</h3>
      <DecisionHistory events={history} name={person} rowClass="grid scroll-mt-3 gap-1 py-3" anchor={event => `review-${event.id}`}>
        {event => {
          const scope = submittedScope(event);
          return (
            <>
              <p className="text-sm">{String(event.data.note)}</p>
              {event.kind === "scope-submitted" && <small>QA owner · {person(event.data.owner)}</small>}
              {typeof event.data.submissionId === "string" && (
                <a className={`${recordLink} w-fit`} href={`#review-${encodeURIComponent(event.data.submissionId)}`}>
                  <ContentLinkLabel kind="internal">Reviewed submission</ContentLinkLabel>
                </a>
              )}
              {scope.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">Submitted scope · {scope.length}</summary>
                  <ul className="grid gap-3 py-2 text-sm">
                    {scope.map((row) => (
                      <li key={row.id} className="grid gap-1">
                        <strong>
                          {row.unit.serial} · {row.unit.revision} · {row.state}
                        </strong>
                        <span>
                          {row.source} · {row.lots.join(" / ") || "Unavailable"}
                        </span>
                        <InstallationLinks row={row} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          );
        }}
      </DecisionHistory>
    </section>
  );
}
