"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { withSelections } from "@/lib/workspace-routes";
import { InternalLink } from "@/components/records/links";
import { watchRecordFocus } from "@/components/workspace/navigation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { itemChipLabel, unitSelection } from "@/components/workspace/selection";
import { formatUtcDateTime } from "@/lib/utc-time";
import { filedSource, studyArchives, interfaceCompareHref, sourceFingerprint, type StudyDraft, type StudyHistory, type StudyId, type StudyScope } from "@/lib/archives/study";
import type { saveOperationsStudy } from "@/db/operations/study";

// The route renders scope, receipts and history on the server. Mount interactive instruments
// when their code is ready so the first edit cannot land on unhydrated controls.
function OpeningStudy() {
  return <p role="status" className="text-sm text-muted-foreground">Opening study…</p>;
}
const views = {
  aurora: dynamic(() => import("@/components/operations/aurora/recording"), { ssr: false, loading: OpeningStudy }),
  docking: dynamic(() => import("@/components/operations/docking/view"), { ssr: false, loading: OpeningStudy }),
};

type Request = Parameters<typeof saveOperationsStudy>[2];

function visibleEntries(history: StudyHistory, study: StudyId, params: URLSearchParams) {
  const archive = studyArchives[study];
  // Archive indexes retain earlier editions. Inside a comparison, keep the history tied to the inputs on screen.
  return history.entries.filter(entry => {
    if (history.selected) return entry.subject === history.selected.subject && entry.edition === history.selected.edition;
    if (study === "aurora" && params.has("pair"))
      return entry.edition === archive.edition && studyArchives.aurora.resolveSubject(entry.subject)?.pair.id === params.get("pair");
    if (study === "docking" && params.has("feature")) {
      const source = studyArchives.docking.sourceFor(entry.subject);
      return source?.edition === entry.edition && source.feature.id === params.get("feature");
    }
    return true;
  });
}

function currentSourceQuery(study: StudyId, selected: StudyHistory["selected"]): Record<string, string> {
  if (!selected?.source.scope) return {};
  const { subject, first, last } = selected;
  if (study === "docking") {
    const source = studyArchives.docking.sourceFor(subject);
    return source ? { feature: source.feature.id } : {};
  }
  const { resolveSubject, debriefQuery } = studyArchives.aurora;
  const archive = resolveSubject(subject);

  return archive ? { ...debriefQuery(archive.pair, archive.event), first: String(first), last: String(last) } : {};
}

function receiptHref(study: StudyId, selected: StudyHistory["selected"], selections: StudyHistory["selections"],
  id?: string, filing?: StudyScope | null) {
  const origin = filing ?? selected?.source.scope;
  const query = new URLSearchParams(id ? { finding: id } : currentSourceQuery(study, selected));
  if (study === "aurora") query.set("view", "recordings");
  const context = selections.length || !origin ? selections : [origin.selection];
  const exact = context.map(item => origin?.serial && item === unitSelection(origin.serial)
    ? unitSelection(origin.serial, origin.revisionId) : item);
  const path = study === "docking" ? interfaceCompareHref(query) : "/operations/aurora" + (query.size ? "?" + query : "");
  return withSelections(path + (id ? "#recorded-finding" : ""), exact);
}

function recordedFrames(study: StudyId, first: number, last: number) {
  if (study === "docking") return "";
  return first === last ? ` · returned frame ${first}` : ` · returned frames ${first}–${last}`;
}

function StudyReceipt({ selected, study, returnTo, catalog }: {
  selected: NonNullable<StudyHistory["selected"]>; study: StudyId; returnTo: string; catalog: StudyHistory["catalog"];
}) {
  const scope = selected.source.scope;
  const targetLabel = scope && itemChipLabel(catalog, scope.selection);
  return <section id="recorded-finding" tabIndex={-1} aria-labelledby="recorded-finding-title"
      className="mb-5 scroll-mt-20 rounded-md border-s-2 border-primary bg-muted/50 p-3 focus-visible:outline-2 focus-visible:outline-ring">
      <h2 id="recorded-finding-title" className="font-semibold">
        {selected.outcome}{recordedFrames(study, selected.first, selected.last)}
      </h2>
      <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm">{selected.note}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {selected.source.label} · {selected.edition}
        {" · "}{formatUtcDateTime(selected.recordedAt)}
      </p>
      {scope && <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
        Filed against {targetLabel || scope.selection} · {scope.serial || "Design revision"} · {scope.revisionId}
      </p>}
      <Link href={returnTo} scroll={false} className="mt-2 inline-block text-sm font-medium text-primary hover:underline">Return to current study</Link>
  </section>;
}

