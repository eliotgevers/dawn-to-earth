import { fleetPrograms, missionIndex } from "@/components/operations/fleet/index-records";
import { combinedItemDetails, includesUnit, type ItemSelection } from "@/components/workspace/selection";
import { loadCatalog, readPublicReferences } from "@/db/catalog";
import { db, type Reader } from "@/db/connection";
import { flightComments, readAuroraService, readCalendar, readFlightArchive } from "@/db/operations/aurora";
import { readProduction } from "@/db/records/assembly";
import { catalogSpacecraft } from "@/db/schema";
import { readReadinessWorkspace } from "@/db/verification/release";
import { readOperationsStudy } from "@/db/operations/study";
import { debriefQuery, flightDateRange, sourceFor } from "@/lib/archives/aurora";
import { studyScope } from "@/lib/archives/study";
import { forecastPlan, workingSchedule } from "@/lib/planning";
import { packetBasis, unitReadiness } from "@/lib/readiness";
import { sameUnit } from "@/lib/records/journal";
import { withSelections } from "@/lib/workspace-routes";
import type { AskContext, AskSource } from "../sources";

type Scope = readonly ItemSelection[];
type View = "readiness" | "fleet" | "flight" | "recordings" | "service" | "calendar" | "planning";

function source(id: string, title: string, href: string, ...facts: (string | undefined | null)[]): AskSource {
  const anchor = href.split("#")[1];
  return { id, ref: anchor && decodeURIComponent(anchor) !== id ? decodeURIComponent(anchor) : undefined,
    kind: href.startsWith("/production") ? "Production" : "Operations", title, href, excerpt: facts.filter(Boolean).join(" · ") };
}

async function readiness(database: Reader, scope: Scope, query = "") {
  if (!scope.length) return [];
  const workspace = await readReadinessWorkspace(database);
  const units = combinedItemDetails(workspace.records.catalog, scope)?.members ?? [];

  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return units.flatMap(unit => {
    const title = workspace.records.catalog.units.find(row => row.serial === unit.serial)?.title;
    const label = [unit.serial, title, unit.revision, unit.revisionId].join(" ").toLowerCase();
    if (!terms.every(word => label.includes(word))) return [];

    const { contents, issues, blockers, checks } = unitReadiness(workspace, unit);
    const packets = workspace.packets.filter(packet => sameUnit(packet, unit));
    const current = packets[0]?.contents;
    const status = blockers.length ? "Held" : current && packetBasis(current) === packetBasis(contents) ? "Signed" : "Ready for sign-off";
    const id = "unit-" + unit.serial + "-" + unit.revisionId;
    const href = (anchor: string) => withSelections("/operations#" + encodeURIComponent(anchor), scope);

    return [source(id, unit.serial + " · " + status, href(id), title, unit.revision,
      contents.builds.length + " builds", contents.inspections.length + " / " + checks.length + " accepted inspections",
      issues.length + " open issues", ...blockers.map(blocker => {
        const owner = workspace.actors.find(person => person.id === blocker.owner)?.name ?? blocker.nextOwner;
        return [blocker.reason, owner].filter(Boolean).join(" — ");
      })), ...packets.map(packet => source("packet-" + packet.id, unit.serial + " · Packet v" + packet.version,
        href("packet-" + packet.id), unit.revision, packet.receipt?.outcome))];
  });
}

