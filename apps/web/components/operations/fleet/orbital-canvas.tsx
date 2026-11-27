"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, List, PanelLeftClose, Pause, Play, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceLink } from "@/components/records/links";
import { OrbitalSky } from "./orbital-sky";
import { useOrbitCatalog } from "./use-orbit-catalog";
import { staleElementAge, type CatalogEntry } from "@/lib/orbital-catalog";
import type { PublicSpacecraft } from "@/db/schema";
import { fleetPrograms, type MissionRecord } from "./index-records";

type OrbitCatalog = ReturnType<typeof useOrbitCatalog>;
type FleetProps = {
  records: readonly MissionRecord[]; spacecraft: readonly PublicSpacecraft[];
};

const date = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year:"numeric", month:"short", day:"numeric" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone:"UTC",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false });
const utc = (value: string) => `${date.format(new Date(value))}, ${time.format(new Date(value))} UTC`;

function desktop() { return window.matchMedia("(min-width: 768px)").matches; }
function subscribeWidth(change: () => void) {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

function fleetSelection({ spacecraft, records }: FleetProps, params: URLSearchParams) {
  const satellite = params.get("sat");
  const programId = params.get("program");
  const projects = new Map(records.map(record => [record.id, record]));
  const cohort = spacecraft.filter(craft => projects.has(craft.projectId));
  const selected = cohort.find(craft => String(craft.noradId) === satellite);

  const program = programId !== null && satellite === null && !cohort.some(craft => craft.projectId === programId)
    ? projects.get(programId) : undefined;

  return {
    cohort, selected, record: selected ? projects.get(selected.projectId) : program,
    owners: cohort.filter(craft => !craft.decayDate).map(craft => craft.noradId).join(","),
    unavailable: (satellite !== null && !selected) || (programId !== null && (!program?.reference || !fleetPrograms.has(program.reference.id))),
    inspecting: satellite !== null || programId !== null,
  };
}

export function OrbitalCanvas(props: FleetProps) {
  const wide = useSyncExternalStore(subscribeWidth, desktop, () => false);
  const [menu, setMenu] = useState<boolean | null>(null);
  const selection = fleetSelection(props, useSearchParams());
  const { inspecting } = selection;
  const linkFor = (id: number) => "/operations/fleet?sat=" + id;
  const [search, setSearch] = useState("");
  const open = menu ?? (wide || inspecting);
  const catalog = useOrbitCatalog(selection.owners, selection.selected?.noradId ?? null);
  const directory = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLAnchorElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasInspecting = useRef(inspecting);

  // The catalog is already loaded. Only the inspected object changes; the results keep their search and scroll.
  function inspect(href: string) {
    if (!inspecting) {
      returnFocus.current = directory.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    }
    setMenu(true);
    if (location.pathname + location.search !== href) {
      window.history.pushState({ fleetReturn: location.pathname + location.search }, "", href);
    }
  }

  useEffect(() => {
    if (inspecting && !wasInspecting.current) back.current?.focus({ preventScroll: true });
    if (!inspecting && wasInspecting.current && open) {
      (returnFocus.current?.isConnected ? returnFocus.current : directory.current?.querySelector("input"))?.focus({ preventScroll: true });
    }
    wasInspecting.current = inspecting;
  }, [inspecting, open]);

  return <section aria-label="Dawn fleet" className="relative isolate h-[max(29rem,calc(100svh-12rem))] min-w-0 overflow-hidden rounded-md border bg-[radial-gradient(ellipse_at_47%_45%,#f0f6fa,#cadbe4)] dark:bg-[radial-gradient(ellipse_at_48%_45%,#203a47,#06101a_76%)]">
    <div className={open ? "absolute inset-0 md:left-66" : "absolute inset-0"}>
      <OrbitalSky state={{frame:catalog.frame,selected:selection.selected?.noradId ?? null}} select={id => inspect(linkFor(id))}/>
    </div>
    <header className="pointer-events-none absolute inset-x-2 top-2 grid grid-cols-[1fr_auto_1fr] items-start gap-1 md:inset-x-3 md:top-3">
      <Button aria-controls="fleet-directory" aria-expanded={open} aria-label={open ? "Collapse spacecraft sidebar" : "Show spacecraft sidebar"}
        onClick={() => setMenu(!open)} variant="outline" size="sm" className="pointer-events-auto w-fit bg-background/95 px-2">
        {open ? <PanelLeftClose/> : <List/>}<span className="hidden sm:inline">Spacecraft</span>
      </Button>
      <FleetTime catalog={catalog}/>
      <Playback catalog={catalog}/>
    </header>
    <aside id="fleet-directory" aria-label="Spacecraft directory" className={open
      ? "absolute inset-y-14 start-2 flex w-[min(19rem,calc(100%-1rem))] flex-col overflow-hidden rounded-md border bg-background/98 shadow-sm md:start-3 md:bottom-3 md:w-61"
      : "hidden"}>
      <div ref={directory} className={inspecting ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <FleetDirectory spacecraft={selection.cohort} records={props.records} snapshot={catalog.snapshot} error={catalog.error} search={search} onSearch={setSearch}
          href={linkFor} projectHref={id => "/operations/fleet?program=" + encodeURIComponent(id)} onChoose={inspect}/>
      </div>
      {inspecting && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <Link ref={back} href="/operations/fleet" replace scroll={false} aria-label="Back to spacecraft results" className="my-1 inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-ring"
          onNavigate={event => {
            setSearch("");
            setMenu(true);
            if (window.history.state?.fleetReturn === "/operations/fleet") {
              event.preventDefault();
              window.history.back();
            }
          }}><ArrowLeft aria-hidden className="size-3.5"/>Back</Link>
        <Inspection selection={selection} catalog={catalog}/>
      </div>}
    </aside>
    <FleetSources catalog={catalog}/>
  </section>;
}

function FleetTime({catalog}: {catalog: OrbitCatalog}) {
  const at = catalog.frame?.at ?? catalog.clock?.at;
  if (at === undefined) return <div role="status" className="p-1 text-xs">Loading UTC…</div>;
  const mode = catalog.clock?.end ? "Preview" : "";
  return <time dateTime={new Date(at).toISOString()} className="rounded bg-background/85 px-2 py-1 text-center font-mono text-foreground tabular-nums" aria-label="Displayed UTC time">
    <span className="block text-[9px] leading-3 sm:text-[10px]">{mode && mode + " · "}{date.format(at)}</span>
    <span className="block text-[11px] font-medium leading-4 sm:text-sm">{time.format(at)} UTC</span>
  </time>;
}

function Playback({catalog}: {catalog: OrbitCatalog}) {
  const clock = catalog.clock;
  const speed = clock?.speed ?? 1;
  const nextSpeed = speed === 1 ? 10 : speed === 10 ? 60 : 1;
  const end = clock?.end != null && catalog.frame?.at === clock.end;
  const reset = "Return to now";
  return <div aria-label="Time controls" className="pointer-events-auto flex items-center justify-self-end rounded-md border bg-background/95">
    <Button size="icon-sm" variant="ghost" disabled={!clock || end} onClick={catalog.toggle} title={clock?.playing ? "Pause" : "Play"}
      aria-label={clock?.playing ? "Pause playback" : "Play visualization"}>{clock?.playing ? <Pause/> : <Play/>}</Button>
    <Button size="icon-sm" variant="ghost" disabled={!clock} onClick={() => catalog.speed(nextSpeed)}
      aria-label={`Playback speed ${speed}×, switch to ${nextSpeed}×`} className="text-xs tabular-nums">{speed}×</Button>
    <Button size="icon-sm" variant="ghost" disabled={!clock} onClick={catalog.reset} title={reset} aria-label={reset}><RotateCcw/></Button>
  </div>;
}

function searchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesSearch(term: string, ...fields: (string | number | undefined | null)[]) {
  return searchText(fields.join("\n")).includes(term);
}

function DirectoryGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details open className="mb-1">
    <summary className="cursor-pointer rounded px-2 py-2 text-xs font-semibold hover:bg-muted focus-visible:outline-ring">{title}</summary>
    <ul aria-label={title}>{children}</ul>
  </details>;
}

function FleetDirectory({ spacecraft, records, snapshot, error, href, projectHref, search: input, onSearch: setInput, onChoose }: {
  spacecraft: readonly PublicSpacecraft[]; records: readonly MissionRecord[];
  snapshot: OrbitCatalog["snapshot"]; error: string;
  search: string; onSearch: (value: string) => void; href: (id: number) => string; projectHref: (id: string) => string; onChoose: (href: string) => void;
}) {
  const projects = new Map(records.map(record => [record.id, record]));
  const term = searchText(input.trim());
  const knownProjects = new Set(spacecraft.map(s => s.projectId));
  const programs = records.filter(record => !knownProjects.has(record.id) && record.reference && fleetPrograms.has(record.reference.id) &&
    matchesSearch(term, record.title, record.customer, record.reference.status));
  const matches = spacecraft.filter(craft => {
    const owner = projects.get(craft.projectId);
    return matchesSearch(term, craft.name, craft.catalogName, craft.internationalDesignator, craft.noradId,
      owner?.title, owner?.customer, owner?.description);
  });
  // Group by the catalog's current coverage. Scrubbing the preview never changes directory membership.
  const now = Date.now();
  const epochs = new Map(snapshot?.rows.map(([id, , , epoch]) => [id, Date.parse(epoch)]));
  const tracked: PublicSpacecraft[] = [], withoutOrbit: PublicSpacecraft[] = [], unclassified: PublicSpacecraft[] = [];
  for (const craft of matches) {
    if (!snapshot && !craft.decayDate) unclassified.push(craft);
    else if (!craft.decayDate && epochs.has(craft.noradId)) tracked.push(craft);
    else withoutOrbit.push(craft);
  }

  function spacecraftLink(craft: PublicSpacecraft, stale = false) {
    const destination = href(craft.noradId);
    return <li key={craft.noradId}><Link scroll={false} href={destination}
      onNavigate={event => { event.preventDefault(); onChoose(destination); }}
      className="flex min-h-11 items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted">
      <span className="min-w-0">
        <span className="block text-sm leading-tight font-medium">{craft.name}</span>
        <span className="block text-[11px] text-muted-foreground">{projects.get(craft.projectId)?.title}</span>
        {craft.decayDate ? <span className="block text-[11px] text-muted-foreground">Reentered {date.format(new Date(craft.decayDate))}</span>
          : stale && <span className="block text-[11px] text-muted-foreground">Older elements · estimated</span>}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{craft.noradId}</span>
    </Link></li>;
  }
  return <>
    <div className="relative m-2"><Search aria-hidden className="pointer-events-none absolute start-2.5 top-2.5 size-3.5 text-muted-foreground"/>
      <Input aria-label="Search Dawn spacecraft" placeholder="Search spacecraft" value={input} onChange={e => setInput(e.target.value)} className="h-9 ps-8 pe-7 text-sm"/>
      {input && <button type="button" aria-label="Clear search" className="absolute end-1 top-1 rounded p-1.5" onClick={() => setInput("")}><X className="size-3.5"/></button>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-1 pb-1" key={term ? "search" : "browse"}>
      {unclassified.length > 0 && <>
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{error ? "Orbit data unavailable." : "Checking orbit data…"}</p>
        <ul aria-label="Spacecraft awaiting orbit data">{unclassified.map(craft => spacecraftLink(craft))}</ul>
      </>}
      {!!tracked.length && <DirectoryGroup title="Tracked in orbit">{tracked.map(craft => spacecraftLink(craft, now - (epochs.get(craft.noradId) ?? now) > staleElementAge))}</DirectoryGroup>}
      {!!withoutOrbit.length && <DirectoryGroup title="No current orbit">{withoutOrbit.map(craft => spacecraftLink(craft))}</DirectoryGroup>}
      {!!programs.length && <DirectoryGroup title="Programs">
        {programs.map(record => <li key={record.id}><Link href={projectHref(record.id)} scroll={false} onNavigate={event => { event.preventDefault(); onChoose(projectHref(record.id)); }}
          className="block min-h-9 rounded px-2 py-2 text-sm hover:bg-muted">{record.title}</Link></li>)}
      </DirectoryGroup>}
      {!matches.length && !programs.length && <p className="px-2 py-2 text-xs text-muted-foreground">{term ? "No matching spacecraft." : "No documented spacecraft for this selection."}</p>}
    </div>
  </>;
}

function elementAge(epoch: string, at: number | undefined) {
  if (at === undefined) return "";
  const delta = at - Date.parse(epoch);
  if (!delta) return "At view time";
  const minutes = Math.abs(delta) / 60000;
  const duration = minutes < 1 ? "<1 min" : minutes < 60 ? `${Math.floor(minutes)} min`
    : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`;
  return `${duration} ${delta > 0 ? "before" : "after"} view time`;
}

type Selection = ReturnType<typeof fleetSelection>;
function Inspection({ selection, catalog }: {selection: Selection; catalog: OrbitCatalog}) {
  if (selection.unavailable) return <div><h2 className="text-sm font-semibold">Spacecraft unavailable</h2>
    <p className="mt-1 text-xs">This entry could not be found in the spacecraft directory.</p>
    <Link href="/operations/fleet" className="text-xs text-primary hover:underline">Return to full fleet</Link></div>;
  const craft = selection.selected, record = selection.record;
  return <>
    <h2 className="text-sm font-semibold">{craft?.name ?? record?.title}</h2>
    {craft ? <SpacecraftEvidence craft={craft} project={record} row={catalog.snapshot?.rows.find(r => r[0] === craft.noradId)} catalog={catalog}/>
      : record?.reference && <ProjectSource reference={record.reference}/>}
  </>;
}

function pathCaption(frame: NonNullable<OrbitCatalog["frame"]>, id: number) {
  if (frame.path.length) return "Estimated path";
  return frame.ids.includes(id) ? "No complete forecast within this element edition." : "No position estimate at the displayed time.";
}

function SpacecraftEvidence({craft, project, row, catalog}: {
  craft: PublicSpacecraft; project?: MissionRecord; row?: CatalogEntry; catalog: OrbitCatalog;
}) {
  const frame = catalog.frame;
  const description = project?.reference?.summary || project?.description;
  const sources = new Map([...craft.sources, ...(project?.reference?.sources ?? [])].map(source => [source.href, source]));
  const age = row && elementAge(row[3], frame?.at);

  return <div className="text-xs">
    {description && <p className="mt-1.5 leading-relaxed text-muted-foreground">{description}</p>}
    <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 [&>dt]:text-muted-foreground">
      <dt>Launch</dt><dd><time dateTime={craft.launchDate}>{date.format(new Date(craft.launchDate))}</time></dd>
      <dt>NORAD ID</dt><dd>{craft.noradId}</dd>
      <dt>Designator</dt><dd>{craft.internationalDesignator}</dd>
      <dt>Element epoch</dt>
      <dd>{row ? <>
        <time dateTime={row[3]} title={row[3]}>{utc(row[3])}</time>
        {age && <span className="mt-0.5 block text-muted-foreground">{age}</span>}
      </> : catalog.snapshot ? "No Earth-orbit elements available" : catalog.error || "Loading…"}</dd>
      {craft.decayDate && <><dt>Reentry</dt><dd><time dateTime={craft.decayDate}>{date.format(new Date(craft.decayDate))}</time></dd></>}
    </dl>
    {craft.orbitNote && <p className="mt-2 text-muted-foreground">{craft.orbitNote}</p>}
    {row && frame && <p className="mt-4 flex items-center gap-2">
      {frame.path.length > 0 && <span aria-hidden className="h-0.5 w-4 bg-amber-500"/>}
      {pathCaption(frame, craft.noradId)}
    </p>}
    {sources.size > 0 && <details className="mt-3">
      <summary className="w-fit cursor-pointer py-1 font-medium">Sources</summary>
      <ul className="space-y-1.5 pt-1">{Array.from(sources.values(), source =>
        <li key={source.href}><SourceLink href={source.href}>{source.title}</SourceLink></li>)}</ul>
    </details>}
  </div>;
}

function FleetSources({catalog}: {catalog: OrbitCatalog}) {
  return <div className="absolute end-2 bottom-3 flex max-w-[65%] flex-col items-end gap-2 text-xs md:end-3">
    {catalog.error && <button type="button" onClick={catalog.retry} className="rounded border bg-background px-2 py-1">{catalog.error} Retry</button>}
    <details className="w-fit max-w-60 rounded-md border bg-background/95 px-2 py-1.5">
      <summary className="cursor-pointer">Sources</summary>
      <div className="mt-2 grid gap-1.5">
        <SourceLink href="https://celestrak.org/NORAD/elements/">CelesTrak orbital elements</SourceLink>
        {catalog.snapshot && <p>Retrieved {utc(catalog.snapshot.retrievedAt)}. Positions are estimates. Older orbital elements can be less accurate.</p>}
        <SourceLink href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/">NASA surface · June 2004</SourceLink>
        <SourceLink href="https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/">NASA clouds · 2002 composite</SourceLink>
      </div>
    </details>
  </div>;
}
function ProjectSource({ reference }: {reference: NonNullable<MissionRecord["reference"]>}) {
  if (!reference.summary) return null;
  const source = reference.sources.find(item => /heritage chart/i.test(item.title)) ?? reference.sources[0];
  return <div className="mt-2 space-y-1 text-xs">
    <p>{reference.summary}</p>
    {source && <SourceLink href={source.href}>{source.title}</SourceLink>}
  </div>;
}
