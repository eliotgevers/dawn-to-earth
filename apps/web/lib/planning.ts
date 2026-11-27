import type { Reservation } from "@/db/schema";
import type { AssemblyRecord } from "@/db/records/assembly";
import type { Catalog } from "@/components/catalog/store";
import type { readProductionExecution } from "@/db/operations/tools";
import type { readSchedule } from "@/db/planning";
import { executionForBuild } from "@/components/production/builds";
import { toolHref } from "./workspace-routes";
import { type RecordEntry, recordDecision, isRemovedRecord } from "./records/journal";
import { unavailableUnitLink } from "./readiness";
import { connectionToRecord } from "@/components/records/schema";
import { recordField, type RecordConnection } from "./records/links";
import { acceptanceState, acceptanceReviewConnection, type AcceptanceCheck } from "@/components/verification/acceptance";

export type Planning = Awaited<ReturnType<typeof readSchedule>> & Awaited<ReturnType<typeof readProductionExecution>>;
export type PlanningExecution = Planning["execution"];

type PlanHold = { reason: string; owner: string; connection?: RecordConnection };
export function uniqueHolds(holds: PlanHold[]) {
  return [...new Map(holds.map(hold => [JSON.stringify([hold.connection?.href, hold.owner, hold.reason]), hold])).values()];
}

// An existing scenario keeps its recorded slots. New work starts at its proposed date until a later publication.
export type ScheduleDraft = { slots: Reservation[]; baseVersion: number };

export function workingSchedule(plan: Planning, selected: string, draft?: ScheduleDraft) {
  const current = plan.versions[0];
  const version = current?.version ?? 0;
  const scenario = plan.scenarios.find(row => row.id === selected);
  const published = plan.scenarios.find(row => row.id === current?.scenario);
  const source = draft ?? scenario;
  const byTask = (slots?: Reservation[]) => new Map(slots?.map(slot => [slot.task, slot]));
  const committed = byTask(published?.slots);
  const saved = byTask(source?.slots);
  const changed = new Map<string, Reservation>();
  let newWork = false;

  // The current task roster drives the preview. Old scenarios and signed dates keep their original slots.
  const slots = plan.tasks.map(({ id: task, day, person, station }) => {
    const proposed = { task, day, person, station };
    const before = committed.get(task) ?? proposed;
    const chosen = saved.get(task);
    if (source && !chosen) newWork = true;
    const slot = chosen ?? (source ? proposed : before);
    if (before.day !== slot.day || before.person !== slot.person || before.station !== slot.station)
      changed.set(task, before);

    return slot;
  });

  const baseVersion = source?.baseVersion ?? version;
  const stale = baseVersion !== version || newWork || (!!source && source.slots.length !== slots.length);

  return { current, version, scenario, changed, slots, baseVersion, newWork, stale };
}

