"use client";
import { recordLink } from "@/components/records/presentation";
import { RecordTable } from "@/components/records/table";
import { useCaseForm } from "@/components/records/case-form";
import { CaseHeading, CaseList } from "@/components/records/case-list";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CornerDownLeft, FileCheck2, Inbox, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonField, LabeledSelect, NoteField } from "@/components/records/forms";
import { ConnectionList, ContentLinkLabel } from "@/components/records/links";
import { connectionToRecord } from "@/components/records/schema";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkCase, WorkEvent } from "@/db/workflows/cases";
import {
  cohort,
  elapsed,
  measures,
  measureKeys,
  studyInterventions,
  nextActions,
  orderSources,
  stepLabels,
  type Cohort,
  type Measure,
  type Study,
} from "@/db/workflows/improvement";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const valueLabel = (n: number | null, key: Measure) =>
  n === null ? "Unavailable" : number.format(n) + (key === "returned" ? "%" : " min");
type Sources = ReturnType<typeof orderSources>;
type People = ToolProps["workspace"]["actors"];

function isStudy(record: WorkCase): record is Study { return record.tool === "improvement"; }

export default function ProductionImprovement(props: ToolProps) {
  const { dossier, cases, personName } = props;
  if (dossier && isStudy(dossier)) return <StudyRecord {...props} study={dossier} />;
  return (
    <section className="grid gap-2.5 pt-2 wrap-anywhere" aria-label="Archived process studies">
      <p>Compare completed document orders before and after a recorded process change.</p>
      <CaseList label="Archived process studies" rows={cases.filter(isStudy).map(record => {
        const { status, pending } = studyInterventions(record);
        const owner = pending && personName(pending.data.owner, "");
        return {
          record,
          status,
          detail: `${record.data.orders.length} orders · ${owner ? "Follow-up: " + owner : record.data.reference}`,
        };
      })} />
    </section>
  );
}

function StudyRecord({ study, workspace, submit, personName }: ToolProps & { study: Study }) {
  const state = studyInterventions(study);
  const { interventions: cycles, remaining, last, status } = state;
  const current = cycles.at(-1);
  const sources = orderSources(study, workspace);
  const form = useCaseForm(submit);
  const action = <InterventionForm key={last?.id ?? study.id} state={state} people={workspace.actors} form={form} />;
  return (
    <article className="grid gap-2.5 pt-2 wrap-anywhere min-w-0">
      <CaseHeading record={study} back="All studies" status={status}>
        <p>{study.data.change}</p>
        <span className="block mt-0.5 text-xs text-muted-foreground">
          {study.data.reference} · Effective {study.data.effective}
        </span>
      </CaseHeading>
      <CohortComparison study={study} sources={sources} cycles={cycles} />
      <OrderReplay study={study} sources={sources} />
      <section
        id={study.id}
        className="grid gap-2 border-t border-border pt-3"
        aria-labelledby="intervention"
      >
        <h3 className="text-[13px] font-semibold" id="intervention">
          {current?.assessment
            ? "Recorded outcome"
            : current
              ? "Assess the change"
              : "Track an intervention"}
        </h3>
        {current && (
          <div id={study.id + "-" + current.tracked.data.measure} className="grid gap-2">
            <InterventionHistory {...current} name={personName} />
          </div>
        )}
        {form.message && (
          <p role={form.error ? "alert" : "status"} className="text-xs text-muted-foreground empty:absolute">
            {form.message}
          </p>
        )}
        {!current?.assessment && action}
        {current?.assessment && remaining.length > 0 && (
          <details key={last?.id} className="text-sm">
            <summary className="w-fit cursor-pointer font-medium">Track another measure</summary>
            <div className="pt-3">{action}</div>
          </details>
        )}
        {cycles.slice(0, -1).map((c) => (
          <details key={c.tracked.id} id={study.id + "-" + c.tracked.data.measure} className="text-sm">
            <summary className="w-fit cursor-pointer">
              Earlier assessment · {measures[c.tracked.data.measure as Measure].label}
            </summary>
            <div className="grid gap-2 pt-2">
              <InterventionHistory {...c} name={personName} />
            </div>
          </details>
        ))}
      </section>
    </article>
  );
}

