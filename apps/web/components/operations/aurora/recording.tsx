"use client";

import { ArrowRight, ChevronRight, ExternalLink } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ConnectionLink } from "@/components/records/links";
import { useRouter, useSearchParams } from "next/navigation";
import { withSelections } from "@/lib/workspace-routes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { OperationsStudyProps } from "@/lib/archives/study";
import {
  alignedFrames, intervalCoverage, debriefQuery, edition, events, filings, hasFiledProfile, isArchivedSource, outcomes, pairs, subjectFor,
  visibleCount, type AlignedFrame, type EventId, type PayloadPair,
} from "@/lib/archives/aurora";
import { ComparisonTrace, FramePlate } from "./figures";
import { ArchiveTransport, useFramePlayer, type FrameState } from "@/components/operations/archive-transport";

function CampaignContext({ pair }: { pair: PayloadPair }) {
  const filing = filings[pair.id];
  if (!filing) return null;
  return (
    <div className="mt-3 text-sm">
      {filing.projectId === "public-dawn-aurora" && <p className="mb-1 max-w-prose text-muted-foreground">
        Dawn’s public history lists Arizona State University’s imaging payload on Flight 60 and Cal Poly’s data acquisition payload on Flight 59.
      </p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <ConnectionLink connection={{ href: `/catalog?view=units#catalog-units-${encodeURIComponent(filing.serial)}`,
          label: "Unit " + filing.serial, location: "Catalog · Units" }} />
        {filing.projectId === "public-dawn-aurora" && <a className="inline-flex items-center gap-1 text-primary hover:underline" href="https://www.dawnaerospace.com/flight-history" target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true"/> Dawn flight history<span className="sr-only"> (opens in a new tab)</span>
        </a>}
      </div>
    </div>
  );
}

function workingSource(params: URLSearchParams, eligible: readonly PayloadPair[]) {
  if (!params.has("pair") && eligible.length !== 1) return undefined;
  const pair = params.has("pair") ? eligible.find(record => record.id === params.get("pair")) : eligible[0];
  const align = params.get("align") ?? "card-in";
  if (!pair || !Object.hasOwn(events, align) || (params.has("edition") && params.get("edition") !== edition)) return null;
  return { pair, event: align as EventId };
}

function archiveHref(params: URLSearchParams, record?: PayloadPair) {
  const query = new URLSearchParams(params);
  for (const key of ["pair", "align", "edition", "first", "last", "frame", "finding"]) query.delete(key);
  query.set("view", "recordings");
  query.delete("flight");
  if (record) for (const [key, value] of Object.entries(debriefQuery(record, "card-in"))) {
    query.set(key, value);
  }
  return "/operations/aurora" + (query.size ? `?${query}` : "");
}

export default function PayloadRecordings({ subjects, scopeSelected, availableArchives, selected, save }: OperationsStudyProps) {
  const params = useSearchParams();
  const router = useRouter();
  const eligible = useMemo(() => {
    const allowed = new Set(subjects);
    return pairs.filter(pair => Object.keys(events).some(event => allowed.has(subjectFor(pair, event as EventId))));
  }, [subjects]);
  if (!selected && !scopeSelected) {
    const options = availableArchives.flatMap(archive => pairs
      .filter(pair => archive.subjects.includes(subjectFor(pair, "card-in")))
      .map(pair => ({ pair, label: archive.label, href: withSelections(archiveHref(params, pair), [archive.selection]) })));
    const initial = options.find(option => option.pair.setting !== "bench") ?? options[0];
    if (!initial) return <p className="text-sm text-muted-foreground">No payload comparison is filed in the Catalog.</p>;
    return <PairDebrief pair={initial.pair} event="card-in" selected={null} save={save}
      preview={{ href: initial.href, project: initial.label }}
      selector={options.length > 1 && <select aria-label="Browse available recordings" value="" onChange={e => router.push(e.target.value, {scroll:false})}
        className="h-8 w-48 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs">
        <option value="" disabled>Browse recordings ({options.length})</option>
        {options.map(({ pair, href, label }) => <option key={href} value={href}>{label} · {pair.title}</option>)}
      </select>}/>;
  }
  if (!selected && !eligible.length) return <p className="text-sm text-muted-foreground">No payload comparison is filed for this selection.</p>;
  const source = selected ? (isArchivedSource(selected.source) ? selected.source : null) : workingSource(params, eligible);
  if (source === null) return <div className="grid justify-items-start gap-2 text-sm">
    <p role="status">This payload comparison is unavailable for this selection or edition.</p>
    <Link className="text-primary hover:underline" href={archiveHref(params)}>Return to available comparisons</Link>
  </div>;
  if (!source) return <section aria-label="Payload archives">
    <h2 className="mb-2 text-base font-semibold">Archived recording pairs</h2>
    <ul className="divide-y">{eligible.map(pair => <li key={pair.id}>
      <Link href={archiveHref(params,pair)} className="group flex items-center justify-between gap-4 py-3" scroll={false}>
        <span className="grid gap-1"><strong className="text-sm font-medium group-hover:underline">{pair.title}</strong>
          <span className="text-xs text-muted-foreground">{pair.reviewed.id} and {pair.reference.id} · {pair.reviewed.frames.length} returned frames</span>
        </span>
        <ChevronRight className="size-4 shrink-0" aria-hidden/>
      </Link>
    </li>)}</ul>
  </section>;
  const selector = !selected && eligible.length > 1 && <select aria-label="Payload comparison" value={source.pair.id}
    onChange={e => router.push(archiveHref(params, eligible.find(p => p.id === e.target.value)), { scroll:false })}
    className="h-8 w-48 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs">
    {eligible.map(pair => <option key={pair.id} value={pair.id}>{pair.title}</option>)}
  </select>;
  return <PairDebrief key={selected?.id ?? source.pair.id} pair={source.pair} event={source.event} selected={selected} save={save} selector={selector}/>;
}

function sampleLabel(sample: string | null | undefined) {
  if (sample === undefined) return "Outside archive";
  if (sample === null) return "Frame missing";
  const marks = sample.replaceAll(".", "");
  return marks ? `${visibleCount(sample)} / ${sample.length} (${marks})` : `0 / ${sample.length}`;
}

function editLocation(values: Partial<Record<"align" | "frame" | "first" | "last" | "pair" | "edition", string | number>>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  window.history.replaceState(null, "", url);
}

function summarizeCoverage(coverage: ReturnType<typeof intervalCoverage>) {
  return [
    coverage.paired ? `${coverage.matching} of ${coverage.paired} paired frames show the same marks.` : "No paired images in this interval.",
    coverage.returnedMissing ? `Returned images missing: ${coverage.returnedMissing}.` : "",
    coverage.referenceMissing ? `Without a reference image: ${coverage.referenceMissing}.` : "",
  ].filter(Boolean).join(" ");
}

function linkedFrame(params: URLSearchParams, key: string, limit: number, fallback: number) {
  const value = Number(params.get(key));
  return Number.isInteger(value) && value >= 1 && value <= limit ? value : fallback;
}

const stripColor: Record<AlignedFrame["state"], FrameState> = {match:"match", different:"difference", gap:"unavailable"};

function observation(row: AlignedFrame) {
  const {frame, referenceFrame, returned, reference} = row;
  const marks = (sample: string) => sample.replaceAll(".", "").split("").join(" · ") || "none";
  if (returned === null) {
    const other = reference == null ? "" : ` Reference frame ${referenceFrame} shows ${marks(reference)}.`;
    return `Returned frame ${frame} is missing.${other}`;
  }
  if (reference === undefined) return "The reference recording does not cover this frame.";
  if (reference === null) return `Reference frame ${referenceFrame} is missing.`;
  if (returned !== reference) return `The returned frame shows ${marks(returned)}. The reference shows ${marks(reference)}.`;
  return visibleCount(reference) ? "The two frames show the same marks." : "The two frames show no legible marks.";
}

function nextDifferenceLabel(row: AlignedFrame) {
  if (row.state === "different") return "Compare marks";
  if (row.returned === null) return "Missing return";
  return row.reference === null ? "Missing reference" : "Outside reference";
}

type Interval = { first: number; last: number };
function linkedInterval(params: URLSearchParams, limit: number, initial: number): Interval | null {
  if (!params.has("first") && !params.has("last")) return null;
  const first = linkedFrame(params,"first",limit,initial);
  return { first, last: Math.max(first,linkedFrame(params,"last",limit,first)) };
}

function FrameComparison({ pair, row, next, playing, seek }: {
  pair: PayloadPair; row: AlignedFrame; next?: AlignedFrame; playing: boolean; seek: (frame: number) => void;
}) {
  return <>
    <div className="grid grid-cols-2 gap-3 sm:gap-5" aria-label="Recorded frame readouts">
      <FramePlate pair={pair} sample={row.returned} frame={row.frame} title="Returned" source={pair.reviewed.id}/>
      <FramePlate pair={pair} sample={row.reference} frame={row.referenceFrame} title="Reference" source={pair.reference.id}/>
    </div>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="text-sm font-medium" aria-live={playing ? "off" : "polite"}>{observation(row)}</p>
      {next && next.frame !== row.frame && <button type="button" onClick={() => seek(next.frame)}
        className="inline-flex min-h-7 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
        Frame {next.frame} · {nextDifferenceLabel(next)} <ChevronRight className="size-3" aria-hidden/>
      </button>}
    </div>
  </>;
}

function TraceInspection({ pair, rows, event, interval, player, description, readOnly }: {
  pair: PayloadPair; rows: AlignedFrame[]; event: EventId; interval: Interval; player: ReturnType<typeof useFramePlayer>; description: string; readOnly: boolean;
}) {
  const [traceOpen, setTraceOpen] = useState(false);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <button type="button" aria-expanded={traceOpen} onClick={() => setTraceOpen(!traceOpen)} className="min-h-8 rounded-sm hover:text-foreground hover:underline">{traceOpen ? "Hide mark-count trace" : "Inspect mark-count trace"}</button>
      {readOnly ? <span>Aligned on {events[event].toLowerCase()}</span> : <label className="flex items-center gap-1">Align on
        <select value={event} onChange={e => { player.pause(); editLocation({pair:pair.id, edition, align:e.target.value, ...interval, frame:player.frame}); }}
          className="h-8 rounded-sm bg-transparent text-foreground">
          {Object.entries(events).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>}
    </div>
    {traceOpen && <ComparisonTrace rows={rows} pair={pair} event={event} frame={player.frame} first={interval.first} last={interval.last} lower={player.first} upper={player.last}
      valueText={description} onInspect={player.seek}/>}
  </>;
}

// The saved interval is authoritative for a receipt. A working URL can select any frame of its filed pair.
function useDebriefPosition(pair: PayloadPair, event: EventId, selected: OperationsStudyProps["selected"], preview: boolean) {
  const params = useSearchParams();
  const length = pair.reviewed.frames.length;
  const rows = alignedFrames(pair, event);
  const exceptions = rows.filter((row,i) => row.state !== "match" && rows[i-1]?.state !== row.state);
  const alignmentFrame = pair.reviewed.events[event];
  const exampleFrame = exceptions.find(row => row.frame >= alignmentFrame)?.frame ?? alignmentFrame;
  const requested = linkedFrame(params,"frame",length,linkedFrame(params,"first",length, preview ? exampleFrame : alignmentFrame));
  const player = useFramePlayer(selected?.first ?? 1, selected?.last ?? length, selected?.first ?? requested, newFrame => {
    if (!selected && !preview) editLocation({frame:newFrame});
  });
  const {frame} = player;
  const row = rows[frame-1];
  const next = exceptions.find(item => item.frame > frame) ?? exceptions[0];
  const [bounds, setBounds] = useState(() => linkedInterval(params,length,requested));
  const {first,last} = selected ?? bounds ?? {first:frame,last:frame};
  function selectInterval(start: number, end: number) {
    const cursor = Math.max(start,Math.min(end,frame));
    player.seek(cursor);
    setBounds({first:start,last:end});
    editLocation({first:start,last:end,frame:cursor});
  }
  return { player, row, next, rows, bounds, first, last, selectInterval };
}

function PairDebrief({ pair, event, selected, save, selector, preview }: {
  pair: PayloadPair; event: EventId; selector?: ReactNode; preview?: { href: string; project: string };
} & Pick<OperationsStudyProps, "selected" | "save">) {
  const { player, row, next, rows, bounds, first, last, selectInterval } = useDebriefPosition(pair, event, selected, Boolean(preview));
  const {frame} = player;
  const canRecord = !selected && !preview;
  const [findingOpen, setFindingOpen] = useState(false);
  const findingId = useId();
  const description = observation(row);
  const coverageText = summarizeCoverage(intervalCoverage(rows.slice(first - 1, last)));
  function openFinding() {
    player.pause();
    if (!findingOpen && !bounds) selectInterval(frame,frame);
    setFindingOpen(!findingOpen);
  }
  const action = preview ? <Link href={preview.href + "&frame=" + frame} scroll={false}
    aria-label={`Open payload replay · ${preview.project}`}
    className="inline-flex h-9 w-fit max-w-full items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline">
    Open payload replay <ArrowRight aria-hidden className="size-3.5"/>
  </Link> : !selected && <Button size="sm" variant="outline" aria-expanded={findingOpen} aria-controls={findingId} onClick={openFinding}>Record a finding</Button>;

  return <section className="grid min-w-0 max-w-5xl grid-cols-1 gap-3" aria-label={preview ? "Payload replay preview" : "Payload comparison"}>
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div><h2 className="text-lg font-semibold tracking-tight">{pair.title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {preview && `${preview.project} · `}{pair.reviewed.frames.length} returned frames · {pair.reference.frames.length} reference frames
        </p>
      </div>
      {selector}
    </header>
    <FrameComparison pair={pair} row={row} next={selected ? undefined : next} playing={player.playing} seek={player.seek}/>
    <ArchiveTransport player={player} rangeLabel="Inspect returned frame" playbackLabel="payload replay" description={description}
      timeline={rows.map(item => stripColor[item.state])} interval={selected ?? bounds ?? undefined} action={action}/>
    {canRecord && <div id={findingId} hidden={!findingOpen}>
      <FindingEditor pair={pair} event={event} first={first} last={last} selectInterval={selectInterval} coverageText={coverageText} save={save}/>
    </div>}
    {selected && <p className="text-sm text-muted-foreground">{coverageText}</p>}
    <TraceInspection rows={rows} pair={pair} event={event} player={player} interval={{first,last}} description={description} readOnly={!canRecord}/>
    {!preview && <FrameTable rows={rows} pair={pair} event={event} historical={Boolean(selected)}/>}
  </section>;
}

function FindingEditor({ pair, event, first, last, selectInterval, coverageText, save }: {
  pair: PayloadPair; event: EventId; first: number; last: number; coverageText: string;
  selectInterval: (first: number, last: number) => void; save: OperationsStudyProps["save"];
}) {
  const [outcome, setOutcome] = useState("Finding");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const numbers = pair.reviewed.frames.map((_, i) => i + 1);
  async function record(eventData: FormEvent<HTMLFormElement>) {
    eventData.preventDefault();
    if (pending || !note.trim()) return;
    setPending(true);
    setError("");
    const message = await save({ first, last, subject: subjectFor(pair, event), outcome, note: note.trim() })
      .catch(() => "The entry could not be saved. Your note is still here.");
    setPending(false);
    if (message) setError(message);
  }
  return (
    <form onSubmit={record} className="grid max-w-2xl min-w-0 gap-3 pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">First frame
          <select value={first} className="h-8 rounded-md border border-input bg-popover px-2" onChange={e => {
            const start = Number(e.target.value);
            selectInterval(start, Math.max(start, last));
          }}>
            {numbers.map(n => <option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Last frame
          <select value={last} className="h-8 rounded-md border border-input bg-popover px-2" onChange={e => selectInterval(first, Number(e.target.value))}>
            {numbers.slice(first - 1).map(n => <option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Entry type
          <select value={outcome} onChange={e => setOutcome(e.target.value)} className="h-8 rounded-md border border-input bg-popover px-2 text-sm">
            {outcomes.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm" aria-live="polite">{coverageText}</p>
      <label className="grid gap-1 text-sm font-medium">{outcome === "Finding" ? "Observation" : "Next action"}
        <Textarea required maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="min-h-16"/>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !note.trim()} className="justify-self-start">{pending ? "Saving…" : `Save ${outcome.toLowerCase()}`}</Button>
    </form>
  );
}

function FrameTable({ pair, rows, event, historical }: { pair: PayloadPair; rows: AlignedFrame[]; event: EventId; historical: boolean }) {
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground">Source editions and frame table</summary>
      <p className="my-2 text-sm">{pair.question}</p>
      {hasFiledProfile(pair) && <p className="text-xs text-muted-foreground">Filed illustration · {pair.profileEdition}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{events[event]} · returned frame {pair.reviewed.events[event]} ↔ reference frame {pair.reference.events[event]}. The table lists the readable marks in each recorded frame.</p>
      <table className="mt-2 w-full text-left text-xs tabular-nums">
        <caption className="pb-2 text-left">{pair.metric} · returned {pair.reviewed.id} against reference {pair.reference.id}</caption>
        <thead><tr><th scope="col">Returned frame</th><th scope="col">Marks</th><th scope="col">Ref. frame</th><th scope="col">Marks</th></tr></thead>
        <tbody className="divide-y">{rows.map(({ frame, returned, referenceFrame, reference }) =>
          <tr key={frame}>
            <th scope="row" className="py-1">{frame}</th><td>{sampleLabel(returned)}</td>
            <td>{reference === undefined ? "—" : referenceFrame}</td><td>{sampleLabel(reference)}</td>
          </tr>)}</tbody>
      </table>
      {!historical && <CampaignContext pair={pair}/>}
    </details>
  );
}