export function validDay(day: unknown): day is string {
  if (typeof day !== "string" || !/^20\d\d-\d\d-\d\d$/.test(day)) return false;
  const ms = Date.parse(day);

  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

const followingDay = (day: string) => new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
function workingDay(day: string, closures: readonly string[]) {
  const dow = new Date(day).getUTCDay();

  return dow !== 0 && dow !== 6 && !closures.includes(day);
}

type GateRecord = Pick<AssemblyRecord, "id" | "title" | "status" | "fields" | "reference" | "kind" | "origin">;
export type PlanningGates = {
  production: readonly GateRecord[];
  engineering: readonly GateRecord[];
  verification: { acceptanceChecks: readonly AcceptanceCheck[] };
};
export type PlannedTask = Pick<Planning["tasks"][number], "id" | "title" | "after" | "stations"> & {
  slot: Reservation;
  check: AcceptanceCheck;
  forecast: string | null;
  recovery?: NonNullable<Planning["recoveries"]>[number];
  conflicts: string[];
  holds: PlanHold[];
  travelers: PlanningExecution["travelers"];
  materials: PlanningExecution["materials"];
};

export function forecastPlan(
  plan: Pick<Planning, "tasks" | "stations" | "execution" | "recoveries">,
  slots: readonly Reservation[],
  records: PlanningGates & { catalog: Pick<Catalog, "units" | "archivedRows"> },
  local: readonly RecordEntry[],
) {
  const tasks = new Map(plan.tasks.map((t) => [t.id, t]));
  const stations = new Map(plan.stations.map((s) => [s.id, s]));
  const scheduled = new Set(plan.tasks.map(task => task.checkId));
  const checks = new Map(records.verification.acceptanceChecks.filter(check => scheduled.has(check.id)).map(check => [
    check.id, { check, unavailable: unavailableUnitLink(records.catalog, check.unit), execution: executionForBuild(check.buildId, check.unit, plan.execution) },
  ]));
  const definitions = new Map(
    [...records.production, ...records.engineering].map((r) => [r.id, r]),
  );

  const bookedPeople = Map.groupBy(slots, slot => slot.day + "/" + slot.person);
  const bookedStations = Map.groupBy(slots, slot => slot.day + "/" + slot.station);
  const bookings = new Map<string, number>();
  const rows = new Map<string, PlannedTask>();
  const ordered = [...slots].sort((a, b) => a.day.localeCompare(b.day) || a.task.localeCompare(b.task));

  // Resolve predecessors first. A held reservation still consumes its booked capacity.
  while (ordered.length) {
    const pos = ordered.findIndex((s) => {
      const task = tasks.get(s.task);

      return task && (!task.after || rows.has(task.after));
    });
    if (pos < 0) throw new Error("Unresolved planning dependency.");
    const [slot] = ordered.splice(pos, 1);
    const task = tasks.get(slot.task)!;
    const { check, unavailable, execution } = checks.get(task.checkId)!;
    const station = stations.get(slot.station)!;
    const previous = task.after ? rows.get(task.after) : undefined;
    const holds = [...(previous?.holds ?? [])];
    for (const hold of execution.holds) {
      holds.push({
        reason: "Traveler hold · " + hold.reason, owner: hold.owner,
        connection: { label: "Traveler discrepancy", location: "Production · Builds", href: toolHref("traveler", hold.caseId) + "#traveler-action" },
      });
    }
    const conflicts: string[] = [];
    const exact = check.unit;
    if (unavailable) holds.push({
      reason: "Unit archived or revision changed", owner: "Engineering",
      connection: { href: unavailable, label: "Unit " + exact.serial, location: "Catalog · Units" },
    });
    if (task.gate === "issue" || task.gate === "engineering") {
      const issue = task.gate === "issue";
      const id = issue ? task.issueId : check.changeId;
      const row = id ? definitions.get(id) : undefined;
      const status = !issue && id ? recordDecision(local, id, exact)?.status ?? row?.status : row?.status;
      if (!id || !row || isRemovedRecord(id, local, exact) || status !== (issue ? "Resolved" : "Approved")) {
        holds.push({
          reason: row ? row.title + " · " + status : `The ${issue ? "issue" : "change"} for this reservation is unavailable.`,
          owner: (row && recordField(row, "Decision owner")) || "Unassigned",
          connection: row && connectionToRecord(issue ? "production" : "engineering", { ...row, unit: exact }),
        });
      }
    }
    if (task.gate === "qa") {
      const qa = acceptanceState(check);
      if (!qa.accepted)
        holds.push({ reason: "QA · " + qa.stage, owner: check.owner, connection: acceptanceReviewConnection(check) });
    }

    const recovery = plan.recoveries?.find(r => r.planningTaskId === task.id && r.checkId === task.checkId &&
      r.issueId === task.issueId && r.unitSerial === exact.serial && r.revisionId === exact.revisionId);
    if (recovery && slot.day < recovery.readyOn) conflicts.push("Before the reviewed supplier date");
    if (bookedPeople.get(slot.day + "/" + slot.person)!.length > 1) conflicts.push("Person double-booked");
    if (bookedStations.get(slot.day + "/" + slot.station)!.length > station.capacity)
      conflicts.push(station.name + " over capacity");
    if (!workingDay(slot.day, station.closed)) conflicts.push("Calendar closed");
    if (previous && slot.day <= previous.slot.day) conflicts.push("Predecessor must finish first");

    let day = previous?.forecast && previous.forecast >= slot.day ? followingDay(previous.forecast) : slot.day;
    if (recovery && day < recovery.readyOn) day = recovery.readyOn;
    while (
      !workingDay(day, station.closed) ||
      bookings.has(day + "/" + slot.person) ||
      (bookings.get(day + "/station:" + slot.station) ?? 0) >= station.capacity
    )
      day = followingDay(day);
    bookings.set(day + "/" + slot.person, 1);
    bookings.set(day + "/station:" + slot.station, (bookings.get(day + "/station:" + slot.station) ?? 0) + 1);

    rows.set(task.id, {
      id: task.id, title: task.title, after: task.after, stations: task.stations,
      slot, check, forecast: holds.length ? null : day, conflicts, holds: uniqueHolds(holds), recovery,
      travelers: execution.travelers, materials: execution.materials,
    });
  }

  const groups = Map.groupBy(plan.tasks.map(task => rows.get(task.id)!), row => row.check.id);
  const deliveries = Array.from(groups, ([checkId, work]) => {
    const dates = work.map(row => row.forecast);

    return {
      check: work[0].check, work,
      date: {
        checkId,
        day: work.map(row => row.slot.day).sort().at(-1)!,
        forecast: dates.includes(null) ? null : dates.sort().at(-1)!,
      },
    };
  });

  const conflicts = [...rows.values()].filter((r) => r.conflicts.length).length;
  // Publishing confirms the dates and the observed blockers, including a QA hold reopened since preview.
  const stamp = JSON.stringify([...rows].map(([id, r]) => [id, r.forecast, r.holds.map(({ reason, owner, connection }) => ({ reason, owner, href: connection?.href })), r.conflicts, r.recovery?.eventId]));

  return { rows, deliveries, conflicts, stamp };
}
