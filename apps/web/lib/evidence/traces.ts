import type { IndexedSeries } from "../../components/verification/numeric-series";
import type { EventProjection } from "../../components/verification/document-exchanges";
import type { AcceptanceCheck } from "../../components/verification/acceptance";
import type { AlignedSample, RunEdition } from "./images";

export type TraceWindow = Pick<RunEdition, "id" | "checkId" | "archiveId" | "serial" | "revisionId"> & {
  digest?: string;
  label: string;
  first: number;
  last: number;
};
export type IndexedTrace = Omit<TraceWindow, "label" | "first" | "last"> & {
  digest: string;
  frames: number[];
};
type ViewerIndex<Edition> = {
  grafanaPublicUrl: string;
  grafana: boolean;
  influx: boolean;
  editions: Edition[];
};

export function archiveTraceWindows(
  check: AcceptanceCheck,
  source: NonNullable<AcceptanceCheck["comparison"]>,
  first = 1,
  last = source.frames.length,
): TraceWindow[] {
  if (!source.runId || !source.rerunId || !source.frames.length) return [];

  return [
    { id: source.runId, label: source.run },
    { id: source.rerunId, label: source.rerun },
  ].map(run => ({ ...run, ...check.unit, checkId: check.id, archiveId: source.evidenceId, first, last }));
}

const roles = ["source", "comparison", "control"] as const;
export function analysisTraceWindows(runs: RunEdition[], samples: AlignedSample[]): TraceWindow[] {
  if (!samples.length) return [];

  return runs.flatMap(({ id, digest, checkId, archiveId, serial, revisionId, title }, i) => {
    const role = roles[i];
    const first = samples[0][role];
    const last = samples[samples.length - 1][role];
    if (!first || !last) return [];

    return [
      {
        id,
        digest,
        checkId,
        archiveId,
        serial,
        revisionId,
        label: serial + " · " + title,
        first: first.frame,
        last: last.frame,
      },
    ];
  });
}

// Imported frames occupy ordinal display seconds; these are not acquisition timestamps.
export const frameEpoch = Date.UTC(2026, 0, 1);
export function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export async function traceEdition(id: string, inputs: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(inputs));

  return id + "~" + hex(await crypto.subtle.digest("SHA-256", bytes));
}

type IndexedPoint = readonly [id: string, position: number, time: number, value?: number];

// Every archive row must occur once at its original position, even when the index returns it out of order.
export function matchesTrace(source: IndexedPoint[], indexed: IndexedPoint[]) {
  if (!source.length || indexed.length !== source.length) return false;
  const ordered = indexed.toSorted((a, b) => a[1] - b[1]);

  return source.every((row, i) => row.every((value, j) => value === ordered[i][j]));
}

export function dashboardUrl(grafanaBase: string, path: string, edition: string, from: number, to: number,
  selection?: {first: number; last: number}) {
  const url = new URL(`${grafanaBase}/d/${path}`);
  url.searchParams.set("var-edition", edition);
  url.searchParams.set("from", String(frameEpoch + from));
  url.searchParams.set("to", String(frameEpoch + to));
  if (selection) {
    url.searchParams.set("var-windowStart", String(selection.first));
    url.searchParams.set("var-windowStop", String(selection.last + 1));
  }

  return url.href;
}

export function originalTraceUrl(window: TraceWindow, viewer: ViewerIndex<IndexedTrace>) {
  const edition = viewer.editions.find(
    (row) =>
      row.id === window.id &&
      row.checkId === window.checkId &&
      row.archiveId === window.archiveId &&
      row.serial === window.serial &&
      row.revisionId === window.revisionId,
  );
  if (!edition || !viewer.grafana || !viewer.influx || !/^[a-f0-9]{64}$/.test(edition.digest)) return;
  if (window.digest && window.digest !== edition.digest) return;
  if (
    !Number.isInteger(window.first) ||
    !Number.isInteger(window.last) ||
    window.first < 1 ||
    window.last < window.first
  )
    return;
  const available = new Set(edition.frames.filter((frame) => frame >= window.first && frame <= window.last));
  if (available.size !== window.last - window.first + 1) return;

  return dashboardUrl(viewer.grafanaPublicUrl, "dte-inspection-frames/inspection-image-readings",
    edition.id + "~" + edition.digest, (window.first - 1) * 1000, window.last * 1000 - 1);
}

type DashboardEditions = {
  run: IndexedTrace;
  series: IndexedSeries;
  exchange: EventProjection;
};

const dashboardName = { run: "inspection", series: "measurement", exchange: "event" } as const;

export async function readTraceIndex<K extends keyof DashboardEditions>(
  kind: K,
  ids: string[],
  signal: AbortSignal,
): Promise<ViewerIndex<DashboardEditions[K]>> {
  // The local reader accepts up to three distinct editions per request.
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error("Choose a recorded edition.");
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += 3) {
    batches.push(unique.slice(start, start + 3));
  }

  const indexes = await Promise.all(batches.map(async batch => {
    const query = new URLSearchParams(batch.map(id => [kind, id]));
    const response = await fetch("/api/inspection-viewer?" + query, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Unable to check the local trace viewer.");
    const index: ViewerIndex<DashboardEditions[K]> = await response.json();
    if (!index.grafana) {
      throw new Error("The local " + dashboardName[kind] + " dashboard is unavailable. Check the local service setup.");
    }
    if (!index.influx) throw new Error("The local trace index is unavailable. Check the local service setup.");

    return index;
  }));

  return { ...indexes[0], editions: indexes.flatMap(index => index.editions) };
}
