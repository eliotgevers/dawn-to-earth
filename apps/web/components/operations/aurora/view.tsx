"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { mountArchivedRaster } from "@/components/operations/archived-raster";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, ExternalLink, MapPin, Play } from "lucide-react";
import type { AuroraFlight } from "@/db/schema";
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { sectionTab, sectionTabs } from "@/components/records/presentation";
import { ConnectionLink } from "@/components/records/links";
import FlightDebrief from "./flight-review";
import type { FlightEntry } from "@/db/operations/aurora";

const historyUrl = "https://www.dawnaerospace.com/flight-history";
const pressPhoto = "https://drive.google.com/file/d/1tnj5FTrQztUFXl6l77aNC3g0UB94EltC/view";
// Each NASA Blue Marble crop is equirectangular. The marker is the rounded location
// of the named aerodrome within that local image, independent of the flight.
const sites = {
  "Glentanner Aerodrome, New Zealand": {
    label: "Glentanner", image: "/aurora-art/glentanner-region.jpg",
    alt: "The Southern Alps and Lake Pukaki on NASA’s regional relief map.",
    south: -44.65, west: 168.6, north: -43.2, east: 171.4, lat: -43.91, lng: 170.13,
  },
  "Tāwhaki National Aerospace Centre, New Zealand": {
    label: "Tāwhaki", image: "/aurora-art/kaitorete-region.jpg",
    alt: "Lake Ellesmere and the Canterbury coast on NASA’s regional relief map.",
    south: -44.5, west: 171.3, north: -43.05, east: 174.1, lat: -43.83, lng: 172.54,
  },
} as const;

function archiveLink(params: URLSearchParams, id?: string, recordings = false, projectId?: string) {
  const query = new URLSearchParams();
  for (const item of params.getAll("item")) query.append("item", item);
  if (id) query.set("flight", id);
  if (!query.has("item") && projectId) query.set("item", "project:" + projectId);
  if (recordings) query.set("view", "recordings");
  return "/operations/aurora" + (query.size ? "?" + query : "");
}

export function FlightReportLink({ report, items, sourceId }: { report: AuroraFlight; items: readonly string[]; sourceId?: string }) {
  const query = new URLSearchParams(items.map(item => ["item", item]));

  return <ConnectionLink scope={[]} sourceId={sourceId} connection={{
    href: archiveLink(query, report.id),
    label: report.flightNumber ? `Flight ${report.flightNumber}` : report.title,
    location: "Aurora · Flight History", identity: report.title,
  }} />;
}

function PublicLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-4 hover:underline">
    <ExternalLink className="size-3.5" aria-hidden/>{children}<span className="sr-only"> (opens in a new tab)</span>
  </a>;
}

function Cover({ flight, href }: { flight: AuroraFlight; href: string }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_38%] overflow-hidden rounded-sm bg-muted sm:grid-cols-[minmax(0,1fr)_46%]">
    <div className="flex min-w-0 flex-col items-start justify-center gap-1 px-3 py-3 sm:px-5 sm:py-4">
      <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">Aurora Mk-II</h2>
      <Link href={href} className="inline-flex min-h-8 items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline">
        First supersonic flight <ArrowRight aria-hidden className="size-3.5 shrink-0"/>
      </Link>
      <span className="text-xs text-muted-foreground">Flight {flight.flightNumber} · {flight.period}</span>
    </div>
    <figure className="relative min-w-0 overflow-hidden bg-muted">
      <Image unoptimized fill priority sizes="(max-width: 640px) 38vw, 520px" src="/aurora-art/aurora-takeoff.jpg"
        alt="Aurora climbing above the mountains near Aoraki / Mount Cook."
        className="object-cover object-[56%_38%]"/>
      <figcaption className="absolute bottom-1 right-1 rounded-sm bg-black/65 px-1.5 text-[10px] leading-5 text-white">
        <a href={pressPhoto} target="_blank" rel="noreferrer" className="hover:underline">Dawn Aerospace<span className="sr-only"> · photo credit (opens in a new tab)</span></a>
      </figcaption>
    </figure>
  </div>;
}

