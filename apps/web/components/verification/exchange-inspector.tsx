"use client";

import { RecordTable, TableColumns } from "@/components/records/table";
import { GrafanaLinks } from "./grafana-links";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArchiveDialog } from "@/components/records/archive-dialog";
import { Button } from "@/components/ui/button";
import { PersonField, NoteField } from "@/components/records/forms";
import { useFindingDraft } from "@/components/records/use-record-submission";
import { saveWorkspace, useVerification } from "@/lib/workspace";
import { formatUtcDateTime } from "@/lib/utc-time";
import { sameUnit, type RecordUnit } from "@/lib/records/journal";
import { exchangeKeys, resolveExchange, type ExchangeArchive, type ExchangeBasis, type ExchangeLog } from "./document-exchanges";

function LogDetail({ log, group }: {
  log: ExchangeLog; group: NonNullable<ReturnType<typeof resolveExchange>>["prior"];
}) {
  const events = group.events;
  return <div className="min-w-0">
    <h4 className="font-medium">{log.title} · {group.status}</h4>
    {events.length > 0 && <ol aria-label={log.title + " cited events"} className="divide-y text-sm">
      {events.map(e => <li key={e.id} className="py-2">
        <p><strong>{e.id}</strong> · {e.kind === "request" ? "Request" : "Reply"} · {e.atMs} ms</p>
        <p>{e.document} · {e.kind === "request" ? "Expected: " + e.expected : e.value}</p>
      </li>)}
    </ol>}
    {group.elapsedMs !== undefined && <p className="text-xs text-muted-foreground">Request to reply · {group.elapsedMs} ms</p>}
    {group.notes.map(note => <p key={note} className="text-sm">{note}</p>)}
    {group.candidates.length > 0 && <p className="mt-1 text-sm">Same subject and value under another key:{" "}
      {group.candidates.join(", ")}. Ownership is unconfirmed.</p>}
  </div>;
}

async function saveExchange(payload: Record<string, unknown>, requestId: string) {
  const result = await saveWorkspace({ ...payload, operation: "event-finding", requestId });
  return result.error ?? (result.record?.id === `local-evidence-${requestId}` ? undefined : "Unable to confirm the finding.");
}

function ExchangeComparison({ archive, pinned, sourceId, unit, readOnly }: {
  archive: ExchangeArchive; pinned?: ExchangeBasis; sourceId: string; unit: RecordUnit; readOnly?: boolean;
}) {
  const [key, choose] = useState(pinned?.correlation ?? "");
  const { actors } = useVerification();
  const rows = useMemo(() => (pinned ? [pinned] : exchangeKeys(archive))
    .map(entry => resolveExchange(archive, entry)).filter(row => row !== undefined), [archive, pinned]);
  const selected = rows.find(row => row.basis.correlation === key);
  const logs = [archive.prior, archive.current];
  const draft = useFindingDraft(saveExchange, selected && {
    sourceId, unit, basis: selected.basis, expectedArchive: archive,
  }, undefined, "Finding saved in Notes.", key);
  if (pinned && !selected) {
    return <p>The cited exchange is unavailable in the retained log pair.</p>;
  }

  return <div className="grid min-w-0 gap-5">
    {!pinned && <RecordTable aria-label="Comparison by correlation key" className="[&_tbody_tr]:border-t">
      <TableColumns labels={["Correlation", archive.prior.title, archive.current.title]} />
      <tbody>{rows.map(({basis: {correlation: value}, prior, current}) => {
        return <tr key={value}>
          <th scope="row"><Button type="button" variant={value === key ? "secondary" : "ghost"} size="sm"
            aria-pressed={key === value} disabled={draft.busy} onClick={() => choose(value)}>{value}</Button></th>
          <td>{prior.status}</td><td>{current.status}</td>
        </tr>;
      })}</tbody>
    </RecordTable>}
    <section className="grid gap-2" aria-label="Export order">
      <h3 className="text-sm font-semibold">Export order</h3>
      <p className="text-xs text-muted-foreground">Events run left to right in file order. Each file has its own elapsed clock.</p>
      {logs.map(log => <div key={log.id} className="min-w-0">
        <p className="mb-1 text-xs font-medium">{log.title} · {log.id}</p>
        <ol aria-label={log.title + " event order"} className="flex flex-wrap gap-1">
          {log.events.map(e => <li key={e.id}>
            <button type="button" disabled={Boolean(pinned) || draft.busy} aria-pressed={e.key === key}
              aria-label={`${log.id} ${e.id}, ${e.kind}, ${e.key}, ${e.atMs} milliseconds`}
              onClick={() => choose(e.key)}
              className="rounded border px-2 py-1 text-xs focus-visible:outline-2 aria-pressed:border-foreground aria-pressed:bg-muted">
              <span aria-hidden="true">{e.kind === "request" ? "↗" : "↙"} </span>{e.id}
            </button>
          </li>)}
        </ol>
      </div>)}
      <p className="text-xs text-muted-foreground">↗ Request · ↙ Reply</p>
    </section>
    {selected ? <>
      <section aria-label="Selected exchange" className="grid gap-3">
        <h3 className="text-sm font-semibold">Exchange · {key}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <LogDetail log={archive.prior} group={selected.prior} />
          <LogDetail log={archive.current} group={selected.current} />
        </div>
        <GrafanaLinks archive={archive} sourceId={sourceId} unit={unit} correlation={key} />
      </section>
      {!pinned && !readOnly && (
        <form className="grid gap-3 border-t pt-4" onSubmit={draft.save}>
          <h3 className="text-sm font-semibold">Record a finding</h3>
          <PersonField people={actors} {...draft.person} />
          <NoteField label="Observation" {...draft.observation} />
          <Button variant="outline" className="justify-self-start bg-popover" size="sm" type="submit" disabled={draft.disabled}>
            Save finding
          </Button>
          {draft.feedback && <p role="status" className="text-sm">{draft.feedback}</p>}
        </form>
      )}
    </> : <p className="mt-1 text-[13px] leading-normal text-muted-foreground">Choose a correlation or event to inspect the exchange.</p>}
  </div>;
}

export function ExchangeInspector({ archive, sourceId, unit, readOnly }: { archive: ExchangeArchive; sourceId: string; unit: RecordUnit; readOnly?: boolean }) {
  const { evidenceHistory, actors } = useVerification();
  const findingId = useSearchParams().get("eventFinding");
  const finding = findingId ? evidenceHistory.find(row => row.id === findingId && row.action?.parentId === sourceId && sameUnit(row.action.unit, unit)) : undefined;
  const pinned = finding?.eventFinding;
  return <ArchiveDialog label="Inspect exchanges"
    title={findingId ? "Recorded exchange finding" : "Compare recorded exchanges"}
    description={`${unit.serial} · ${unit.revision} · ${sourceId}`} pinned={Boolean(findingId)}
    clearOnClose={findingId ? ["eventFinding"] : undefined} compact>
      {pinned && finding && <div className="text-sm"><p>{finding.description}</p>
        <p className="text-muted-foreground">{actors.find(person => person.id === pinned.actor)?.name ?? finding.context} · {formatUtcDateTime(finding.recordedAt)}</p>
      </div>}
      {findingId && !pinned ? <p>Finding unavailable for this source. Close to return to the evidence.</p> : <ExchangeComparison key={finding?.id ?? sourceId}
        archive={pinned?.archive ?? archive} pinned={pinned?.basis} sourceId={sourceId} unit={unit} readOnly={readOnly} />}
  </ArchiveDialog>;
}
