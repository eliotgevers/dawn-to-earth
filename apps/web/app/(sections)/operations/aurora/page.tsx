import { Suspense } from "react";
import { Loading } from "@/components/records/empty";
import Link from "next/link";
import { fileFinding } from "@/app/(sections)/actions";
import AuroraCalendar from "@/components/operations/aurora/calendar";
import AuroraService from "@/components/operations/aurora/service";
import { AuroraTabs, FlightDetail, FlightHistory } from "@/components/operations/aurora/view";
import { StudyWorkspace } from "@/components/operations/study";
import { SectionTabs } from "@/components/workspace/section-tabs";
import { parseSelection, type ItemSelection } from "@/components/workspace/selection";
import { canPostFlightComment, flightComments, flightServiceLinks, readAuroraService, readCalendar, readFlightArchive } from "@/db/operations/aurora";
import { readForRequest } from "@/db/http";
import { readOperationsStudy } from "@/db/operations/study";
import { operationsStudies } from "@/lib/archives/study";
import { withSelections } from "@/lib/workspace-routes";

export const metadata = { title: operationsStudies.aurora };

export default async function AuroraPage({ searchParams }: PageProps<"/operations/aurora">) {
  const { item, view, flight, finding, document, record } = await searchParams;
  const requested = (Array.isArray(item) ? item : item === undefined ? [] : [item]).map(parseSelection);
  if (!requested.every(value => value !== null)) return <p role="status">Unavailable for this selection.</p>;
  const selections = [...new Set(requested)];
  const active = view === "calendar" || view === "service" ? view : "history";
  return <SectionTabs section="operations" active="aurora" selections={selections}>
    <AuroraTabs active={active} items={selections}>
      <Suspense key={JSON.stringify([active, view, selections, flight, finding, document, record])} fallback={<Loading />}>
        <ArchiveView {...{ selections, view, flight, finding, document, record }} />
      </Suspense>
    </AuroraTabs>
  </SectionTabs>;
}

async function ArchiveView({ selections, view, flight, finding, document, record }: {
  selections: ItemSelection[];
} & Pick<Awaited<PageProps<"/operations/aurora">["searchParams"]>, "view" | "flight" | "finding" | "document" | "record">) {
  let content;
  switch (view) {
    case "recordings":
      content = <Recording selections={selections} findingId={finding} />;
      break;
    case "calendar":
      content = await readForRequest(async db => {
        const calendar = await readCalendar(db, selections);
        return "error" in calendar ? <p role="status">{calendar.error}</p> :
          <AuroraCalendar key={selections.join("|")} items={selections} initial={calendar.entries} reports={calendar.reports} />;
      });
      break;
    case "service":
      content = await readForRequest(async db => {
        if (Array.isArray(flight)) return <p role="status">Choose one flight to view its service records.</p>;
        const service = await readAuroraService(db, selections, flight);
        if (document !== undefined) {
          const entry = service.records.find(row => row.id === record &&
            [row.filing?.evidenceId, row.filing?.completionEvidenceId, row.filing?.returnRecordId].includes(typeof document === "string" ? document : ""));
          const doc = entry && service.documents.find(row => row.id === document && row.flightId === entry.flightId);
          const back = new URLSearchParams({ view: "service" });
          if (flight) back.set("flight", flight);
          const href = withSelections("/operations/aurora?" + back + (entry ? "#service-" + entry.id : ""), selections);

          return <article className="grid max-w-2xl gap-3">
            <Link href={href} className="w-fit text-sm text-primary hover:underline">Back to service log</Link>
            {doc ? <><p className="text-sm text-muted-foreground">Demo document · {doc.kind} · {doc.id}</p>
              <h2 className="text-xl font-semibold">{doc.title}</h2>
              <p className="text-sm">{doc.body}</p>
              <p className="text-sm text-muted-foreground">Filed by {doc.filedBy} · <time dateTime={doc.filedOn}>{doc.filedOn}</time></p>
            </> : <p role="status">Document unavailable for this service record.</p>}
          </article>;
        }
        return <AuroraService key={JSON.stringify([selections, flight])} items={selections} flightId={flight} {...service} />;
      });
      break;
    default:
      content = <FlightArchive selections={selections} flightId={flight} />;
  }
  return content ?? <p role="status">Database is unavailable</p>;
}

async function Recording({ selections, findingId }: { selections: ItemSelection[]; findingId?: string | string[] }) {
  const id = Array.isArray(findingId) ? findingId[0] : findingId;
  const history = await readForRequest(db => readOperationsStudy(db, "aurora", id, selections));
  return history ? <StudyWorkspace study="aurora" history={history} record={fileFinding.bind(null, "aurora", selections)} />
    : <p role="status">The Catalog and saved findings are unavailable.</p>;
}

async function FlightArchive({ selections, flightId }: { selections: ItemSelection[]; flightId?: string | string[] }) {
  const archive = await readForRequest(db => readFlightArchive(db, selections));
  if (!archive) return <p role="status">Database is unavailable</p>;
  if (!flightId) {
    return <FlightHistory flights={archive.reports} scoped={selections.length > 0} hasRecordings={archive.hasRecordings} />;
  }
  const back = withSelections("/operations/aurora", selections);
  const report = archive.reports.find(row => row.id === flightId);
  if (!report) return <div className="text-sm">
    <p role="status">{!archive.reports.length && selections.length
      ? "No public Aurora flights are linked to this selection." : "Flight record unavailable."}</p>
    <Link href={back} className="text-primary hover:underline">Flight archive</Link>
  </div>;

  const detail = report.kind === "flight" ? await readForRequest(db => Promise.all([
    flightComments(db, report.id), flightServiceLinks(db, report.id), canPostFlightComment(db),
  ])) : null;
  return <FlightDetail flight={report} back={back} comments={detail?.[0] ?? null} service={detail?.[1] ?? []} canPostComment={detail?.[2] ?? false} />;
}
