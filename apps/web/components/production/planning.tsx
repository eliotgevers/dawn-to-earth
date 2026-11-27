"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, History, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialog, LabeledSelect, PersonField, TextField } from "@/components/records/forms";
import { RecordResults } from "@/components/records/results";
import { ConnectionLink, ConnectionList } from "@/components/records/links";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import { buildMaterialLink } from "./builds";
import { forecastPlan, workingSchedule, validDay, uniqueHolds, type Planning, type ScheduleDraft, type PlannedTask } from "@/lib/planning";
import { connectionToRecord } from "@/components/records/schema";
import { recordConnection } from "@/lib/records/links";
import { toolHref } from "@/lib/workspace-routes";
import { saveWorkspace, useAssembly } from "@/lib/workspace";
import { formatUtcDateTime } from "@/lib/utc-time";
import { cn } from "@/lib/utils";
import type { Reservation } from "@/db/schema";

type Forecast = ReturnType<typeof forecastPlan>;
type NameLookup = (id: string) => string;
type Confirmation =
  | { operation: "save-plan"; draft: ScheduleDraft; conflicts: number; baseline: string }
  | { operation: "publish-plan"; scenario: string; title: string; baseVersion: number; stamp: string; deliveries: Forecast["deliveries"] };

const dateLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const agendaDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const disclosure = "cursor-pointer list-none rounded-sm focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden";
const recordAnchor = "scroll-mt-[calc(var(--header)+12px)] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";
// The summary and the open detail inherit the same four columns from their disclosure.
const planningColumns = "group lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.85fr)_minmax(0,.8fr)_minmax(0,1.15fr)] lg:gap-x-4 lg:[&::details-content]:col-span-full lg:[&::details-content]:grid lg:[&::details-content]:grid-cols-subgrid";
const acrossRow = "lg:col-span-full lg:grid lg:grid-cols-subgrid";

function DateText({ day }: { day: string }) {
  return <time dateTime={day}>{dateLabel.format(new Date(day))}</time>;
}

function selectSchedule(id: string | null) {
  const url = new URL(window.location.href);
  if (id && id !== "current") url.searchParams.set("scenario", id);
  else url.searchParams.delete("scenario");
  window.history.replaceState(null, "", url);
}

export function ProductionPlanning({ item, planning }: { item?: SelectedItem; planning: Planning }) {
  const { users, actors, records, local } = useAssembly();
  const selected = useSearchParams().get("scenario") ?? "current";
  const [draft, setDraft] = useState<ScheduleDraft>();
  const [message, setMessage] = useState("");
  const schedule = workingSchedule(planning, selected, draft);
  const { current, scenario, changed, slots, baseVersion } = schedule;
  const forecast = forecastPlan(planning, slots, records, local);
  const comparing = Boolean(draft || scenario);
  const checks = records.verification.acceptanceChecks;
  const scopedChecks = item ? new Set(checks.filter(check => includesUnit(item, check.unit)).map(check => check.id)) : undefined;
  const deliveries = forecast.deliveries.filter(({ check }) => !scopedChecks || scopedChecks.has(check.id))
    .sort((a, b) => a.date.day.localeCompare(b.date.day) || a.check.unit.serial.localeCompare(b.check.unit.serial));
  const rows = deliveries.flatMap(({ work }) => work);
  const personName = (id: string) => actors.find(person => person.id === id)?.name ?? id;
  const stationName = (id: string) => planning.stations.find(station => station.id === id)?.name ?? id;

  return (
    <div className="grid min-w-0 gap-6 pt-2 wrap-anywhere">
      <ScheduleControls schedule={schedule} scenarios={planning.scenarios} forecast={forecast} scoped={Boolean(item)}
        draft={draft} setDraft={setDraft} message={message} setMessage={setMessage} />

      {deliveries.length ? <>
        <DeliveryOutlook deliveries={deliveries} tasks={planning.tasks} commitments={current?.dates}
          comparing={comparing} personName={personName} />
        <ReservationAgenda rows={rows} changed={changed} planning={planning} slots={slots}
          users={users} personName={personName} stationName={stationName}
          onChange={updated => {
            setDraft({ baseVersion, slots: slots.map(slot => slot.task === updated.task ? updated : slot) });
            setMessage("Reservation updated in draft.");
          }} />
      </> : <p className="rounded-lg border px-3 py-4 text-muted-foreground">
        {item && !item.members.length ? "This selection has no registered units to schedule."
          : item ? "No delivery reservations are scheduled for the selected units and revisions."
          : "No delivery reservations have been scheduled."}
      </p>}

      <PlanHistory planning={planning} checks={checks} scopedChecks={scopedChecks} />
    </div>
  );
}

