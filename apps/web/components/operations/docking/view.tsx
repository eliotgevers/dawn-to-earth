"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, ExternalLink, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CompareFields } from "@/components/records/compare-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionList, InternalLink } from "@/components/records/links";
import { recordConnection, recordHref } from "@/lib/records/links";
import { interfaceCompareHref, type OperationsStudyProps, type StudyDraft } from "@/lib/archives/study";
import { selectInterface, interfaceFor, isDockingSource, reviewOutcomes, source, subjectFor, type Feature, type InterfaceRecord } from "@/lib/archives/docking";

const focusStyle = "rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

export default function InterfaceReview({ subjects, scopeSelected, selected, save }: OperationsStudyProps) {
  const params = useSearchParams();
  if (selected) {
    if (!isDockingSource(selected.source)) return <p>The original source snapshot for this review is unavailable.</p>;
    const snapshot = selected.source;
    return <div className="grid gap-3">
      <h2 className="text-xl font-semibold">{snapshot.feature.name}</h2>
      <p>{snapshot.feature.question}</p>
      <InspectionSheets feature={snapshot.feature} editions={[snapshot.referenceRevision, snapshot.proposedRevision]}/>
      <p className="text-sm">{snapshot.feature.basis}</p>
      <InspectionSources feature={snapshot.feature} editions={[snapshot.referenceRevision, snapshot.proposedRevision]} />
    </div>;
  }

  const { record, feature, points } = selectInterface(subjects, params);
  if (!record || !feature || !points) return <p>This inspection point is unavailable in this selection.</p>;
  function destination(point: Feature) {
    const owner = interfaceFor(point.id)!;
    const query = new URLSearchParams(params);
    query.delete("finding");
    query.set("feature", point.id);
    query.set("rev", owner.editions[1]);
    if (!scopeSelected) query.set("item", "project:" + owner.filing.projectId);
    return interfaceCompareHref(query, owner.key);
  }
  const [first, second] = record.editions;
  const rev = params.get("rev");
  const focused = rev === first ? 0 : 1;
  if (rev && !record.editions.includes(rev)) return <div className="flex flex-wrap gap-2 text-sm">
    <p>This drawing revision is unavailable.</p><InternalLink href={destination(feature)}>Open {second}</InternalLink>
  </div>;
  return <section className="@container min-w-0" aria-label="Interface evidence comparison">
    {points.length > 1 && <nav aria-label="Inspection points" className="mb-3 flex flex-wrap gap-1">
      {points.map(point => <Link key={point.id} href={destination(point)} scroll={false}
        aria-current={point.id === feature.id ? "page" : undefined}
        className={focusStyle + " px-2 py-1.5 text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-medium"}>
        {point.name}
      </Link>)}
    </nav>}
    <InterfaceContent record={record} feature={feature} entry={scopeSelected ? undefined : destination(feature)}
      focus={scopeSelected ? focused : undefined} save={save}/>
  </section>;
}

function InterfaceContent({ record, feature, entry, focus, save }: Pick<OperationsStudyProps, "save"> & {
  record: InterfaceRecord; feature: Feature; entry?: string; focus?: number;
}) {
  const [showSheets, setShowSheets] = useState(false);
  const unit = record.filing.serial ? { serial: record.filing.serial, revisionId: record.filing.revisionId } : undefined;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="max-w-prose font-semibold">{feature.question}</h3>
        {entry ? <InternalLink href={entry} className="w-fit">Review {feature.name.toLowerCase()}</InternalLink>
          : <ReviewAction subject={subjectFor(record, feature.id)} feature={feature} save={save} inspect={() => setShowSheets(true)}/>}
      </div>
      <CurrentArtifacts feature={feature} record={record} focus={focus} showSheets={showSheets} setShowSheets={setShowSheets}/>
      <p className="my-3 max-w-prose text-sm leading-relaxed">{feature.basis}</p>
      <InspectionSources feature={feature} editions={record.editions}>
        <p>{record.connection} · {unit?.serial ?? record.filing.revisionId} · {feature.coverage}</p>
        {!entry && record.records && unit && <ConnectionList title="Inspection records" links={[
          recordConnection("engineering", record.records.requirement, unit, { label: "Requirement " + record.records.reference, view: "Requirements" }),
          { href: recordHref("verification", record.records.evidence, unit, { view: record.records.method }),
            label: `Inspection · ${record.editions.join(" / ")}`, location: "Verification", identity: record.records.evidence },
        ]} /> }
        {!entry && record.programContext && <a href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
          <ExternalLink aria-hidden="true" className="size-3.5"/>Dawn’s DFT-Passive qualification announcement<span className="sr-only"> (opens in a new tab)</span></a>}
      </InspectionSources>
    </div>
  );
}