function SiteMap({ site }: { site: typeof sites[keyof typeof sites] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) return mountArchivedRaster(host.current, { ...site, geographic: true, width: 1200 }, site);
  }, [site]);
  const left = 100 * (site.lng - site.west) / (site.east - site.west);
  const top = 100 * (site.north - site.lat) / (site.north - site.south);
  return <figure id="flight-site" className="overflow-hidden rounded-sm bg-muted" aria-label={`Location of ${site.label} in the South Island of New Zealand`}>
    <div className="relative isolate">
      <Image unoptimized loading="eager" src={site.image} alt={site.alt} width={1200} height={850} className="block h-auto w-full"/>
      <div className="absolute flex -translate-x-1.5 -translate-y-1/2 items-center gap-1.5" style={{left: left + "%", top: top + "%"}}>
        <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-white bg-sky-600 ring-4 ring-sky-400/45"/>
        <span className="rounded-sm bg-slate-950/85 px-2 py-1 text-xs font-semibold text-white">{site.label}</span>
      </div>
      <div ref={host} role="region" tabIndex={0} aria-label={`Interactive map of ${site.label}`}
        aria-description="Pan with arrow keys and zoom with plus and minus."
        className="absolute inset-0 opacity-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"/>
    </div>
    <figcaption className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span>Historical flight site · South Island, NZ</span><a href="https://www.earthdata.nasa.gov/data/tools/gibs" target="_blank" rel="noreferrer" className="hover:underline">
        NASA Blue Marble<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </figcaption>
  </figure>;
}

function reportLabel(url: string) {
  if (url.includes("/posts/dawnaerospace_")) return "Dawn campaign update";
  if (url.includes("calpoly.edu/")) return "Cal Poly payload report";
  if (url.includes("images.squarespace-cdn.com/")) return "Dawn wingtip photograph";
  if (url === historyUrl) return "Dawn flight history";
  if (url.includes("/15-rocket-powered-flights")) return "Dawn program retrospective";
  if (new URL(url).hostname.endsWith(".asu.edu")) return "Arizona State University report";
  return "Dawn flight report";
}