async function planning(database: Reader, scope: Scope, selected?: string, recordId?: string | null) {
  const { schedule, records, local, execution, actors } = await readProduction(database, "planning");
  if (!schedule) return [];
  const item = combinedItemDetails(records.catalog, scope);
  if (scope.length && !item) return [];

  const plan = { ...schedule, execution };
  const exact = plan.scenarios.find(row => row.id === recordId);
  const { slots, scenario, current } = workingSchedule(plan, exact?.id ?? selected ?? "current");
  const forecast = forecastPlan(plan, slots, records, local);
  const deliveries = forecast.deliveries.filter(({ check }) => !item || includesUnit(item, check.unit))
    .sort((a, b) => a.date.day.localeCompare(b.date.day) || a.check.unit.serial.localeCompare(b.check.unit.serial));
  const url = new URLSearchParams({ view: "planning" });
  if (scenario) url.set("scenario", scenario.id);
  const href = (anchor?: string) => withSelections("/production?" + url + (anchor ? "#" + encodeURIComponent(anchor) : ""), scope);
  const scheduleName = scenario?.title ?? (current ? "Published plan v" + current.version : "Initial reservations");

  const scenarios = plan.scenarios.map(row => source(row.id, row.title,
    withSelections("/production?" + new URLSearchParams({ view: "planning", scenario: row.id }), scope), "Planning schedule scenario"));
  const rows = deliveries.flatMap(({ check, date, work }) => {
    const id = "delivery-" + check.id;
    return [source(id, check.unit.serial + " · Delivery outlook", href(id), scheduleName, check.unit.revision,
      "Planned " + date.day, date.forecast ? "Forecast " + date.forecast : "Held",
      ...new Set(work.flatMap(row => row.holds.map(hold => hold.reason)))), ...work.map(row => {
        const anchor = "reservation-" + row.id;
        return source(anchor, row.title, href(anchor), scheduleName, check.unit.serial, check.unit.revision, row.slot.day,
          actors.find(actor => actor.id === row.slot.person)?.name, plan.stations.find(station => station.id === row.slot.station)?.name,
          ...row.conflicts, ...row.holds.map(hold => hold.reason));
      })];
  });
  const name = current ? "Published plan v" + current.version : "Initial reservations";
  const currentLink = withSelections("/production?view=planning", scope);

  const summary = source("schedule-summary", scheduleName + " · Schedule summary", href(), deliveries.length + " scoped deliveries",
    forecast.conflicts + " reservations with conflicts across the full schedule");
  if (exact) return [summary, ...rows].map(row => ({ ...row, ref: exact.id }));

  return [...rows, source("current", name, currentLink, "Current schedule"), ...scenarios, summary];
}

async function fleet(database: Reader, scope: Scope, context?: AskContext) {
  const [catalog, references, spacecraft] = await Promise.all([
    loadCatalog(database), readPublicReferences(database),
    database.select({ data: catalogSpacecraft.data }).from(catalogSpacecraft).orderBy(catalogSpacecraft.noradId),
  ]);
  const projects = new Set(studyScope(catalog, scope).projectIds);
  const missions = missionIndex(catalog, references).filter(record => projects.has(record.id));
  const owners = new Map(missions.map(record => [record.id, record]));
  const known = new Set(spacecraft.map(({ data }) => data.projectId));

  const craft = spacecraft.flatMap(({ data }) => {
    const mission = owners.get(data.projectId);
    if (!mission || context?.program || (context?.sat && context.sat !== String(data.noradId))) return [];
    return [source(String(data.noradId), data.name, "/operations/fleet?sat=" + data.noradId,
      mission.title, mission.customer, mission.description, "NORAD " + data.noradId,
      "Launch " + data.launchDate, data.decayDate && "Documented reentry " + data.decayDate)];
  });
  return [...craft, ...missions.flatMap(mission => {
    if (known.has(mission.id) || !mission.reference || !fleetPrograms.has(mission.reference.id) ||
        context?.sat || (context?.program && context.program !== mission.id)) return [];

    return [source(mission.id, mission.title, "/operations/fleet?program=" + encodeURIComponent(mission.id),
      mission.customer, mission.reference.summary, mission.reference.status, "Program without an identified spacecraft entry")];
  })];
}