function InspectionSources({ feature, editions, children }: {
  feature: Feature; editions: readonly [string, string]; children?: ReactNode;
}) {
  if (!children && !feature.origin && !feature.reference.entries && !feature.proposed?.entries) return null;
  return <details className="border-t pt-3 text-sm">
    <summary className="w-fit cursor-pointer">Sources and context</summary>
    <div className="mt-3 grid gap-3 text-muted-foreground">
      {feature.origin && <p>{feature.origin}</p>}
      {[feature.reference, feature.proposed].map((sheet, i) => sheet?.entries && <div key={editions[i]}>
        <p className="text-foreground">{sheet.sheet} · {sheet.description}</p>
        <ul>{sheet.entries.map(row => <li key={row.sourceId}>{row.label} · <code className="wrap-anywhere">{row.sourceId}</code></li>)}</ul>
      </div>)}
      {children}
    </div>
  </details>;
}

function CurrentArtifacts({ feature, record, focus, showSheets, setShowSheets }: {
  feature: Feature; record: InterfaceRecord; focus?: number; showSheets: boolean; setShowSheets: (value: boolean) => void;
}) {
  if (!record.fixtureViews) return <InspectionSheets feature={feature} editions={record.editions} focus={focus}/>;
  return <>
    <div role="group" aria-label="Artifact view" className="mb-3 inline-flex gap-0.5 rounded-md bg-muted p-0.5">
      {["Fixture views", "Inspection sheets"].map(label => <button key={label} type="button"
        aria-pressed={showSheets === (label === "Inspection sheets")} onClick={() => setShowSheets(label === "Inspection sheets")}
        className={focusStyle + " min-h-8 px-2.5 text-xs font-medium aria-pressed:bg-background aria-pressed:shadow-sm"}>
        {label}
      </button>)}
    </div>
    {showSheets ? <InspectionSheets feature={feature} editions={record.editions} focus={focus}/> :
      <div className="grid min-w-0 gap-2 @xl:grid-cols-2 @xl:gap-4">
        {record.fixtureViews.map(({ image, caption }) => <figure key={image} className="min-w-0">
          <Image src={image} alt={caption + " on the tabletop tray stand"} width={1100} height={734} unoptimized loading="eager"
            className="h-auto w-full rounded-sm"/>
          <figcaption className="mt-1.5 text-sm font-medium">{caption}</figcaption>
        </figure>)}
        <p className="col-span-full text-xs text-muted-foreground">Fixture reconstructions. The inspection sheets contain the recorded observations.</p>
      </div>}
  </>;
}