function ScheduleControls({ schedule: { current, scenario, version, changed, slots, baseVersion, newWork, stale },
  scenarios, forecast, scoped, draft, setDraft, message, setMessage }: {
  schedule: ReturnType<typeof workingSchedule>; scenarios: Planning["scenarios"]; forecast: Forecast; scoped: boolean;
  draft?: ScheduleDraft; setDraft: (value?: ScheduleDraft) => void; message: string; setMessage: (value: string) => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const action = useRef<HTMLButtonElement>(null);
  const selector = useRef<HTMLDivElement>(null);
  const baseline = current ? "Published plan v" + version : "Initial reservations";

  return (
    <div className="grid gap-2 border-b pb-4">
      <div ref={selector} tabIndex={-1} className="flex flex-wrap items-end gap-2">
        <div className="w-60 max-w-full">
          <LabeledSelect label="Schedule" value={scenario?.id ?? "current"} disabled={Boolean(draft)}
            onChange={id => { selectSchedule(id); setMessage(""); }}
            options={[{ value: "current", label: baseline }, ...scenarios.map(row => ({ value: row.id, label: row.title }))]}
          />
        </div>
        {stale ? (
          <Button variant="outline" onClick={() => {
            setDraft({ slots, baseVersion: version });
            setMessage("Draft compared with " + baseline.toLowerCase() + ".");
          }}>{newWork ? "Include new reservations" : "Compare with current plan"}</Button>
        ) : draft ? (
          <Button ref={action} onClick={() => setConfirmation({
            operation: "save-plan", draft: { slots, baseVersion }, conflicts: forecast.conflicts, baseline,
          })}>Save scenario</Button>
        ) : scenario && forecast.conflicts === 0 ? (
          <Button ref={action} onClick={() => setConfirmation({
            operation: "publish-plan", scenario: scenario.id, title: scenario.title, baseVersion,
            stamp: forecast.stamp, deliveries: forecast.deliveries,
          })}>Publish plan</Button>
        ) : null}
        {draft && <Button variant="ghost" onClick={() => {
          setDraft(undefined);
          setMessage("Draft discarded.");
          selector.current?.focus();
        }}>Discard draft</Button>}
      </div>
      <ScheduleSummary draft={Boolean(draft)} comparing={Boolean(draft || scenario)} baseline={baseline}
        changes={changed.size} conflicts={forecast.conflicts} scoped={scoped} />
      <output aria-live="polite" className="text-xs text-muted-foreground empty:absolute">{message}</output>
      {confirmation && <PlanConfirmation confirmation={confirmation} finalFocus={() => action.current ?? selector.current}
        onClose={() => setConfirmation(undefined)} onSaved={id => {
          setDraft(undefined);
          selectSchedule(id ?? null);
          setMessage(id ? "Scenario saved." : "Plan published.");
          setConfirmation(undefined);
        }} />}
    </div>
  );
}

function ScheduleSummary({ draft, comparing, baseline, changes, conflicts, scoped }: {
  draft: boolean; comparing: boolean; baseline: string; changes: number; conflicts: number; scoped: boolean;
}) {
  if (!comparing && !conflicts) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {draft && <Badge variant="secondary">Unsaved draft</Badge>}
      {comparing && <span>Compared with {baseline.toLowerCase()} · {changes} changed across the schedule</span>}
      {conflicts > 0 && (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {conflicts} {conflicts === 1 ? "reservation has" : "reservations have"} conflicts{scoped && " across the full schedule"}
        </span>
      )}
    </div>
  );
}