function filmPlayerUrl(original?: string) {
  if (!original) return undefined;
  const url = new URL(original);
  const video = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
  if (!["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname) || !video || !/^[a-zA-Z0-9_-]{11}$/.test(video)) return undefined;
  const seconds = /^([1-9]\d{0,6})s?$/.exec(url.searchParams.get("t") ?? "")?.[1];
  return `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&mute=1&playsinline=1&rel=0${seconds ? "&start=" + seconds : ""}`;
}

function FlightMedia({ flight, site, recordUrl, player }: {flight: AuroraFlight; site?: typeof sites[keyof typeof sites]; recordUrl: string; player?: string}) {
  if (!player) return site && <SiteMap site={site}/>;
  return <div id="flight-film" className="grid min-w-0 gap-2">
    <iframe src={player} title={`Dawn flight footage · ${flight.title}`} referrerPolicy="strict-origin-when-cross-origin"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      className="aspect-video w-full rounded-sm border-0 bg-black"/>
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <Link href={recordUrl} className="inline-flex min-h-9 items-center gap-1.5 text-sm text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden/>{site ? "Back to flight site" : "Back to flight report"}</Link>
      <PublicLink href={flight.footage!}>Watch on YouTube</PublicLink>
    </div>
  </div>;
}

export function FlightDetail({ flight, back, comments, service, canPostComment }: { canPostComment: boolean; flight: AuroraFlight; back: string; comments: FlightEntry[] | null;
  service: { id: string; work: string; status: string; example: boolean }[] }) {
  const params = useSearchParams();
  const site = sites[flight.site as keyof typeof sites];
  const player = filmPlayerUrl(flight.footage);
  const showingFilm = !!player && params.get("media") === "film";
  const recordUrl = archiveLink(params, flight.id);
  const visual = showingFilm || site;
  const identifier = flight.flightNumber ? `Flight ${flight.flightNumber}` : flight.flightCount ? `Campaign of ${flight.flightCount} flights` : flight.kind;
  const items = params.getAll("item");
  return <article className="grid min-w-0 gap-4" aria-label={flight.title}>
    <Link href={back} className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"><ArrowLeft aria-hidden className="size-4"/>Flight archive</Link>
    <section aria-label="Public flight record" className={`grid max-w-6xl grid-cols-1 items-start gap-5 ${visual ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,1fr)] lg:gap-8" : ""}`}>
      {visual && <div className="lg:col-start-1 lg:row-start-1">
        <FlightMedia flight={flight} recordUrl={recordUrl} site={site} player={showingFilm ? player : undefined}/>
      </div>}
      <div className={`grid min-w-0 content-start justify-items-start gap-3 ${visual ? "row-start-1 lg:col-start-2" : ""}`}>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{identifier} · {flight.period}</span>
        <h2 className="text-3xl font-semibold leading-tight tracking-tight">{flight.title}</h2>
        {flight.site && <p className="inline-flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden/>{flight.site}</p>}
        <p className="max-w-prose text-sm leading-6">{flight.summary}</p>
        {player && !showingFilm && <Link href={recordUrl + "&media=film#flight-film"} prefetch={false} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Play className="size-4" aria-hidden/>Watch flight footage
        </Link>}
        <div className="flex flex-wrap gap-x-4">
          <PublicLink href={flight.source}>{reportLabel(flight.source)}</PublicLink>
          {flight.corroboration && <PublicLink href={flight.corroboration}>{reportLabel(flight.corroboration)}</PublicLink>}
          {flight.artifacts?.map(link => <PublicLink key={link.url} href={link.url}>{link.label}</PublicLink>)}
        </div>
      </div>
    </section>
    {flight.kind === "flight" && <>
      <section aria-label="Service log" className="grid max-w-3xl gap-1">
        <h2 className="text-base font-semibold"><Link href={recordUrl + "&view=service"} className="text-primary hover:underline">Service log</Link></h2>
      <ul className="divide-y">{service.map(row => <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
        <span>{row.work}</span>
        <ConnectionLink scope={[]} connection={{href: recordUrl + "&view=service#service-" + row.id,
          label: "Service record", location: "Aurora · Service", identity: row.work}} />
        <span className="text-muted-foreground">{row.status}{row.example && " · Demo"}</span>
      </li>)}</ul>
      </section>
      <FlightDebrief key={JSON.stringify([flight.id, items])} flightId={flight.id} items={items} entries={comments} canPost={canPostComment}/>
    </>}
  </article>;
}

const auroraViews = { history: "Flight History", service: "Service", calendar: "Calendar" } as const;

export function AuroraTabs({ active, items, children }: {
  active: keyof typeof auroraViews; items: readonly string[]; children: ReactNode;
}) {
  return <Tabs value={active} className="min-w-0 gap-4">
    <TabsList aria-label="Aurora views" variant="line" className={sectionTabs}>
      {Object.entries(auroraViews).map(([id, label]) => {
        const query = new URLSearchParams(items.map(value => ["item", value]));
        if (id !== "history") query.set("view", id);
        const href = "/operations/aurora" + (query.size ? "?" + query : "");
        return <TabsTrigger key={id} value={id} className={sectionTab} nativeButton={false}
          render={<Link href={href} scroll={false}/>}>{label}</TabsTrigger>;
      })}
    </TabsList>
    <TabsContent value={active} className="min-w-0">{children}</TabsContent>
  </Tabs>;
}

export function FlightHistory({ flights, scoped, hasRecordings }: {
  flights: readonly AuroraFlight[]; scoped: boolean; hasRecordings: boolean;
}) {
  const params = useSearchParams();
  const recordings = archiveLink(params, undefined, true);
  if (scoped && !flights.length) return <div className="grid justify-items-start gap-2 text-sm">
    <p role="status">No public Aurora flights are linked to this selection.</p>
    {hasRecordings && <Link href={recordings} className="inline-flex items-center gap-1 text-primary hover:underline">Payload recordings <ArrowRight className="size-4" aria-hidden/></Link>}
  </div>;
  const featured = flights.find(item => item.id === "flight-57");
  const individual = flights.filter(flight => flight.kind === "flight").length;
  return <section className="grid min-w-0 max-w-6xl grid-cols-1 gap-3" aria-label="Aurora public flight archive">
    {featured && <Cover flight={featured} href={archiveLink(params, featured.id, false, featured.projectId)}/>}
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      {flights.length > 0 && <p className="text-xs text-muted-foreground">{individual} individual flight reports · {flights.length - individual} campaign reports</p>}
      <PublicLink href={historyUrl}>Dawn flight history</PublicLink>
    </div>
    {flights.length === 0 && <p role="status" className="text-sm text-muted-foreground">Public flight records are unavailable.</p>}
    <ul aria-label="Published flight and campaign reports" className="divide-y">{flights.map(flight => <li key={flight.id}>
      <Link href={archiveLink(params, flight.id, false, flight.projectId)} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <span className="text-xs text-muted-foreground sm:text-sm">{flight.period}</span>
        <span className="col-start-1 font-medium group-hover:underline sm:col-start-2">{flight.title}</span>
        <ChevronRight aria-hidden className="col-start-2 row-span-2 row-start-1 size-4 text-muted-foreground sm:col-start-3 sm:row-span-1"/>
      </Link>
    </li>)}</ul>
    {hasRecordings && <Link href={recordings}
      className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline">Payload recordings <ArrowRight className="size-4" aria-hidden/></Link>}
  </section>;
}
