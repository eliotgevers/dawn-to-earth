"use client";
import { RecordResults } from "@/components/records/results";
import { useSearchParams } from "next/navigation";
import { sameUnit, type RecordUnit } from "@/lib/records/journal";
import { badgeTones, recordLink } from "@/components/records/presentation";

import { agreementConnection } from "@/db/workflows/agreements";
import { unitSelection } from "@/components/workspace/selection";
import { Input } from "@/components/ui/input";
import { MissingRecord, SectionTabs } from "@/components/workspace/section-tabs";
import { RelatedWork } from "@/components/workspace/related-work";
import { useRef, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { focusRelatedRecord, useItemSelection, watchRecordLinks } from "@/components/workspace/navigation";
import { packetBasis, unitReadiness } from "@/lib/readiness";
import type { readReadinessWorkspace } from "@/db/verification/release";
import { saveWorkspace } from "@/lib/workspace";
import { formatUtcDateTime } from "@/lib/utc-time";
import { recordConnection, recordLabel } from "@/lib/records/links";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonField, FormDialog, LabeledSelect } from "@/components/records/forms";
import { Dialog } from "@base-ui/react/dialog";
import type { PacketContents } from "@/db/schema";
import { ConnectionLink, ConnectionList } from "@/components/records/links";

type Workspace = Awaited<ReturnType<typeof readReadinessWorkspace>>;

export function ReleaseReadiness({ workspace }: { workspace: Workspace }) {
  const { records, packets, toolTasks } = workspace;
  const { selections, selectItems, item } = useItemSelection(records.catalog);
  const query = useSearchParams().get("q") ?? "";
  const [missing, setMissing] = useState("");
  const members = item?.members.map(unit => ({
    ...unit,
    id: `unit-${unit.serial}-${unit.revisionId}`,
    title: records.catalog.units.find(row => row.serial === unit.serial)?.title,
  })) ?? [];

  function updateSearch(text: string, keepTarget = false) {
    const url = new URL(window.location.href);
    if (text) url.searchParams.set("q", text);
    else url.searchParams.delete("q");
    if (!keepTarget) {
      url.hash = "";
      setMissing("");
    }
    window.history.replaceState(null, "", url);
  }

  const revealTarget = useEffectEvent((id: string) => {
    if (!/^(unit|packet)-/.test(id) || focusRelatedRecord(id)) {
      setMissing("");
      return;
    }
    // A link can point into a signed packet inside a filtered but selected unit.
    // Reveal that unit without changing the picker or counting another unit's packet.
    const packet = packets.find(candidate => "packet-" + candidate.id === id);
    const belongs = members.some(unit => unit.id === id || (packet && sameUnit(unit, packet)));
    if (belongs && query) updateSearch("", true);
    else setMissing(id);
  });
  const scope = selections.join("|");
  useEffect(() => watchRecordLinks(revealTarget), [scope, query, packets]);

  return (
    <SectionTabs section="operations" active="readiness" catalog={records.catalog} selections={selections}
      onChange={selectItems} className="grid gap-3">
      {missing && <MissingRecord id={missing} />}
      {item && <RecordResults records={members} searchLabel="Search units" searchText={unit =>
        [unit.serial, unit.title, unit.revision, unit.revisionId].filter(Boolean).join(" ")}
        search={{ value: query, onChange: text => updateSearch(text) }}
        empty="No units in this selection" emptyMatch="No selected units match this search."
        actions={query && <Button variant="ghost" size="sm" onClick={() => updateSearch("")}>Clear search</Button>}>
        {matches => <PacketForms workspace={workspace}>
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Unit delivery readiness</caption>
            <thead className="text-xs text-muted-foreground [&_th]:px-2 [&_th]:pb-2 max-sm:[&_th]:px-1 max-sm:text-[11px]">
              <tr>
                <th scope="col" className="w-[16%]">Status</th>
                <th scope="col" className="w-[36%] max-sm:w-[31%]">Unit</th>
                <th scope="col" className="w-[12%]">Builds</th>
                <th scope="col" className="w-[21%] max-sm:w-[24%]">Accepted inspections</th>
                <th scope="col">Open issues</th>
              </tr>
            </thead>
            {matches.map(unit => (
              <UnitResult key={unit.id} unit={unit} workspace={workspace} />
            ))}
          </table>
        </PacketForms>}
      </RecordResults>}
      <RelatedWork item={item} section="operations" tasks={toolTasks} />
    </SectionTabs>
  );
}