function InspectionSheets({ feature, editions, focus }: {
  feature: Feature; editions: readonly [string, string]; focus?: number;
}) {
  const [overlap, setOverlap] = useState(false);
  const [reveal, setReveal] = useState(50);
  const reference = feature.reference.artwork;
  const proposed = feature.proposed?.artwork;
  const registered = feature.registration && reference && proposed;
  const before = new Map(feature.reference.entries?.map(row => [row.label, row]));
  const after = new Map(feature.proposed?.entries?.map(row => [row.label, row]));
  const fields = [...new Set([...before.keys(), ...after.keys()])].map(field => ({
    id: field, label: field, before: before.get(field)?.value, after: after.get(field)?.value,
  }));
  const comparison = fields.length > 0 && <CompareFields referenceLabel={"Reference · " + editions[0]}
    proposedLabel={"Proposed · " + editions[1]} fields={fields} />;
  if (comparison && !reference && !proposed) return comparison;
  return <div className="min-w-0" aria-label="Filed inspection sheets">
    {registered && <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <button type="button" onClick={() => setOverlap(!overlap)} aria-pressed={overlap}
        className={focusStyle + " min-h-8 text-sm font-medium text-primary underline-offset-4 hover:underline"}>
        {overlap ? "Show separate sheets" : "Overlay sheets"}
      </button>
    </div>}
    {registered && overlap && <div className="mb-3 max-w-3xl">
      <div className="relative isolate overflow-hidden rounded-sm border focus-within:ring-2 focus-within:ring-ring" role="group"
        aria-label={`Reference ${editions[0]} left, proposed ${editions[1]} right. ${feature.registration}`}>
        <Image src={proposed} alt="" unoptimized width={480} height={202} className="block h-auto w-full"/>
        <Image src={reference} alt="" unoptimized fill sizes="(max-width: 640px) 100vw, 768px" className="object-fill" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}/>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l-2 border-primary shadow-[1px_0_var(--background)]" style={{ left: reveal + "%" }}/>
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background text-foreground shadow-sm" style={{ left: reveal + "%" }}>
          <ArrowLeftRight className="size-3.5"/>
        </span>
        <input type="range" min={0} max={100} value={reveal} onChange={event => setReveal(Number(event.target.value))}
          aria-label="Reference sheet reveal" aria-valuetext={`${reveal}% reference, ${100 - reveal}% proposed`}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"/>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{feature.registration}</p>
    </div>}
    <div className="grid min-w-0 gap-4 @xl:grid-cols-2">
    {editions.map((edition, index) => {
      const sheet = index === 0 ? feature.reference : feature.proposed;
      return <figure key={edition} className="min-w-0">
        <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className={"font-semibold " + (index === focus ? "text-foreground" : "text-muted-foreground")}>{index === 0 ? "Reference" : "Proposed"} · {edition}</span>
          {sheet && sheet.sheet !== edition && <span className="font-mono text-muted-foreground">{sheet.sheet}</span>}
        </figcaption>
        {registered && overlap && sheet?.artwork ? <a href={sheet.artwork} target="_blank" rel="noreferrer"
          className={focusStyle + " inline-flex items-center gap-1 text-xs text-primary hover:underline"}>
          <ExternalLink aria-hidden="true" className="size-3"/>Open {sheet.sheet}<span className="sr-only"> in a new tab</span>
        </a> : sheet?.artwork ? <a href={sheet.artwork} target="_blank" rel="noreferrer"
          aria-label={`Open inspection sheet ${sheet.sheet} in a new tab`}
          className={focusStyle + " group relative block overflow-hidden border border-border/70"}>
          <Image src={sheet.artwork} width={480} height={230} unoptimized loading="eager" alt={sheet.description} className="block h-auto w-full"/>
          <ExternalLink className="absolute end-1.5 top-1.5 size-5 rounded-sm bg-background p-1 text-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"/>
        </a> : sheet?.entries ? null : <div className="flex min-h-24 items-center justify-center gap-2 border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <FileSearch className="size-4 shrink-0" aria-hidden="true"/>{sheet ? "Text observation only" : "No inspection sheet filed"}
        </div>}
        <p className="mt-2 text-sm leading-relaxed">{sheet?.description ?? "An observation from this revision is needed to judge the feature."}</p>
      </figure>;
    })}
    </div>
    {comparison}
  </div>;
}

function ReviewAction({ subject, feature, save, inspect }: Pick<OperationsStudyProps, "save"> & {
  subject: string; feature: Feature; inspect: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Pick<StudyDraft, "outcome" | "note">>>({});
  const [error, setError] = useState("");
  const missing = !feature.proposed;
  const fields = drafts[feature.id] ?? { outcome: missing ? "Request evidence" : "", note: "" };
  const draft: StudyDraft = { first: 1, last: 1, subject, ...fields };
  const choices = reviewOutcomes(feature);
  const ready = choices.some(choice => choice === fields.outcome) && Boolean(fields.note.trim()) && fields.note.length <= 2000;
  function edit(patch: Partial<typeof fields>) {
    setDrafts(existing => ({ ...existing, [feature.id]: { ...fields, ...patch } }));
    setError("");
  }
  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    const failure = await save(draft).catch(() => "Could not confirm the save. Your draft is still here.");
    setSaving(false);
    if (failure) setError(failure);
    else setOpen(false);
  }
  return <Dialog open={open} onOpenChange={value => {
    if (saving) return;
    if (value) inspect();
    setError("");
    setOpen(value);
  }}>
    <DialogTrigger render={<Button size="sm"/>}>{missing ? "Request evidence" : "Review evidence"}</DialogTrigger>
    <DialogContent>
      <DialogTitle>{feature.name}</DialogTitle>
      <DialogDescription>{feature.question}</DialogDescription>
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={saving} className="grid gap-2">
          <label className="grid gap-1">Decision
            <select required value={fields.outcome} className="h-9 rounded-md border border-input bg-background px-2"
              onChange={event => edit({ outcome: event.target.value })}>
              <option value="">Choose a decision</option>
              {choices.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="grid gap-1">{fields.outcome === "Request evidence" ? "Evidence needed" : "Reason"}
            <Textarea required maxLength={2000} rows={3} value={fields.note} onChange={event => edit({ note: event.target.value })}
              placeholder={fields.outcome === "Request evidence" ? feature.request : "Which observation supports this decision?"}/>
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={saving || !ready} className="justify-self-end">
          {saving ? "Saving…" : fields.outcome === "Request evidence" ? "Save evidence request" : "Save judgment"}
        </Button>
      </form>
    </DialogContent>
  </Dialog>;
}