function CohortComparison({
  study,
  sources,
  cycles,
}: {
  study: Study;
  sources: Sources;
  cycles: ReturnType<typeof studyInterventions>["interventions"];
}) {
  return (
    <section aria-labelledby="cohorts" className="grid gap-1">
      <h3 className="text-[13px] font-semibold" id="cohorts">Cohort comparison</h3>
      <RecordTable
        className="table-fixed"
        aria-labelledby="cohorts"
        aria-describedby="measure-basis"
      >
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {(["before", "after"] as const).map((side) => (
              <th key={side} scope="col">
                {side === "before" ? "Before" : "After"}
                <span className="block mt-0.5 text-xs text-muted-foreground">{study.data.editions[side]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {measureKeys.map((key) => (
            <tr key={key}>
              <th scope="row" className="font-medium">
                {measures[key].label}
              </th>
              {(["before", "after"] as const).map((side) => {
                const cycle = cycles.find((c) => c.tracked.data.measure === key);
                const saved =
                  side === "before" ? cycle?.tracked.data.baseline : cycle?.assessment?.data.later;
                const basis = (saved as Cohort | undefined) ?? cohort(sources, side, key);
                return (
                  <td key={side}>
                    <strong>{valueLabel(basis.value, key)}</strong>
                    <span className="block mt-0.5 text-xs text-muted-foreground">
                      {key === "returned"
                        ? `${basis.orders.filter((o) => o.value === 1).length}/${basis.measured} returned`
                        : `${basis.measured}/${basis.total} timed`}
                    </span>
                    {key === "returned" && basis.measured < basis.total && (
                      <span className="block mt-0.5 text-xs text-muted-foreground">{basis.total - basis.measured} unknown</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </RecordTable>
      <p id="measure-basis" className="mt-0.5 text-xs text-muted-foreground">
        Times are medians. An order’s correction time adds the elapsed minutes from each return to its
        resubmission.
      </p>
    </section>
  );
}

const stageIcons = {
  handoff: Send,
  pickup: Inbox,
  return: CornerDownLeft,
  resubmit: Send,
  close: FileCheck2,
};
function OrderReplay({ study, sources }: { study: Study; sources: Sources }) {
  const orderId = useSearchParams().get("order");
  return (
    <section aria-labelledby="order-replay" className="grid gap-1">
      <h3 className="text-[13px] font-semibold" id="order-replay">Order replay</h3>
      <ul className="divide-y">
        {sources.map(({ order, source, exclusion }) => (
          <li key={order.buildId}>
            <details className="min-w-0 py-2" open={orderId === order.buildId || undefined} id={"ledger-" + order.buildId}>
              <summary className="cursor-pointer rounded-sm text-sm">
                <strong>{order.reference}</strong> · {order.unit.serial}{" "}
                <span className="text-muted-foreground">· {study.data.editions[order.edition]}</span>
              </summary>
              <div className="grid gap-2 pt-2">
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {order.register} · {order.date} UTC · {order.unit.revision} ·{" "}
                  {order.completeLog ? "Complete" : "Partial"} event list
                </p>
                <ol className="grid ps-2" aria-label={order.reference + " routing history"}>
                  {order.stamps.map((stamp, i) => {
                    const Icon = stageIcons[stamp.step];
                    const previous = order.stamps[i - 1];
                    const interval = elapsed(previous, stamp);
                    const queue = previous?.step === "handoff" && stamp.step === "pickup";
                    const correction = previous?.step === "return" && stamp.step === "resubmit";
                    return (
                      <li
                        key={order.buildId + "-" + i}
                        className="relative grid min-w-0 grid-cols-[1rem_1fr] items-start gap-x-2 pb-3 after:absolute after:inset-s-[6px] after:inset-y-[19px_0] after:border-s after:border-border last:pb-0 last:after:hidden"
                      >
                        <Icon size={14} aria-hidden="true" className="mt-1" />
                        <div>
                          <span className="font-mono text-xs">
                            {stamp.at ? (
                              <time dateTime={stamp.at}>{stamp.at.slice(11, 16)}</time>
                            ) : (
                              "Unavailable"
                            )}
                          </span>
                          {" · "}
                          <strong className="text-sm">{stepLabels[stamp.step]}</strong>
                          {(queue || correction) && (
                            <span className="block mt-0.5 text-xs text-muted-foreground">
                              {queue ? "Queue wait" : "Correction interval"} ·{" "}
                              {valueLabel(interval, "wait")}
                            </span>
                          )}
                          {stamp.note && <p className="text-sm">{stamp.note}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {exclusion && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{exclusion}. Excluded from current measures.</p>
                )}
                {source && (
                  <ConnectionList
                    sourceId={"ledger-" + order.buildId}
                    title="Source order"
                    links={[connectionToRecord("production", { ...source, unit: order.unit, reference: order.reference })]}
                  />
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InterventionHistory({
  tracked,
  assessment,
  name,
}: {
  tracked: WorkEvent;
  assessment?: WorkEvent;
  name: ToolProps["personName"];
}) {
  const key = tracked.data.measure as Measure;
  const results = [{
    event: tracked, basis: tracked.data.baseline as Cohort,
    label: "Baseline", side: "Before", heading: measures[key].label + " · " + name(tracked.data.owner),
  }];
  if (assessment?.data.later) {
    const delta = Number(assessment.data.delta);
    const change = delta === 0 ? "No observed change" :
      number.format(Math.abs(delta)) + (key === "returned" ? " percentage points" : " min") + (delta < 0 ? " lower" : " higher");
    results.push({
      event: assessment, basis: assessment.data.later as Cohort,
      label: "Later result", side: "After", heading: change + " in the later cohort",
    });
  }
  return (
    <>
      {results.map(({ event, basis, label, heading }) => (
        <div className="grid gap-1" key={event.id} id={event.id}>
          <strong>{heading}</strong>
          <p>{String(event.data.note)}</p>
          {event === assessment && <p>Next action · {nextActions[event.data.disposition as keyof typeof nextActions]}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {label} {valueLabel(basis.value, key)} · {basis.measured} of {basis.total} orders ·{" "}
            {name(event.actor)} · {formatUtcDateTime(event.at)}
          </p>
        </div>
      ))}
      <details className="text-sm">
        <summary
          className="w-fit cursor-pointer"
          aria-label={"Saved measurement basis for " + measures[key].label}
        >
          Saved measurement basis
        </summary>
        <ul className="divide-y">
          {results.flatMap(({ basis, side }) => basis.orders.map(order => (
            <li key={order.buildId} className="py-1">
              <a className={recordLink} href={"#ledger-" + order.buildId}>
                <ContentLinkLabel kind="internal">{order.unit.serial} · {order.unit.revision}</ContentLinkLabel>
              </a>
              {" · "}{side} · {order.reason ?? (key === "returned"
                ? order.value ? "Returned" : "No return"
                : valueLabel(order.value, key))}
            </li>
          )))}
        </ul>
      </details>
    </>
  );
}

function InterventionForm({ state, people, form }: {
  state: ReturnType<typeof studyInterventions>;
  people: People;
  form: ReturnType<typeof useCaseForm>;
}) {
  const { pending: tracked, last, remaining } = state;
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [actor, setActor] = useState<People[number]["id"] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const canSubmit = actor && choice && (tracked || measure);
  return (
    <form className="grid max-w-2xl gap-3" onSubmit={event => form.recordForm(event,
      tracked ? "assess" : "track", { previousId: last?.id ?? null }, tracked ? "Outcome saved." : "Intervention saved."
    )}>
      {!tracked && (
        <>
          <LabeledSelect<Measure>
            label="Bottleneck measure" name="measure"
            value={measure}
            onChange={setMeasure}
            required
            options={remaining.map((key) => ({
              value: key,
              label: measures[key].label,
            }))}
          />
          {measure && <p className="mt-0.5 text-xs text-muted-foreground">{measures[measure].definition}</p>}
          <PersonField people={people} label="Follow-up owner" name="owner" value={choice} onChange={setChoice} required />
        </>
      )}
      {tracked && (
        <LabeledSelect
          label="Next action" name="disposition"
          value={choice}
          onChange={setChoice}
          required
          options={Object.entries(nextActions).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      )}
      <NoteField label={tracked ? "Interpretation and follow-up" : "Hypothesis"}
        required
        rows={2}
        maxLength={1000}
        name="note"
      />
      <PersonField people={people} name="actor" value={actor} onChange={setActor} required />
      {tracked && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Consider differences in order mix and incomplete registers when interpreting the change.
        </p>
      )}
      <Button type="submit" size="sm" className="w-fit" disabled={form.pending || !canSubmit}>
        {tracked ? "Record outcome" : "Save intervention"}
      </Button>
    </form>
  );
}
