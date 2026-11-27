"use client";

import { useState, type FormEvent } from "react";
import { saveCalendarAppointment } from "@/app/(sections)/operations/actions";
import Link from "next/link";
import { FlightReportLink } from "./view";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleDashed, ClipboardList, Plane, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RecordActionButton } from "@/components/records/actions";
import type { Appointment } from "@/db/operations/aurora";
import type { AuroraFlight } from "@/db/schema";
import { flightDateRange } from "@/lib/archives/aurora";

const monthFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Date(Date.UTC(2000, index)).toLocaleDateString("en", { month: "long", timeZone: "UTC" }));
const kinds = ["Flight", "Preparation", "Service", "Appointment"] as const;
const kindIcons = { Flight: Plane, Preparation: ClipboardList, Service: Wrench, Appointment: CalendarDays };
const kindColors = {
  Flight: "bg-violet-700", Preparation: "bg-green-700",
  Service: "bg-orange-700", Appointment: "bg-blue-700",
};
const selectStyle = "h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function monthOffset(month: string, difference: number) {
  const date = new Date(month + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + difference);
  return date.toISOString().slice(0, 7);
}

type Editor = { id: string; row?: Appointment; trigger: HTMLElement; day?: string };

function AppointmentEditor({ editor, items, close, refresh, saved }: {
  editor: Editor; items: readonly string[]; close: () => void; refresh: () => void; saved: (day: string) => void;
}) {
  const [draft, setDraft] = useState(editor.row);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  async function reloadLatest() {
    setSaving(true);
    const scope = new URLSearchParams(items.map(item => ["item", item]));
    let latest: Appointment | string;

    try {
      const response = await fetch("/api/aurora/calendar?" + scope, { cache: "no-store" });
      if (response.ok) {
        const { entries }: { entries: Appointment[] } = await response.json();
        latest = entries.find(entry => entry.id === editor.id) ?? "This appointment is no longer on the calendar.";
      } else {
        const { error } = await response.json();
        latest = typeof error === "string" && error ? error : "Could not reload the appointment.";
      }
    } catch {
      latest = "Could not reach the calendar. Try again.";
    }

    setSaving(false);
    if (typeof latest === "string") {
      setError(latest);
      return;
    }

    setDraft(latest);
    setError("");
    setConflict(false);
    refresh();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(fields), id: editor.id, previousUpdate: draft?.updatedAt };
    setSaving(true);
    const result = await saveCalendarAppointment(items, payload)
      .catch(() => ({ error: "Could not reach the calendar. Try again.", status: 0 }));
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      setConflict(result.status === 409 && !!draft);
      return;
    }
    saved(result.entry.day);
  }

  return <Dialog open onOpenChange={next => { if (!next && !saving) close(); }}>
    <DialogContent finalFocus={() => editor.trigger.isConnected ? editor.trigger : document.getElementById("aurora-calendar-title")}>
      <DialogHeader><DialogTitle>{editor.row ? "Edit appointment" : "Add appointment"}</DialogTitle></DialogHeader>
      <form key={draft?.updatedAt ?? "new"} onSubmit={save} className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium">Title
          <Input name="title" defaultValue={draft?.title} required maxLength={160} disabled={saving}/>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">Date
            <Input type="date" name="day" defaultValue={draft?.day ?? editor.day} required min="0001-01-01" max="9999-12-31" disabled={saving}/>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Status
            <select name="status" defaultValue={draft?.status ?? "Tentative"} disabled={saving} className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal">
              <option>Tentative</option><option>Confirmed</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">Kind
          <select name="kind" defaultValue={draft?.kind ?? "Preparation"} disabled={saving} className={selectStyle}>
            {Object.keys(kindIcons).map(kind => <option key={kind}>{kind}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          {conflict ? <Button type="button" onClick={reloadLatest} disabled={saving}>Reload latest version</Button> :
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save appointment"}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

type DatedReport = { report: AuroraFlight; range: ReturnType<typeof flightDateRange> };

type DayEntry = { report: AuroraFlight } | { appointment: Appointment };

function MonthGrid({ month, days, today, selected, calendarHref }: {
  month: string; days: Map<string, DayEntry[]>; today: string; selected: string | undefined; calendarHref: (day: string) => string;
}) {
  const first = new Date(month + "-01T00:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const cellCount = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return <table className="mt-3 w-full table-fixed border-collapse text-left text-sm">
    <caption className="sr-only">{monthFormat.format(first)} calendar. Select a date to see all its records.</caption>
    <thead><tr>{weekdays.map(weekday => <th key={weekday} scope="col" className="pb-2 ps-1.5 text-xs font-normal text-muted-foreground">{weekday}</th>)}</tr></thead>
    <tbody>{Array.from({ length: cellCount / 7 }, (_, week) => <tr key={week + "-" + month}>
      {weekdays.map((weekday, index) => {
        const n = week * 7 + index - offset + 1;
        if (n < 1 || n > last.getUTCDate()) return <td key={weekday} className="border-t bg-muted/30"/>;
        const date = month + "-" + String(n).padStart(2, "0");
        const records = days.get(date);
        const types = new Set(records?.map(entry => "report" in entry ? "Flight" : entry.appointment.kind));
        return <td key={weekday} className="relative h-12 border-t align-top sm:h-15">
          {records ? <Link href={calendarHref(date)} aria-current={selected === date ? "true" : undefined}
            aria-label={date + ", " + records.length + (records.length === 1 ? " entry" : " entries") + ", " + Array.from(types).join(", ")}
            className="group absolute inset-px isolate flex overflow-hidden rounded-sm text-white focus-visible:z-10">
            {kinds.filter(kind => types.has(kind)).map(kind => {
              const Icon = kindIcons[kind];
              return <span key={kind} aria-hidden className={"flex min-w-0 flex-1 items-end justify-center border-s border-white/55 pb-1.5 first:border-s-0 " + kindColors[kind]}>
                <Icon className="size-3 max-w-full sm:size-3.5"/>
              </span>;
            })}
            <time dateTime={date} aria-current={date === today ? "date" : undefined}
              className="absolute start-1 top-0.5 font-semibold group-hover:underline group-aria-current:underline sm:start-1.5">{n}</time>
          </Link> : <time dateTime={date} aria-current={date === today ? "date" : undefined}
            className="inline-block rounded-sm p-1 text-muted-foreground aria-[current=date]:bg-primary aria-[current=date]:font-semibold aria-[current=date]:text-primary-foreground sm:p-1.5">{n}</time>}
        </td>;
      })}
    </tr>)}</tbody>
  </table>;
}

function ReportPeriods({ rows, items }: { rows: DatedReport[]; items: readonly string[] }) {
  if (!rows.length) return null;
  return <ul className="divide-y">{rows.map(({ report, range }) => <li key={report.id} className="grid gap-0.5 py-2 text-sm">
    <span className="text-xs text-muted-foreground">{report.period} · {range?.precision === "range"
      ? (report.kind === "campaign" ? "Campaign window" : "Individual flight day unreported")
      : range?.precision === "month" ? "Day unreported" : range?.precision === "year" ? "Month and day unreported" : "Date unreported"}</span>
    <FlightReportLink report={report} items={items}/>
  </li>)}</ul>;
}

function calendarMonth(month: string, currentYear: number, initial: Appointment[], reports: readonly AuroraFlight[]) {
  const dated = reports.map(report => ({ report, range: flightDateRange(report) }));
  const years = new Set([Number(month.slice(0, 4)), currentYear, ...initial.map(row => Number(row.day.slice(0, 4)))]);
  for (const { range } of dated) if (range) {
    years.add(Number(range.start.slice(0, 4)));
    years.add(Number(range.end.slice(0, 4)));
  }
  for (let y = currentYear - 6; y <= currentYear + 2; y++) years.add(y);
  const selectableYears = Array.from(years).sort((a, b) => a - b);
  const days = new Map<string, DayEntry[]>();
  function addDay(date: string, entry: DayEntry) {
    const existing = days.get(date);
    if (existing) existing.push(entry);
    else days.set(date, [entry]);
  }
  for (const row of initial) if (row.day.startsWith(month)) addDay(row.day, { appointment: row });
  const wider: DatedReport[] = [];
  const imprecise: DatedReport[] = [];
  for (const entry of dated) {
    const range = entry.range;
    if (!range) { imprecise.push(entry); continue; }
    if (range.start.slice(0, 7) > month || range.end.slice(0, 7) < month) continue;
    if (range.precision === "day") addDay(range.start, { report: entry.report });
    else if (range.precision === "year") imprecise.push(entry);
    else wider.push(entry);
  }

  return { days, wider, imprecise, selectableYears };
}

export default function AuroraCalendar({ items, initial, reports }: {
  items: readonly string[]; initial: Appointment[]; reports: readonly AuroraFlight[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const requested = search.get("month") ?? "";
  const month = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const [editor, setEditor] = useState<Editor | null>(null);

  function showMonth(value: string) {
    if (value === month && !search.has("day")) return;
    const url = new URL(window.location.href);
    url.searchParams.set("month", value);
    url.searchParams.delete("day");
    url.hash = "";
    window.history.pushState(null, "", url);
  }

  const { days, wider, imprecise, selectableYears } =
    calendarMonth(month, Number(today.slice(0, 4)), initial, reports);

  const requestedDay = search.get("day") ?? "";
  const selectedDay = days.has(requestedDay) ? requestedDay : undefined;
  const agenda = selectedDay ? [[selectedDay, days.get(selectedDay)!] as const] :
    Array.from(days).sort(([a], [b]) => a.localeCompare(b));
  function calendarHref(day?: string) {
    const params = new URLSearchParams(search);
    params.set("month", month);
    if (day) params.set("day", day);
    else params.delete("day");
    return "/operations/aurora?" + params + (day ? "#calendar-" + day : "");
  }

  return <section className="min-w-0 max-w-6xl" aria-labelledby="aurora-calendar-title">
    <h2 id="aurora-calendar-title" tabIndex={-1} className="sr-only">Aurora calendar</h2>
    <header className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="Previous month" disabled={month === "0001-01"} onClick={() => showMonth(monthOffset(month, -1))}><ChevronLeft/></Button>
        <select aria-label="Month" className={selectStyle} value={month.slice(5)} onChange={event => showMonth(month.slice(0, 5) + event.target.value)}>
          {monthNames.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}
        </select>
        <select aria-label="Year" className={selectStyle} value={year} onChange={event => showMonth(event.target.value.padStart(4, "0") + month.slice(4))}>
          {selectableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button size="icon-sm" variant="ghost" aria-label="Next month" disabled={month === "9999-12"} onClick={() => showMonth(monthOffset(month, 1))}><ChevronRight/></Button>
      </div>
      <Button size="sm" variant="outline" onClick={() => showMonth(today.slice(0, 7))}>Today</Button>
      <Button size="sm" variant="outline" className="bg-popover sm:ms-auto" onClick={event => setEditor({ id: crypto.randomUUID(), trigger: event.currentTarget,
        day: today.startsWith(month) ? today : month + "-01" })}><Plus aria-hidden/>Add appointment</Button>
    </header>
    <div className="mt-4 grid min-w-0 gap-y-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,1fr)] lg:gap-x-7">
      <div className="min-w-0">
        <MonthGrid month={month} days={days} today={today} selected={selectedDay} calendarHref={calendarHref}/>
        <ul aria-label="Calendar legend" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {kinds.map(kind => {
            const Icon = kindIcons[kind];
            return <li key={kind} className="inline-flex items-center gap-1"><span className={"rounded-sm p-0.5 text-white " + kindColors[kind]}><Icon aria-hidden className="size-3"/></span>{kind}</li>;
          })}
        </ul>
        {wider.length > 0 && <section className="mt-5 border-t pt-3"><h3 className="text-sm font-semibold">Reported periods</h3><ReportPeriods rows={wider} items={items}/></section>}
        {imprecise.length > 0 && <details className="mt-4 border-t pt-3"><summary className="w-fit cursor-pointer text-sm font-medium">Reports without a known month ({imprecise.length})</summary><ReportPeriods rows={imprecise} items={items}/></details>}
      </div>
      <section className="min-w-0 lg:border-s lg:ps-6" aria-label="Monthly agenda">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{selectedDay
            ? new Date(selectedDay + "T00:00:00Z").toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
            : monthFormat.format(new Date(month + "-01T00:00:00Z"))}</h3>
          {selectedDay && <Link className="rounded-sm text-sm text-primary hover:underline" href={calendarHref()} scroll={false}>Full month</Link>}
        </header>
        {!days.size && <p className="mt-3 text-sm text-muted-foreground">No entries with an exact date this month.</p>}
        {agenda.map(([date, entries]) => <section key={date} id={"calendar-" + date} tabIndex={-1} className="mt-3 scroll-mt-20 rounded-sm">
          {!selectedDay && <h4 className="border-b pb-1 text-xs font-semibold text-muted-foreground"><time dateTime={date}>{dayFormat.format(new Date(date + "T00:00:00Z"))}</time></h4>}
          <ul className="divide-y">{entries.map(entry => {
            if ("report" in entry) return <li key={entry.report.id} className="py-2 text-sm"><FlightReportLink report={entry.report} items={items}/><p className="mt-0.5 text-xs text-muted-foreground">Public {entry.report.kind} report</p></li>;
            const row = entry.appointment;
            const Icon = row.status === "Confirmed" ? Check : CircleDashed;
            return <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0"><p className="wrap-anywhere font-medium">{row.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span>{row.example ? "Demo" : "Workspace"} ·</span>{row.kind} · <Icon aria-hidden className="size-3"/>{row.status}</p>
              </div>
              <RecordActionButton action="edit" iconOnly aria-label={`Edit ${row.title}`} onClick={event => setEditor({ id: row.id, row, trigger: event.currentTarget })}/>
            </li>;
          })}</ul>
        </section>)}
      </section>
    </div>
    {editor && <AppointmentEditor editor={editor} items={items} close={() => setEditor(null)} refresh={() => router.refresh()}
      saved={day => { setEditor(null); showMonth(day.slice(0, 7)); }}/>}
  </section>;
}
