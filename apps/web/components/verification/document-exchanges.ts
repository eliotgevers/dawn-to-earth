import { dashboardUrl, matchesTrace, traceEdition } from "@/lib/evidence/traces";

export type ExchangeEvent = {
  id: string;
  key: string;
  document: string;
  atMs: number;
} & (
  | { kind: "request"; expected: string }
  | { kind: "reply"; value: string }
);

export type ExchangeLog = { id: string; title: string; events: readonly ExchangeEvent[] };
export type ExchangeArchive = { id: string; prior: ExchangeLog; current: ExchangeLog };
export type ExchangeBasis = {
  archiveId: string;
  priorLogId: string;
  currentLogId: string;
  correlation: string;
  priorEventIds: string[];
  currentEventIds: string[];
};

export function exchangeKeys(archive: ExchangeArchive) {
  return [...new Set([...archive.prior.events, ...archive.current.events].map(event => event.key))];
}

function readExchange(log: ExchangeLog, key: string) {
  const events = log.events.filter(event => event.key === key);
  const requests = events.filter(event => event.kind === "request");
  const replies = events.filter(event => event.kind === "reply");
  const request = requests[0];
  const reply = replies[0];
  const notes: string[] = [];
  let status: string;
  let elapsedMs: number | undefined;
  if (!events.length) status = "No entry";
  else if (!request) status = "Unmatched reply";
  else if (requests.length > 1) status = "Reused key";
  else if (!reply) status = "No keyed reply";
  else if (replies.length > 1) {
    status = replies.every(r => r.document === reply.document && r.value === reply.value)
      ? "Duplicate replies" : "Conflicting replies";
  } else if (reply.document !== request.document) status = "Different subject";
  else if (reply.value !== request.expected) status = "Unexpected reply";
  else status = "Matched";

  if (requests.length === 1 && replies.length === 1) {
    if (reply.atMs >= request.atMs) elapsedMs = reply.atMs - request.atMs;
    else {
      if (status === "Matched") status = "Clock conflict";
      notes.push("The reply clock mark precedes the request. Elapsed time is unavailable.");
    }
    if (events.indexOf(reply) < events.indexOf(request)) {
      if (status === "Matched") status = "Reordered";
      notes.push("The file lists the reply before the request.");
    }
  }
  if (status === "Reused key") notes.push("Several requests use this key. The archive does not identify which request owns each reply.");
  if (status === "Unmatched reply") notes.push("No request uses this key in this file.");
  if (status === "No keyed reply") notes.push("No reply in this file carries the request key.");
  const candidates = request && !reply && requests.length === 1
    ? [...new Set(log.events.filter(event => event.kind === "reply" && event.document === request.document &&
      event.key !== key && event.value === request.expected).map(event => event.key))]
    : [];
  return { events, status, elapsedMs, notes, candidates };
}

export function resolveExchange(archive: ExchangeArchive, target: string | ExchangeBasis) {
  const correlation = typeof target === "string" ? target : target.correlation;
  const prior = readExchange(archive.prior, correlation);
  const current = readExchange(archive.current, correlation);
  if (!prior.events.length && !current.events.length) return;
  const basis: ExchangeBasis = {
    archiveId: archive.id, priorLogId: archive.prior.id, currentLogId: archive.current.id, correlation,
    priorEventIds: prior.events.map(e => e.id), currentEventIds: current.events.map(e => e.id),
  };
  if (typeof target !== "string" && (basis.archiveId !== target.archiveId || basis.priorLogId !== target.priorLogId ||
    basis.currentLogId !== target.currentLogId || JSON.stringify(basis.priorEventIds) !== JSON.stringify(target.priorEventIds) ||
    JSON.stringify(basis.currentEventIds) !== JSON.stringify(target.currentEventIds))) return;
  return { prior, current, basis };
}

export type EventProjection = {
  edition: string;
  rows: [eventId: string, exportPosition: number, elapsedMs: number][];
};

export async function exchangeEdition(
  log: ExchangeLog,
  sourceId: string,
  serial: string,
  revisionId: string,
  archiveId: string,
) {
  const rows = log.events.map((e) => [
    e.id,
    e.key,
    e.document,
    e.atMs,
    e.kind,
    e.kind === "request" ? e.expected : e.value,
  ]);
  return traceEdition(log.id, [sourceId, serial, revisionId, archiveId, log.id, rows]);
}

export function eventClockWindow(log: ExchangeLog, correlation?: string) {
  const events = correlation ? log.events.filter((event) => event.key === correlation) : log.events;
  if (!events.length) return;
  const times = events.map((event) => event.atMs);
  return { first: Math.min(...times), last: Math.max(...times) };
}

export function eventClockHref(
  log: ExchangeLog,
  edition: string,
  indexed: EventProjection[],
  grafanaBase: string,
  window: NonNullable<ReturnType<typeof eventClockWindow>>,
) {
  const rows = indexed.find((result) => result.edition === edition)?.rows;
  const full = eventClockWindow(log);
  if (
    !full ||
    !rows ||
    !matchesTrace(log.events.map((event, i) => [event.id, i + 1, event.atMs]), rows) ||
    !Number.isSafeInteger(window.first) ||
    !Number.isSafeInteger(window.last) ||
    window.first > window.last ||
    window.first < full.first ||
    window.last > full.last
  )
    return;
  const margin = Math.max(5, Math.ceil((full.last - full.first) / 10));
  return dashboardUrl(grafanaBase, "dte-exchange-events/electronics-exchange-log", edition,
    full.first - margin, full.last + margin + 1, window);
}
