import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { setListLocation } from "@/components/workspace/navigation";
import { RecordResults } from "@/components/records/results";
import { Badge } from "@/components/ui/badge";
import { ConnectionLink } from "@/components/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { WorkCase, WorkEvent } from "@/db/workflows/cases";
import { toolHref } from "@/lib/workspace-routes";
import { WorkspaceLink } from "@/components/workspace/section-tabs";

export function CaseHeading({ record, back, status, children }: {
  record: WorkCase; back: string; status?: string; children: ReactNode;
}) {
  return <>
    <WorkspaceLink direction="back" href={toolHref(record.tool)}>{back}</WorkspaceLink>
    <header className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2>{record.title}</h2>
        {status && <Badge variant="secondary">{status}</Badge>}
      </div>
      {children}
    </header>
  </>;
}

type Entry = { record: WorkCase; detail: string; filter?: string; search?: string; status?: string; title?: string };

export function CaseList({ label, rows }: { label: string; rows: Entry[] }) {
  const params = useSearchParams();
  if (!rows.length) return <p className="mt-0.5 text-xs text-muted-foreground">Unavailable</p>;
  return (
    <RecordResults records={rows.map(entry => ({ ...entry, id: entry.record.id }))}
      searchLabel={`Search ${label.toLowerCase()}`} statusLabel={`${label} filter`} emptyMatch={`No matching ${label.toLowerCase()}`}
      search={{ value: params.get("q") ?? "", onChange: text => setListLocation(undefined, "q", text || null) }}
      selectedStatus={params.get("status") ?? "All"} onStatusChange={status => setListLocation(undefined, "status", status === "All" ? null : status)}
      searchText={row => [row.record.id, row.title ?? row.record.title, row.detail, row.status, row.search].join(" ")}
      status={row => row.filter ?? row.status ?? "Unavailable"}>
      {matches => <ul aria-label={label} className="divide-y">
      {matches.map(({ record, title, detail, status }) => (
        <li key={record.id} className="relative flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-sm py-3 hover:bg-muted">
          <div className="grid min-w-0 gap-1">
            <ConnectionLink id={record.id} sourceId={record.id} className="after:absolute after:inset-0"
              connection={{ href: toolHref(record.tool, record.id), label: title ?? record.title }} />
            <span className="mt-0.5 text-xs text-muted-foreground">{detail}</span>
          </div>
          {status && <Badge variant="secondary">{status}</Badge>}
        </li>
      ))}
      </ul>}
    </RecordResults>
  );
}

export function DecisionHistory({ events, name, children, anchor, rowClass = "grid gap-1 py-2" }: {
  events: WorkEvent[]; name: (id: string) => string; children: (event: WorkEvent) => ReactNode;
  anchor?: (event: WorkEvent) => string; rowClass?: string;
}) {
  return (
    <ol className="divide-y">
      {events.map(event => (
        <li key={event.id} id={anchor?.(event) ?? event.id} className={rowClass}>
          <strong>{event.title}</strong>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {name(event.actor)} · <time dateTime={event.at}>{formatUtcDateTime(event.at)}</time>
          </p>
          {children(event)}
        </li>
      ))}
    </ol>
  );
}

type ComparisonSide = [label: ReactNode, value: ReactNode];

export function ComparedValues({ before, after, className }: {
  before: ComparisonSide; after: ComparisonSide; className: string;
}) {
  return <dl className={`grid sm:grid-cols-2 ${className}`}>
    {Object.entries({ before, after }).map(([side, [label, value]]) => (
      <div key={side}><dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt><dd>{value}</dd></div>
    ))}
  </dl>;
}
