"use client";

import { downloadJson } from "@/lib/workspace";
import { EmptyRecords } from "@/components/records/empty";
import { useCaseForm } from "@/components/records/case-form";
import { CaseList } from "@/components/records/case-list";
import { ConnectionLink, ConnectionList } from "@/components/records/links";
import { WorkspaceLink } from "@/components/workspace/section-tabs";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonField, LabeledSelect } from "@/components/records/forms";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkCase, WorkEvent } from "@/db/workflows/cases";
import { toolHref } from "@/lib/workspace-routes";
import {
  readBundle,
  filedDestinations,
  matchBundle,
  maxBundleBytes,
  parseBundle,
  receiptsFor,
  requestFor,
  receivedBundle,
  type Manifest,
  type Receipt,
} from "@/db/workflows/exchange";

function FileContents({ file }: { file?: Manifest["files"][number] }) {
  return <>
    {file?.sourceId && <p>Source record · {file.sourceId}</p>}
    {file?.recordedBy && <p>Recorded by {file.recordedBy}</p>}
    {file?.lotId && <p>Recorded lot · {file.lotId}</p>}
    <pre className="whitespace-pre-wrap wrap-anywhere text-sm">{file?.text ?? "Unavailable"}</pre>
  </>;
}

function ReceivedBundle({ event, lotNotices, name }: { event: WorkEvent; lotNotices: ToolProps["workspace"]["lotNotices"]; name: string }) {
  const receipt = event.data as Receipt;
  const manifest = parseBundle(receipt.manifest);
  const linked = lotNotices.filter(
    (notice) => receipt.lotCorrections.some(file => file.lotId === notice.lotId),
  );
  return (
    <article
      id={`receipt-${event.id}`}
      className="min-w-0 wrap-anywhere py-3"
      aria-label={`Receipt ${receipt.bundleId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">
            {receipt.bundleId} · {receipt.receivedFrom}
          </h3>
          <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
            {name} · {formatUtcDateTime(event.at)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadJson(receipt.manifest, receipt.sourceName)}>
          <Download data-icon="inline-start" /> Download received bundle
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-border" aria-label="Received files">
        {receipt.files.map((f) => {
          const original =
            typeof manifest !== "string"
              ? manifest.files.find((entry) => entry.name === f.fileId)
              : undefined;
          return (
            <li key={f.fileId} className="min-w-0 py-2">
              <details id={`receipt-${event.id}--${f.fileId}`}>
                <summary className="cursor-pointer break-words">
                  {f.fileId} · {f.destinationId ? `Filed to ${f.destinationTitle}` : "Held"}
                </summary>
                <div className="grid gap-2.5 pt-2 wrap-anywhere">
                  <p>
                    {f.derivedFrom ? `Derived from ${f.derivedFrom}` : "Original"}
                    {original && ` · ${original.serial} · ${original.revisionId}`}
                  </p>
                  {f.destinationRecord && (
                    <p>
                      Filed to {f.destinationRecord} · {f.matchedBy}
                    </p>
                  )}
                  {f.reason && <p>{f.reason}</p>}
                  <FileContents file={original} />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {receipt.missing.length > 0 && (
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
          Outstanding at receipt · {receipt.missing.map((d) => d.title).join(", ")}
        </p>
      )}
      {linked.length > 0 && <ConnectionList title="Affected lots" links={linked.map(record => ({
        href: toolHref("containment", record.id), location: "Production · Lot trace",
        label: record.lotId, identity: record.title,
      }))} />}
    </article>
  );
}

type Draft = { raw: string; filename: string; manifest: Manifest; key: number };

function FilingPreview({
  draft,
  item,
  filed,
  events,
  users,
  form,
  saved,
}: {
  draft: Draft;
  item: WorkCase;
  filed: ReturnType<typeof filedDestinations>;
  events: WorkEvent[];
  users: ToolProps["workspace"]["actors"];
  form: ReturnType<typeof useCaseForm>;
  saved: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [actor, setActor] = useState("");
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    receiptHeading.current?.focus();
  }, []);
  const duplicate = receivedBundle(draft.manifest, events);
  const heading = <h3 className="text-[13px] font-semibold" ref={receiptHeading} tabIndex={-1}>
    Review bundle · {draft.manifest.id}
  </h3>;
  if (duplicate)
    return (
      <section aria-label="Import preview" className="flex flex-col items-start gap-2">
        {heading}
        <p>
          {duplicate.data.manifest === draft.raw
            ? "This bundle already has a receipt."
            : "This sender used the same ID for different contents. Give a correction its own bundle ID."}
        </p>
        <ConnectionLink connection={{
          href: toolHref("exchange", duplicate.caseId) + "#receipt-" + duplicate.id,
          label: "Receipt " + draft.manifest.id, location: "Verification · Exchange",
        }} />
      </section>
    );

  const preview = matchBundle(item, draft.manifest, choices, filed);
  const { accepted, problem } = preview;
  function fileBundle() {
    form.record({
      action: "import",
      actor,
      data: { raw: draft.raw, sourceName: draft.filename, choices },
    }, saved, `Imported ${draft.manifest.id}. ${accepted} of ${draft.manifest.files.length} files filed.`);
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 wrap-anywhere" aria-label="Import preview">
      <div>
        {heading}
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
          {draft.filename} · {draft.manifest.files.length} files received
        </p>
      </div>
      <ul className="divide-y divide-border" aria-label="Proposed filing destinations">
        {preview.rows.map(({ file, destination, state, reason, options }) => (
          <li key={file.name} className="flex min-w-0 flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={state === "Ready" ? "secondary" : "outline"}>{state}</Badge>
              <strong className="wrap-anywhere">{file.name}</strong>
            </div>
            <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
              {file.derivedFrom ? `Derived from ${file.derivedFrom}` : "Original"} · {file.serial} ·{" "}
              {file.revisionId}
            </p>
            {options.length > 0 ? (
              <LabeledSelect
                label={`Destination for ${file.name}`}
                placeholder="Choose a destination"
                value={Object.hasOwn(choices, file.name) ? choices[file.name] : null}
                disabled={form.pending}
                options={[
                  ...options.map((d) => ({ value: d.id, label: d.title })),
                  { value: "hold", label: "Retain without filing" },
                ]}
                onChange={(id) => {
                  if (id)
                    setChoices((old) => {
                      const next = { ...old, [file.name]: id };
                      if (id === "hold")
                        for (const child of draft.manifest.files) {
                          if (child.derivedFrom === file.name) delete next[child.name];
                        }
                      return next;
                    });
                  form.setError("");
                }}
              />
            ) : (
              <p>{destination ? `Destination · ${destination.title} (${destination.sourceId})` : reason}</p>
            )}
            <details>
              <summary className="cursor-pointer text-sm">Inspect {file.name}</summary>
              <div className="grid gap-2.5 pt-2 wrap-anywhere">
                <FileContents file={file} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {preview.missing.length > 0 && (
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">Outstanding · {preview.missing.map((d) => d.title).join(", ")}</p>
      )}
      <form className="flex flex-wrap items-end gap-3" action={fileBundle}>
        <PersonField
          people={users}
          label="Received by"
          placeholder="Choose a recipient"
          required
          disabled={form.pending}
          value={actor || null}
          onChange={(id) => setActor(id ?? "")}
        />
        <Button type="submit" disabled={form.pending || !actor || !!problem}>
          {form.pending ? "Importing…" : "Import bundle"}
        </Button>
      </form>

      {problem && (
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{problem}</p>
      )}
    </section>
  );
}

function Intake({ item, relatedEvents, workspace, submit, personName }: ToolProps & { item: WorkCase }) {
  const request = requestFor(item);
  const prepared = request.prepared;
  const revision = workspace.catalog.revisions.find((r) => r.id === item.unit?.revisionId);
  const [draft, setDraft] = useState<Draft>();
  const form = useCaseForm(submit);
  const status = useRef<HTMLParagraphElement>(null);
  const pendingRead = useRef(0);
  const history = receiptsFor(item);
  const filed = filedDestinations(history);
  const required = request.destinations.filter((d) => d.required);

  function read(raw: string, filename: string) {
    const parsed = readBundle(item, raw, filename);
    if (typeof parsed === "string") {
      setDraft(undefined);
      form.setError(parsed);
      return;
    }
    setDraft({ raw, filename, manifest: parsed, key: pendingRead.current });
    form.setError("");
  }

  async function readFile(files: FileList | null) {
    const readId = ++pendingRead.current;
    if (form.pending || !files?.length) return;
    setDraft(undefined);
    if (files.length !== 1) {
      form.setError("Upload one bundle at a time.");
      return;
    }
    if (files[0].size > maxBundleBytes) {
      form.setError("This bundle is too large. Choose a file of 24 KB or less.");
      return;
    }
    const file = files[0];
    try {
      const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (readId === pendingRead.current) read(raw, file.name);
    } catch {
      if (readId === pendingRead.current) form.setError("This file could not be read as UTF-8 text.");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header>
        <WorkspaceLink direction="back" href={toolHref("exchange")}>All requests</WorkspaceLink>
        <h2 className="mt-3">{item.title}</h2>
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
          {request.sender} · {item.unit?.serial} · {revision?.version ?? item.unit?.revisionId}
        </p>
      </header>

      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void readFile(e.dataTransfer.files);
        }}
      >
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50">
          <Upload aria-hidden="true" className="size-4" /> Upload bundle
          <input
            type="file"
            className="sr-only"
            disabled={form.pending}
            accept=".json,.txt,application/json,text/plain"
            onChange={(e) => {
              void readFile(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {prepared && <Button
          variant="ghost"
          disabled={form.pending}
          onClick={() => {
            ++pendingRead.current;
            read(prepared, `${item.id}.json`);
          }}
        >
          Open prepared bundle
        </Button>}
        {prepared && <Button variant="link" size="sm" onClick={() => downloadJson(prepared, `${item.id}.json`)}>
          <Download data-icon="inline-start" /> Download example
        </Button>}
      </div>
      {form.message && (
        <p role="status" tabIndex={-1} ref={status}>
          {form.message}
        </p>
      )}

      {draft && (
        <FilingPreview
          key={draft.key}
          draft={draft}
          item={item}
          events={relatedEvents}
          users={workspace.actors}
          filed={filed}
          form={form}
          saved={() => {
            setDraft(undefined);
            window.requestAnimationFrame(() => status.current?.focus());
          }}
        />
      )}
      <section aria-label="Requested documents">
        <h3 className="text-[13px] font-semibold">Requested documents</h3>
        <ul className="divide-y divide-border">
          {required.map((d) => {
            const sources = filed.get(d.id);
            return (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span>{d.title}</span>
                {sources ? (
                  <ul className="flex min-w-0 flex-col gap-1">
                    {sources.map(({ event, file: { fileId } }) => (
                      <li key={`${event.id}:${fileId}`}>
                        <ConnectionLink connection={{
                          href: `#receipt-${event.id}--${encodeURIComponent(fileId)}`,
                          label: sources.length > 1 ? `${fileId} · ${event.data.bundleId}` : fileId,
                        }} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="block mt-0.5 text-xs text-muted-foreground">Awaiting file</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label="Receipt history">
        <h3 className="text-[13px] font-semibold">Receipt history</h3>
        {history.length ? (
          <div className="divide-y divide-border">
            {history.map((e) => (
              <ReceivedBundle
                key={e.id}
                event={e}
                lotNotices={workspace.lotNotices}
                name={personName(e.actor, e.actor)}
              />
            ))}
          </div>
        ) : (
          <EmptyRecords />
        )}
      </section>
    </div>
  );
}

export default function EvidenceExchange(props: ToolProps) {
  const { dossier: selected } = props;
  if (!selected)
    return (
      <section aria-label="Document exchange requests" className="grid gap-2 pt-2 wrap-anywhere">
        <h2>Document requests</h2>
        <CaseList label="Document requests" rows={props.cases.map(record => ({
          status: receiptsFor(record).length ? "Receipt recorded" : "Awaiting receipt",
          record, detail: [requestFor(record).sender, record.unit?.serial].filter(Boolean).join(" · "),
        }))} />
      </section>
    );
  return <Intake {...props} item={selected} />;
}
