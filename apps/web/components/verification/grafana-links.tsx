"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RecordUnit } from "@/lib/records/journal";
import { originalTraceUrl, readTraceIndex, type TraceWindow } from "@/lib/evidence/traces";
import { eventClockHref, eventClockWindow, exchangeEdition, type ExchangeArchive } from "./document-exchanges";
import { measurementEdition, measurementUrl, type RecordedSeries } from "./numeric-series";
import type { VerificationTest } from "./model";

type Dashboard = Parameters<typeof readTraceIndex>[0];
type Viewer<K extends Dashboard> = Awaited<ReturnType<typeof readTraceIndex<K>>>;

function GrafanaEditions<Row, K extends Dashboard>({
  kind, source, rows, edition, describe, description,
}: {
  kind: K;
  source: string | object;
  rows: readonly Row[];
  edition: (row: Row) => string | Promise<string>;
  describe: (row: Row, id: string, viewer: Viewer<K>) => { href?: string; caption: string };
  description?: string;
}) {
  const [response, setResponse] = useState<{source: typeof source; index?: Viewer<K>; ids?: string[]; error?: string}>();
  const [attempt, retry] = useState(0);
  const load = useEffectEvent(async (signal: AbortSignal) => {
    const ids = await Promise.all(rows.map(edition));
    return { ids, index: await readTraceIndex(kind, ids, signal) };
  });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    load(signal).then(
      data => { if (!signal.aborted) setResponse({ source, ...data }); },
      (error: unknown) => {
        if (!signal.aborted) setResponse({ source, error: error instanceof Error ? error.message : "The local viewer is unavailable." });
      },
    );
    return () => controller.abort();
  }, [source, attempt]);
  if (!response || response.source !== source) return <p className="mt-0.5 text-xs text-muted-foreground" role="status">Checking Grafana…</p>;
  const { index, ids, error } = response;
  if (!index || !ids) return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="mt-0.5 text-xs text-muted-foreground" role="status">{error}</p>
      <Button size="sm" variant="outline" className="bg-popover" onClick={() => { setResponse(undefined); retry(n => n + 1); }}>Retry</Button>
    </div>
  );
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      {rows.map((row, i) => {
        const { href, caption } = describe(row, ids[i], index);
        return (
          <div key={ids[i]} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="block mt-0.5 text-xs text-muted-foreground">{caption}</span>
            {href && <Button size="sm" variant="outline" className="bg-popover" nativeButton={false} role="link"
              render={<a href={href} target="_blank" rel="noopener noreferrer"
                aria-label={`Open in Grafana · ${caption} (opens in a new tab)`} />}>
              <Image className="h-4 w-auto shrink-0" src="/service-icons/grafana.svg" width={351} height={365} alt="" unoptimized />
              Open in Grafana
            </Button>}
          </div>
        );
      })}
    </div>
  );
}

type Source =
  | { windows: TraceWindow[] }
  | { series: RecordedSeries[]; method: VerificationTest; recordId: string; unit: RecordUnit }
  | { archive: ExchangeArchive; sourceId: string; unit: RecordUnit; correlation?: string };

export function GrafanaLinks(source: Source) {
  if ("windows" in source) {
    const { windows } = source;
    if (!windows.length) return null;
    return <GrafanaEditions kind="run" source={JSON.stringify(windows.map(w => w.id))} rows={windows} edition={w => w.id}
      description="Whole-caption measurements at each run’s original frame positions."
      describe={(window, _, viewer) => {
        const href = originalTraceUrl(window, viewer);
        const span = href ? `frames ${window.first}–${window.last}`
          : "This interval is missing from the local trace index. Run “python3 apps/backend/scripts/sync.py sync” and reopen this record.";
        return { href, caption: window.label + " · " + span };
      }} />;
  }
  if ("series" in source) {
    const { series, method, recordId, unit } = source;
    if (!series.length) return null;
    return <GrafanaEditions kind="series" key={[method, recordId, unit.serial, unit.revisionId].join("/")}
      source={series} rows={series} edition={s => measurementEdition(method, recordId, unit, s)}
      describe={(s, id, viewer) => {
        const times = s.points.map(point => point.elapsedMs);
        const first = Math.min(...times), last = Math.max(...times);
        const href = measurementUrl(s, id, viewer.editions.find(e => e.edition === id), viewer.grafanaPublicUrl, first, last);
        return { href, caption: s.quantity + " · " + (href ? `${first}–${last} ms` : "This edition is missing from the local measurement index.") };
      }} />;
  }
  const { archive, sourceId, unit, correlation } = source;
  return <GrafanaEditions kind="exchange" key={[sourceId, unit.serial, unit.revisionId, archive.id].join("/")}
    source={archive} rows={[archive.prior, archive.current]}
    edition={log => exchangeEdition(log, sourceId, unit.serial, unit.revisionId, archive.id)}
    describe={(log, id, viewer) => {
      const window = eventClockWindow(log, correlation);
      const href = window && eventClockHref(log, id, viewer.editions, viewer.grafanaPublicUrl, window);
      if (!window || !href) return {caption: log.title + " · " + (window
        ? "This edition is missing from the local event index." : "No event for this correlation.")};
      const span = window.first === window.last ? window.first : `${window.first}–${window.last}`;
      return { href, caption: `${log.id} · ${span} ms` };
    }} />;
}