function PlanConfirmation({ confirmation, finalFocus, onClose, onSaved }: {
  confirmation: Confirmation; finalFocus: () => HTMLElement | null; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const saving = useRef(false);

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving.current) onClose(); }}>
      <FormDialog
        heading={confirmation.operation === "save-plan" ? "Save scenario" : "Publish plan"}
        submit={confirmation.operation === "save-plan" ? "Save scenario" : "Publish version"}
        description={confirmation.operation === "save-plan"
          ? "Based on " + confirmation.baseline.toLowerCase()
          : confirmation.title + " · Version " + (confirmation.baseVersion + 1)}
        onPendingChange={pending => { saving.current = pending; }}
        finalFocus={finalFocus}
        onSubmit={async fields => {
          const result = await (confirmation.operation === "save-plan"
            ? saveWorkspace({ operation: "save-plan", ...confirmation.draft, title: fields.get("title") })
            : saveWorkspace({
              operation: "publish-plan", scenario: confirmation.scenario,
              baseVersion: confirmation.baseVersion, stamp: confirmation.stamp,
            }));
          return result.error || (() => onSaved(result.scenarioId));
        }}
      >
        {confirmation.operation === "save-plan" ? (
          <>
            <TextField label="Scenario name" name="title" required maxLength={100} />
            {confirmation.conflicts > 0 && <p className="text-xs text-muted-foreground">Resolve reservation conflicts before publishing.</p>}
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              This publishes an internal commitment for each scheduled delivery in the workspace.
              Held deliveries retain their blockers.
            </p>
            <ul className="max-h-[35dvh] divide-y overflow-auto rounded-md border px-3">
              {confirmation.deliveries.map(({ check, date }) => (
                <li key={check.id} className="grid gap-0.5 py-2">
                  <strong>{check.unit.serial} · {check.unit.revision}</strong>
                  <span>Committed <DateText day={date.day} /> · Forecast {date.forecast ? <DateText day={date.forecast} /> : "held"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </FormDialog>
    </Dialog>
  );
}

function DeliveryOutlook({ deliveries, tasks, commitments, comparing, personName }: {
  deliveries: Forecast["deliveries"]; tasks: Planning["tasks"]; commitments?: Planning["versions"][number]["dates"];
  comparing: boolean; personName: NameLookup;
}) {
  const held = deliveries.filter(({ date }) => !date.forecast).length;
  const original = Map.groupBy(tasks, task => task.checkId);
  const committed = new Map(commitments?.map(date => [date.checkId, date.day]));

  return (
    <section aria-labelledby="scheduled-deliveries" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="scheduled-deliveries" className="text-base font-semibold tracking-tight">Delivery outlook</h2>
        {held > 0 && <span className="text-xs text-muted-foreground">{held} of {deliveries.length} held</span>}
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {deliveries.map(delivery => (
          <DeliveryRow key={delivery.check.id} delivery={delivery}
            committed={committed.get(delivery.check.id)}
            initial={original.get(delivery.check.id)?.map(task => task.day).sort().at(-1)}
            comparing={comparing} personName={personName} />
        ))}
      </ul>
    </section>
  );
}

function DeliveryRow({ delivery: { check, work, date }, committed, initial, comparing, personName }: {
  delivery: Forecast["deliveries"][number]; committed?: string; initial?: string; comparing: boolean; personName: NameLookup;
}) {
  const id = "delivery-" + check.id;
  const holds = uniqueHolds(work.flatMap(row => row.holds));
  const conflicts = [...new Set(work.flatMap(row => row.conflicts))];
  const recoveries = [...new Map(work.flatMap(({ recovery }) => recovery ? [[recovery.caseId, recovery] as const] : [])).values()];

  return (
    <li>
      <details id={id} tabIndex={-1} className={cn(recordAnchor, planningColumns, "px-3 sm:px-4")}>
        <summary className={cn(disclosure, acrossRow, "grid items-center gap-y-2 py-3 hover:bg-muted/35")}>
          <span className="flex min-w-0 items-start gap-2">
            <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            <span className="grid min-w-0 gap-0.5">
              <strong>{check.unit.serial}</strong>
              <span className="text-xs text-muted-foreground">{check.unit.revision}</span>
            </span>
          </span>
          <DeliveryDates date={date} committed={committed} initial={initial} comparing={comparing} />
          <DeliveryStatus date={date} committed={committed} holds={holds} conflicts={conflicts} />
        </summary>
        <div className={cn(acrossRow, "grid gap-y-2 border-t bg-muted/20 py-2.5 text-[13px] max-lg:pl-6")}>
          <PlanningRelatedRows holds={holds} conflicts={conflicts} recoveries={recoveries}
            sourceId={id} personName={personName} />
          {!holds.length && !conflicts.length && !recoveries.length && <p className="lg:col-span-full lg:pl-6">Forecast is based on the scheduled reservations and available capacity.</p>}
        </div>
      </details>
    </li>
  );
}

function PlanningRelatedRows({ holds, conflicts, recoveries, sourceId, personName }: {
  holds: PlannedTask["holds"]; conflicts: string[]; recoveries: NonNullable<PlannedTask["recovery"]>[];
  sourceId: string; personName: NameLookup;
}) {
  if (!holds.length && !conflicts.length && !recoveries.length) return null;

  const row = cn(acrossRow, "grid gap-y-0.5 py-1.5");
  return (
    <ul className={cn(acrossRow, "divide-y divide-border/70")}>
      {holds.map(({ reason, owner, connection }) => (
        <li key={JSON.stringify([connection?.href, owner, reason])} className={row}>
          <span className="lg:col-span-2 lg:pl-6">{reason}</span>
          <span className="text-xs text-muted-foreground lg:leading-5">{personName(owner)}</span>
          {connection && <span className="lg:col-start-4"><ConnectionLink sourceId={sourceId} connection={connection} /></span>}
        </li>
      ))}
      {conflicts.length > 0 && <li className={row}>
        <span className="lg:col-span-2 lg:pl-6">{conflicts.join(" · ")}</span>
      </li>}
      {recoveries.map(recovery => (
        <li key={recovery.caseId} className={row}>
          <span className="lg:col-span-2 lg:pl-6">Reviewed supplier date <DateText day={recovery.readyOn} /></span>
          <span className="lg:col-start-4"><ConnectionLink sourceId={sourceId} connection={{
            href: toolHref("recovery", recovery.caseId), label: "Recovery decision",
            location: "Production · Recovery", identity: recovery.title,
          }} /></span>
        </li>
      ))}
    </ul>
  );
}

function DeliveryStatus({ date, committed, holds, conflicts }: {
  date: Forecast["deliveries"][number]["date"]; committed?: string; holds: PlannedTask["holds"]; conflicts: string[];
}) {
  const late = Boolean(date.forecast && date.forecast > (committed ?? date.day));
  const atRisk = committed && (!date.forecast || late);
  const status = late ? "Slipping" : conflicts.length && date.forecast ? "Conflict" : undefined;
  const headline = holds[0]?.reason ?? conflicts[0];

  return (
    <span className="grid gap-1 pl-6 text-xs lg:pl-0">
      {(status || atRisk) && <span className="flex flex-wrap items-center gap-1.5">
        {status && <Badge variant="secondary">{status}</Badge>}
        {atRisk && <span className="font-medium">Commitment at risk</span>}
      </span>}
      {headline && <span className="text-muted-foreground">
        {headline}{holds.length > 1 ? " · +" + (holds.length - 1) + " more" : ""}
      </span>}
    </span>
  );
}

function DeliveryDates({ date, committed, initial, comparing }: {
  date: Forecast["deliveries"][number]["date"]; committed?: string; initial?: string; comparing: boolean;
}) {
  return (
    <span className="grid grid-cols-2 items-start gap-y-1 pl-6 text-xs max-lg:gap-x-3 lg:col-span-2 lg:grid-cols-subgrid lg:pl-0">
      <span className="grid gap-1">
        {(comparing || !committed || date.day !== committed) && <DateDatum label="Planned" day={date.day} />}
        {committed && <DateDatum label="Committed" day={committed} />}
        {!committed && comparing && initial && <DateDatum label="Initial target" day={initial} />}
      </span>
      <DateDatum label="Forecast" day={date.forecast} />
    </span>
  );
}

function DateDatum({ label, day }: { label: string; day: string | null }) {
  return <span className="grid gap-0.5">
    <span className="text-muted-foreground">{label}</span>
    {day ? <span className="font-medium"><DateText day={day} /></span> : <Badge variant="secondary">Held</Badge>}
  </span>;
}

function reservationStatus(row: PlannedTask) {
  if (row.holds.length) return row.conflicts.length ? "Held with conflict" : "Held";
  if (row.conflicts.length) return "Conflict";
  return row.forecast && row.forecast > row.slot.day ? "Slipping" : "Scheduled";
}

function ReservationAgenda({ rows, changed, planning, slots, users, personName, stationName, onChange }: {
  rows: PlannedTask[]; changed: Map<string, Reservation>; planning: Planning; slots: Reservation[]; users: readonly { id: string; name: string }[];
  personName: NameLookup; stationName: NameLookup; onChange: (slot: Reservation) => void;
}) {
  const [editor, setEditor] = useState<{ reservation: PlannedTask; open: boolean }>();
  const editing = editor?.reservation;
  const section = useRef<HTMLElement>(null);
  const sorted = rows.toSorted((a, b) => a.slot.day.localeCompare(b.slot.day) || a.id.localeCompare(b.id));

  return (
    <section ref={section} aria-labelledby="planning-reservations" tabIndex={-1} className="grid min-w-0 gap-2">
      <h2 id="planning-reservations" className="text-base font-semibold tracking-tight">Reservations</h2>
      <RecordResults records={sorted} searchLabel="Search reservations" statusLabel="Reservation status" emptyMatch="No matching reservations"
        searchText={({ title, check, slot }) => [title, check.unit.serial, check.unit.revision, slot.day,
          dateLabel.format(new Date(slot.day)), personName(slot.person), stationName(slot.station)].join(" ")}
        status={reservationStatus}>
        {matches => (
          <div className="grid gap-3">
            {Array.from(Map.groupBy(matches, row => row.slot.day), ([day, reservations]) => (
              <div key={day} className="overflow-hidden rounded-lg border bg-card">
                <h3 className="border-b bg-muted/45 px-3 py-2 text-xs font-semibold">
                  <time dateTime={day}>{agendaDate.format(new Date(day))}</time>
                </h3>
                <ul className="divide-y">
                  {reservations.map(work => (
                    <ReservationRow key={work.id} work={work} before={changed.get(work.id)}
                      predecessor={planning.tasks.find(task => task.id === work.after)?.title}
                      edit={() => setEditor({ reservation: work, open: true })} personName={personName} stationName={stationName} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </RecordResults>
      {editing && editor && (
        <Dialog open={editor.open}
          onOpenChange={open => setEditor({ ...editor, open })}
          onOpenChangeComplete={open => {
            if (open) return;
            setEditor(undefined);
            // A date change can remount the edit button under a different day.
            requestAnimationFrame(() => {
              (document.getElementById("edit-reservation-" + editing.id) ?? section.current)?.focus();
            });
          }}>
          <FormDialog
            heading="Edit reservation"
            description={editing.title + " · " + editing.check.unit.serial + " · " + editing.check.unit.revision}
            submit="Apply to draft"
            finalFocus={false}
            onSubmit={fields => {
              const day = fields.get("day");
              if (!validDay(day)) return "Enter a valid date.";
              return () => {
                onChange({ task: editing.slot.task, day, person: String(fields.get("person")), station: String(fields.get("station")) });
                setEditor({ ...editor, open: false });
              };
            }}
          >
            <ReservationFields reservation={editing} stations={planning.stations} slots={slots} users={users} />
          </FormDialog>
        </Dialog>
      )}
    </section>
  );
}

function ReservationFields({ reservation, stations, slots, users }: {
  reservation: PlannedTask; stations: Planning["stations"]; slots: Reservation[]; users: readonly { id: string; name: string }[];
}) {
  const [day, setDay] = useState(reservation.slot.day);
  const allowed = reservation.stations.map(id => ({ id, station: stations.find(candidate => candidate.id === id) }));
  const bookings = Map.groupBy(slots.filter(slot => slot.day === day && slot.task !== reservation.id), slot => slot.station);

  return (
    <>
      <TextField label="Date" name="day" type="date" value={day} onChange={event => setDay(event.target.value)} required />
      <PersonField name="person" label="Assigned person" defaultValue={reservation.slot.person} people={users} required />
      <LabeledSelect name="station" label="Station" defaultValue={reservation.slot.station} required
        options={allowed.map(({ id, station }) => ({ value: id, label: station?.name ?? id }))} />
      {validDay(day) && (
        <div className="grid gap-1 rounded-md bg-muted/50 px-2.5 py-2 text-xs" aria-live="polite">
          <p className="text-muted-foreground">Other bookings across the full schedule · Weekdays only</p>
          <ul className="grid gap-1">
            {allowed.map(({ id, station }) => (
              <li key={id} className="flex flex-wrap justify-between gap-x-3">
                <span>{station?.name ?? id}</span>
                {station ? (
                  <span className="tabular-nums">
                    {bookings.get(id)?.length ?? 0} of {station.capacity} booked
                    {station.closed.includes(day) && " · Closed"}
                  </span>
                ) : <span>Capacity unavailable</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ReservationRow({ work, before, predecessor, edit, personName, stationName }: {
  work: PlannedTask; before?: Reservation; predecessor?: string; edit: () => void; personName: NameLookup; stationName: NameLookup;
}) {
  const id = "reservation-" + work.id;
  const { check, slot } = work;
  const { records } = useAssembly();
  const build = records.production.find(record => record.id === check.buildId);
  const status = reservationStatus(work);
  return (
    <li className="relative px-3 py-2.5 sm:px-4">
      <details id={id} tabIndex={-1} className={cn(recordAnchor, planningColumns)}>
        <summary className={cn(disclosure, acrossRow, "grid items-start gap-y-1 max-lg:pr-12")}>
          <span className="flex items-start gap-2">
            <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            <span className="grid min-w-0 gap-1">
              <strong>{work.title}</strong>
              {(status !== "Scheduled" || before) && (
                <span className="flex flex-wrap items-center gap-1">
                  {status !== "Scheduled" && <Badge variant="secondary">{status}</Badge>}
                  {before && <Badge variant="outline">Changed</Badge>}
                </span>
              )}
            </span>
          </span>
          <span className="flex flex-wrap pl-6 text-xs text-muted-foreground max-lg:gap-x-1 lg:col-span-3 lg:grid lg:grid-cols-subgrid lg:pl-0">
            <span>{check.unit.serial}</span>
            <span><span className="lg:hidden" aria-hidden="true">· </span>{personName(slot.person)}</span>
            <span className="lg:pr-14"><span className="lg:hidden" aria-hidden="true">· </span>{stationName(slot.station)}</span>
          </span>
        </summary>
        <div className={cn(acrossRow, "grid gap-y-2 pt-3 text-[13px] max-lg:pl-6 lg:[&>nav]:col-span-full lg:[&>nav]:pl-6")}>
          <div className={cn(acrossRow, "grid gap-y-0.5 text-xs text-muted-foreground")}>
            {predecessor && <p className="lg:col-span-2 lg:pl-6">After {predecessor}</p>}
            {before && <p className="lg:col-start-3">Baseline <DateText day={before.day} /> · {personName(before.person)} · {stationName(before.station)}</p>}
            <p className="lg:col-start-4">Forecast {work.forecast ? <DateText day={work.forecast} /> : "held"}</p>
          </div>
          <PlanningRelatedRows holds={work.holds} conflicts={work.conflicts}
            recoveries={work.recovery ? [work.recovery] : []} sourceId={id} personName={personName} />
          <ConnectionList title="Reservation records" sourceId={id} links={[
            build ? connectionToRecord("production", { ...build, unit: check.unit })
              : recordConnection("production", check.buildId, check.unit, {
                label: "Unavailable work order", view: "Builds", identity: check.buildId, unavailable: true,
              }),
            ...work.travelers.map(traveler => ({
              href: toolHref("traveler", traveler.caseId, "traveler-action"),
              label: "Released traveler · " + traveler.edition, location: "Production · Builds",
            })),
            ...work.materials.map(buildMaterialLink),
          ]} />
        </div>
      </details>
      <Button id={"edit-" + id} size="sm" variant="ghost" className="absolute top-2 right-3 sm:right-4"
        aria-label={"Edit " + work.title + " for " + check.unit.serial} onClick={edit}>
        <Pencil data-icon="inline-start" /> <span className="hidden sm:inline">Edit</span>
      </Button>
    </li>
  );
}

function PlanHistory({ planning, checks, scopedChecks }: {
  planning: Planning; checks: readonly PlannedTask["check"][]; scopedChecks?: ReadonlySet<string>;
}) {
  const versions = planning.versions.flatMap(version => {
    const dates = version.dates.filter(date => !scopedChecks || scopedChecks.has(date.checkId));

    return dates.length ? [{ version, dates }] : [];
  });
  if (!versions.length) return null;
  const checkById = new Map(checks.map(check => [check.id, check]));

  return (
    <details className="group rounded-lg border bg-card">
      <summary className={cn(disclosure, "flex items-center gap-2 px-3 py-3 font-medium hover:bg-muted/35")}>
        <History className="size-4" aria-hidden="true" /> Published history
        <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y border-t px-3">
        {versions.map(({ version, dates }) => (
          <li key={version.version} className="py-2">
            <details>
              <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                <strong>Plan v{version.version}</strong> · {planning.scenarios.find(scenario => scenario.id === version.scenario)?.title}
                <span className="block text-xs text-muted-foreground">{formatUtcDateTime(version.publishedAt)}</span>
              </summary>
              <ul className="grid gap-2 py-2 text-xs">
                {dates.map(date => {
                  const check = checkById.get(date.checkId);
                  return <li key={date.checkId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <strong>{check ? check.unit.serial + " · " + check.unit.revision : date.checkId}</strong>
                    <span>Committed <DateText day={date.day} /></span>
                    <span>Forecast at publication {date.forecast ? <DateText day={date.forecast} /> : "held"}</span>
                  </li>;
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