function UnitResult({ unit, workspace }: { unit: RecordUnit; workspace: Workspace }) {
  const { packets, users, actors } = workspace;
  const { contents, issues, blockers, checks } = unitReadiness(workspace, unit);
  const versions = packets.filter(packet => sameUnit(packet, unit));
  const latest = versions[0]?.contents;
  const signed = !blockers.length && latest && packetBasis(latest) === packetBasis(contents);
  const id = `unit-${unit.serial}-${unit.revisionId}`;

  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <tbody className={expanded ? "bg-muted/50" : undefined}>
      <tr className="relative border-t align-top [&_td]:px-2 [&_td]:py-3 max-sm:[&_td]:px-1">
        <td>
          <Badge variant="outline" className={`h-auto max-w-full whitespace-normal text-center leading-tight max-sm:px-1 ${blockers.length ? badgeTones.amber : badgeTones.green}`}>
            {blockers.length ? "Held" : signed ? "Signed" : "Ready for sign-off"}
          </Badge>
        </td>
        <th scope="row" className="px-2 py-3 font-normal max-sm:px-1">
          <button type="button" aria-expanded={expanded} aria-controls={id}
            onClick={() => { if (details.current) details.current.open = !details.current.open; }}
            className="inline-flex max-w-full cursor-pointer items-center gap-1 text-start font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring">
            <span className="wrap-anywhere">{unit.serial}</span>
            <span className="sr-only">{unit.revision}</span>
          </button>
          <span aria-hidden="true" className="block text-xs text-muted-foreground wrap-anywhere">{unit.revision}</span>
        </th>
        <td className="tabular-nums">{contents.builds.length}</td>
        <td className="tabular-nums">{contents.inspections.length} / {checks.length}</td>
        <td className="tabular-nums">{issues.length}</td>
      </tr>
      <tr>
        <td colSpan={5} className="p-0">
          <details id={id} tabIndex={-1} ref={details} onToggle={event => setExpanded(event.currentTarget.open)}
            className="scroll-mt-[calc(var(--header)+12px)]">
            <summary hidden>Unit details</summary>
            <div className="grid min-w-0 gap-4 px-2 pb-4 wrap-anywhere">
              <PacketScopes contents={contents} />
              {blockers.length > 0 && (
                <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2" aria-label={unit.serial + " blockers"}>
                  {blockers.map((blocker) => (
                    <li key={blocker.reason + blocker.connection.href}>
                      <p className="text-sm">{blocker.reason}</p>
                      <span className="block mt-0.5 text-xs text-muted-foreground">
                        {blocker.owner
                          ? "Owner · " +
                            (actors.find((person) => person.id === blocker.owner)?.name ??
                              blocker.owner)
                          : blocker.nextOwner
                            ? "Next decision · " + blocker.nextOwner
                            : "Owner · Unavailable"}
                      </span>
                      <ConnectionLink connection={blocker.connection} sourceId={id} />
                    </li>
                  ))}
                </ul>
              )}
              {!blockers.length && (
                <Dialog.Trigger payload={{ contents }} render={<Button size="sm" className="justify-self-start" variant={signed ? "outline" : "default"} />}>
                  {signed ? "Sign a new version" : "Sign delivery packet"}
                </Dialog.Trigger>
              )}
              {versions.map((packet) => {
                const signer =
                  users.find((u) => u.id === packet.signedBy)?.name ?? packet.signedBy;
                return (
                  <details
                    key={packet.id}
                    id={"packet-" + packet.id}
                    tabIndex={-1}
                    className="scroll-mt-[calc(var(--header)+12px)] mt-2"
                  >
                    <summary className="cursor-pointer">
                      Delivery packet v{packet.version} · {formatUtcDateTime(packet.signedAt)}
                    </summary>
                    <div className="grid gap-2.5 pt-2 wrap-anywhere">
                      <p>
                        Signed by {signer} · {packet.contents.serial} · {packet.contents.revision}
                      </p>
                      <PacketScopes contents={packet.contents} packetId={packet.id} />
                      {packet.receipt ? (
                        <div className="grid gap-1">
                          <strong>Customer response · {packet.receipt.outcome}</strong>
                          <span>{packet.receipt.receivedFrom} · {packet.receipt.reference}</span>
                          <span className="block mt-0.5 text-xs text-muted-foreground">
                            Recorded by {actors.find(actor => actor.id === packet.receipt?.recordedBy)?.name ?? packet.receipt.recordedBy} · {formatUtcDateTime(packet.receipt.recordedAt)}
                          </span>
                        </div>
                      ) : (
                        <div className="grid justify-items-start gap-1">
                          <span className="block mt-0.5 text-xs text-muted-foreground">Customer response pending</span>
                          <Dialog.Trigger payload={packet} render={<Button variant="outline" size="sm" />}>
                            Record customer response
                          </Dialog.Trigger>
                        </div>
                      )}
                      <ConnectionList sourceId={"packet-" + packet.id} title="Packet basis" links={[
                        ...packet.contents.builds.map(build => recordConnection("production", build.id, packet.contents, {
                          label: recordLabel("build", build.reference, build.title),
                          view: "Builds", identity: build.title,
                        })),
                        ...packet.contents.inspections.map(inspection => recordConnection("verification", inspection.evidenceId, packet.contents, {
                          label: "Inspection · " + formatUtcDateTime(inspection.capturedAt),
                          view: "Acceptance Review", identity: inspection.source,
                          detail: `Approved · ${inspection.reviewer} · ${formatUtcDateTime(inspection.decidedAt)}`,
                        })),
                      ]} />
                      <a
                        className={recordLink}
                        download={`packet-${unit.serial}-v${packet.version}.json`}
                        href={
                          "data:application/json;charset=utf-8," +
                          encodeURIComponent(
                            JSON.stringify(
                              {
                                version: packet.version,
                                signedAt: packet.signedAt,
                                signer,
                                ...packet.contents,
                              },
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        Download packet
                      </a>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        </td>
      </tr>
    </tbody>
  );
}

function PacketScopes({ contents, packetId }: { contents: PacketContents; packetId?: string }) {
  if (packetId && !contents.scopes?.length)
    return <p className="mt-0.5 text-xs text-muted-foreground">Agreed scope edition unavailable for this version</p>;
  return contents.scopes?.map(scope => (
    <p key={scope.caseId} className={packetId ? undefined : "mb-2"}>
      {packetId ? "Packet scope" : "Agreed scope"}{" "}
      <ConnectionLink connection={agreementConnection(scope, [unitSelection(contents.serial, contents.revisionId)])} sourceId={packetId ? "packet-" + packetId : `unit-${contents.serial}-${contents.revisionId}`} />
      {packetId && <span className="block mt-0.5 text-xs text-muted-foreground">{scope.acknowledgement}</span>}
    </p>
  ));
}

function PacketForms({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  const actions = useRef<Dialog.Root.Actions>(null);
  return <Dialog.Root<{ contents: PacketContents } | Workspace["packets"][number]> actionsRef={actions}>
    {({ payload }) => {
      const contents = payload?.contents;
      const packet = payload && "id" in payload ? payload : undefined;
      return <>
        {children}
        {contents && <FormDialog
          heading={packet ? "Record customer response" : "Sign delivery packet"}
          description={`${contents.serial} · ${contents.revision}` + (packet ? ` · delivery packet v${packet.version}` : "")}
          submit={packet ? "Save" : "Sign and generate"}
          onSubmit={async fields => {
            if (!packet && !fields.get("signer")) return "Choose a signer.";
            const { error } = await saveWorkspace({
              ...Object.fromEntries(fields), serial: contents.serial, revisionId: contents.revisionId,
              ...(packet ? { operation: "record-packet-response", packetId: packet.id, version: packet.version } : {
                operation: "sign-packet", basis: packetBasis(contents),
              }),
            });
            return error || (() => actions.current?.close());
          }}
        >
          {packet ? <>
            <LabeledSelect name="outcome" label="Customer response" required placeholder="Choose a response"
              options={[{ value: "Accepted", label: "Accepted" }, { value: "Returned", label: "Returned" }]} />
            <label className="grid gap-1">Received from<Input name="receivedFrom" required maxLength={120} /></label>
            <label className="grid gap-1">Receipt reference<Input name="reference" required maxLength={200} /></label>
            <PersonField name="recordedBy" label="Recorded by" placeholder="Choose recorded by" required people={workspace.actors} />
          </> : <>
            <p>{contents.builds.length} build records · {contents.inspections.length} approved inspections</p>
            <PersonField name="signer" label="Signer" placeholder="Choose signer" people={workspace.users} />
          </>}
        </FormDialog>}
      </>;
    }}
  </Dialog.Root>;
}