export async function operationSources(view: View, scope: Scope, context: AskContext = {}, recordId?: string | null): Promise<AskSource[]> {
  if (!db) throw new Error("Database is unavailable");
  if (view === "fleet") return fleet(db, scope, context);
  if (view === "readiness") return readiness(db, scope, !context.path || context.path === "/operations" ? context.q : undefined);
  if (view === "planning") return planning(db, scope, context.scenario, recordId);

  const href = (params: Record<string, string>, anchor?: string) =>
    withSelections("/operations/aurora?" + new URLSearchParams(params) + (anchor ? "#" + encodeURIComponent(anchor) : ""), scope);
  if (view === "recordings") {
    const { availableArchives, targets, entries, selected } = await readOperationsStudy(db, "aurora", context.finding, [...scope]);
    const archives = scope.length ? targets : availableArchives;
    const recordings = archives.flatMap(target => target.subjects.flatMap(subject => {
      const filed = sourceFor(subject);
      if (!filed || (context.align && filed.event !== context.align)) return [];

      const { pair, event } = filed;
      const query = new URLSearchParams({ view, ...debriefQuery(pair, event) });
      const item = "scope" in target ? target.scope.selection : target.selection;
      const link = withSelections("/operations/aurora?" + query, [item]);

      return [{ ...source(subject, filed.label, link, "Fictional image comparison", pair.question,
        "Returned " + pair.reviewed.id, "Reference " + pair.reference.id), ref: pair.id }];
    }));
    const findings = entries.filter(entry => !context.finding || selected?.id === entry.id).map(entry =>
      source(entry.id, entry.label, href({ view, finding: entry.id }, "recorded-finding"),
        entry.edition, entry.outcome, "Frames " + entry.first + "–" + entry.last, entry.note));

    return [...recordings, ...findings];
  }
  if (view === "service") {
    const { records, flights, documents } = await readAuroraService(db, scope);
    const exactFlight = flights.find(flight => flight.id === recordId);
    const selected = exactFlight?.id ?? context.flight;
    return records.filter(row => !selected || row.flightId === selected).flatMap(row => {
      const params = { view: "service", flight: row.flightId };
      const filed = row.filing;
      const linked = [filed?.evidenceId, filed?.completionEvidenceId, filed?.returnRecordId];
      const work = source(row.id, row.work, href(params, "service-" + row.id), row.example ? "Demo" : "Workspace",
        flights.find(flight => flight.id === row.flightId)?.title, row.status, row.owner, filed?.category,
        filed?.dueOn && "Due " + filed.dueOn);
      return [exactFlight ? { ...work, ref: exactFlight.id } : work, ...documents.filter(doc => doc.flightId === row.flightId && linked.includes(doc.id))
        .map(doc => source(doc.id, doc.title, href({ ...params, record: row.id, document: doc.id }),
          "Demo document", doc.kind, doc.filedOn, doc.filedBy, doc.body))];
    });
  }
  if (view === "calendar") {
    const calendar = await readCalendar(db, scope);
    if ("error" in calendar) return [];
    const isoDate = recordId?.match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:-(?:0[1-9]|[12]\d|3[01]))?$/);
    const day = isoDate ? (isoDate[0].length === 10 ? isoDate[0] : undefined) : context.day;
    const month = isoDate?.[1] ?? day?.slice(0, 7) ?? context.month ??
      (context.path === "/operations/aurora" && context.view === "calendar" ? new Date().toISOString().slice(0, 7) : undefined);
    const dayLink = (date: string) => href({ view: "calendar", month: date.slice(0, 7), day: date }, "calendar-" + date);
    const entries = calendar.entries.filter(row => (!day || row.day === day) && (!month || row.day.startsWith(month)));
    const rows = [...entries.map(row => source(row.id, row.title, dayLink(row.day),
      row.example ? "Demo" : "Workspace", row.day, row.kind, row.status)), ...calendar.reports.flatMap(row => {
      const range = flightDateRange(row);
      if (day && (range?.precision !== "day" || range.start !== day)) return [];
      if (month && range && (range.start.slice(0, 7) > month || range.end.slice(0, 7) < month)) return [];
      return [source(row.id, row.title, range?.precision === "day" ? dayLink(range.start) : href({ flight: row.id }),
        "Published " + row.kind, row.period, row.precision + " precision", row.summary)];
    })];
    return isoDate ? rows.map(row => ({ ...row, ref: isoDate[0] })) : rows;
  }

  const { reports } = await readFlightArchive(db, scope);
  const exactFlight = reports.find(row => row.id === recordId);
  const selected = exactFlight?.id ?? context.flight;
  const rows = selected ? reports.filter(row => row.id === selected) : reports;
  const sources = rows.map(row => {
    const linkScope = scope.length ? scope : [`project:${row.projectId}` as const];
    const link = withSelections("/operations/aurora?" + new URLSearchParams({ flight: row.id }), linkScope);
    return source(row.id, row.title, link, "Published " + row.kind, row.period, row.site,
      row.flightNumber ? "Flight " + row.flightNumber : undefined, row.flightCount ? row.flightCount + " flights" : undefined,
      row.summary, row.footage && "Flight footage available");
  });
  if (selected && rows[0]?.kind === "flight") {
    for (const comment of await flightComments(db, rows[0].id)) {
      const debrief = source(comment.id, rows[0].title + " · Flight Debrief", href({ flight: rows[0].id }, "flight-debrief"),
        comment.example ? "Demo comment" : "Workspace comment", comment.author, comment.recordedAt, comment.body);
      sources.push(exactFlight ? { ...debrief, ref: exactFlight.id } : debrief);
    }
  }

  return sources;
}