function SavedWork({ entries, active, study, href }: {
  entries: StudyHistory["entries"]; active?: string; study: StudyId; href: (entry: StudyHistory["entries"][number]) => string;
}) {
  if (!entries.length) return null;
  return <details className="mt-6 border-t pt-3" aria-label="Saved studies">
      <summary className="w-fit cursor-pointer rounded-sm py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        Saved work ({entries.length})
      </summary>
      <ol className="divide-y">
        {entries.map(entry => <li key={entry.id} className="py-2">
          <Link href={href(entry)} scroll={false} aria-current={entry.id === active ? "page" : undefined}
            className="block rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            <span className="font-medium text-primary">{entry.label}</span>{" "}
            <span className="ml-2 text-xs text-muted-foreground">{entry.outcome}
              {recordedFrames(study, entry.first, entry.last)}
              {" · "}{formatUtcDateTime(entry.recordedAt)}</span>
            <span className="block line-clamp-2 text-sm">{entry.note}</span>
          </Link>
        </li>)}
      </ol>
    </details>;
}

type StudyProps = {
  study: StudyId;
  record: (request: Request) => Promise<{ id: string } | { error: string }>;
};

export function StudyWorkspace({ study, history, record }: StudyProps & { history: StudyHistory }) {
  const router = useRouter();
  const params = useSearchParams();
  const { selections, targets, selected } = history;
  const archives = selections.length ? targets : history.availableArchives;
  type Target = StudyHistory["targets"][number];
  const [choice, setChoice] = useState<{ targets: Target[]; resolve: (target?: Target) => void } | null>(null);
  function finishChoice(target?: Target) {
    choice?.resolve(target);
    setChoice(null);
  }
  const retry = useRef<{ key: string; id: string } | null>(null);
  const View = views[study];
  useEffect(() => watchRecordFocus(/^recorded-finding$/), [selected?.id]);

  const location = (id?: string, filing?: StudyScope | null) =>
    receiptHref(study, selected, selections, id, filing);

  const entries = visibleEntries(history, study, params);
  async function save(draft: StudyDraft) {
    const filed = filedSource(study, draft.subject);
    if (!filed) return "Select a filed source before saving.";
    const eligible = targets.filter(target => target.subjects.includes(draft.subject));
    if (!eligible.length) return "This source is unavailable for the selected items.";
    const target = eligible.length === 1 && selections.length === 1 ? eligible[0] :
      await new Promise<Target | undefined>(resolve => setChoice({ targets: eligible, resolve }));
    if (!target) return "Choose a target to save this finding.";
    const { scope } = target;
    const key = JSON.stringify([draft, scope]);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    try {
      const result = await record({ id: retry.current.id, edition: filed.edition, stamp: await sourceFingerprint(filed.source), draft, target: scope });
      if ("error" in result) return result.error;
      retry.current = null;
      router.push(location(result.id, scope), { scroll: false });
      return undefined;
    } catch {
      return "Could not confirm the save. Retry the same finding to check its receipt.";
    }
  }
  return <>
    {selected && <StudyReceipt selected={selected} study={study} returnTo={location()} catalog={history.catalog} />}
    {history.unavailable ? <>
        <p role="status">The requested finding is unavailable in this study.</p>
        <InternalLink className="mt-4 inline-flex text-sm" href={location()} scroll={false}>Return to current study</InternalLink>
      </> : <>
        <View key={selected?.id ?? JSON.stringify([study, ...selections.toSorted()])}
          scopeSelected={selections.length > 0} subjects={[...new Set(archives.flatMap(archive => archive.subjects))]}
          availableArchives={history.availableArchives}
          selected={selected} save={save} />
        {study === "aurora" && !selected && selections.length > 0 && !targets.length && (
          <InternalLink className="mt-2 inline-flex text-sm" href="/operations/aurora?view=recordings" scroll={false}>Browse other archives</InternalLink>
        )}
      </>}
    <Dialog open={Boolean(choice)} onOpenChange={open => { if (!open) finishChoice(); }}>
      <DialogContent>
        <DialogTitle>Choose a finding target</DialogTitle>
        <DialogDescription>Choose where to file this observation. The reviewed source and revision are preserved.</DialogDescription>
        <div className="grid gap-1">
          {choice?.targets.map(target => <Button variant="ghost" className="h-auto justify-start whitespace-normal py-2 text-left"
            key={target.scope.selection + "/" + target.scope.serial + "/" + target.scope.revisionId} onClick={() => finishChoice(target)}>
            {target.label}{target.label !== target.scope.serial && ` · ${target.scope.serial || target.scope.revisionId}`}
          </Button>)}
        </div>
      </DialogContent>
    </Dialog>
    <SavedWork entries={entries} active={selected?.id} study={study} href={entry => location(entry.id, entry.scope)} />
  </>;
}
