"use client";

import { useFindingDraft } from "@/components/records/use-record-submission";
import { editionUrl, useOpenRecord } from "@/components/records/watch-open-record";
import { useSearchParams } from "next/navigation";
import { recordConnection, recordHref } from "@/lib/records/links";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArchiveDialog } from "@/components/records/archive-dialog";
import { PersonField, LabeledSelect, NoteField } from "@/components/records/forms";
import { ConnectionLink } from "@/components/records/links";
import { unitSelection } from "@/components/workspace/selection";
import type { RecordUnit } from "@/lib/records/journal";
import { formatUtcDateTime } from "@/lib/utc-time";
import { useAssembly } from "@/lib/workspace";
import { comparisonFields } from "@/components/engineering/document-differences";
import { EditionComparison } from "@/components/engineering/document-sheets";
import type { DesignEdition, DesignFinding, DesignReviewData } from "@/db/engineering/design";

const endpoint = "/api/design-review";

function reviewedEditions(finding: DesignFinding) {
  return {
    href: recordHref("engineering", encodeURIComponent(finding.recordId), finding, { documentFinding: finding.id }),
    label: `Reviewed editions · ${finding.serial}`, location: "Engineering · Design",
    identity: `${finding.priorId} → ${finding.currentId} · ${finding.basis.label}`,
  };
}

function FindingSummary({ finding, destination }: {
  finding: DesignFinding; destination: "design" | "target";
}) {
  return (
    <div className="grid gap-1 py-2 text-sm">
      <strong>{finding.basis.label}</strong>
      <p className="whitespace-pre-line wrap-anywhere">{finding.observation}</p>
      <p className="text-xs text-muted-foreground">{finding.actorName} · {formatUtcDateTime(finding.createdAt)} · {finding.serial}</p>
      <ConnectionLink className="w-fit"
        sourceId={destination === "target" ? finding.recordId : finding.targetId}
        returnParams={destination === "target" ? { documentFinding: finding.id } : undefined}
        connection={destination === "design" ? reviewedEditions(finding)
          : recordConnection(finding.basis.target.section, encodeURIComponent(finding.targetId), finding, {
            view: finding.basis.target.section === "production" ? "Issues" : "Changes",
            label: `Filed finding · ${finding.serial}`, identity: finding.basis.target.title,
          })} />
    </div>
  );
}

function FindingsList({ findings, destination }: { findings: DesignFinding[]; destination: "design" | "target" }) {
  if (!findings.length) return null;
  const onDesign = destination === "target";
  const heading = onDesign ? "Recorded findings" : "Document findings";
  return <section aria-label={heading} className={onDesign ? "border-t pt-3" : undefined}>
    <h3 className={onDesign ? "font-semibold" : "text-sm font-semibold"}>{heading}</h3>
    <ul className="divide-y">{findings.map(f => <li key={f.id} className={onDesign ? "py-1" : undefined}>
      <FindingSummary finding={f} destination={destination} />
      {onDesign && <ConnectionLink sourceId={f.recordId} connection={reviewedEditions(f)} />}
    </li>)}</ul>
  </section>;
}

function CompareEditions({ earlier, later, findings, onSaved }: {
  earlier: DesignEdition; later: DesignEdition; findings: DesignFinding[]; onSaved: () => void;
}) {
  const { actors } = useAssembly();
  const [fieldKey, setField] = useState("");
  const [targetId, setTarget] = useState("");
  const fields = comparisonFields(earlier, later);
  const target = fieldKey && later.targets.some(record => record.id === targetId) ? {
    recordId: later.recordId, serial: later.serial, revisionId: later.revisionId,
    priorId: earlier.id, currentId: later.id, fieldKey, targetId,
  } : undefined;
  const draft = useFindingDraft(endpoint, target, onSaved, "Finding recorded.");
  return (
    <>
      <EditionComparison earlier={earlier} later={later} fields={fields} fieldKey={fieldKey} choose={setField} />
      {later.targets.length > 0 && (
        <form className="grid gap-3 border-t pt-4" onSubmit={draft.save}>
          <h3 className="font-semibold">Record a finding</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledSelect label="Document field" placeholder="Choose a field" value={fieldKey || null} onChange={v => setField(v ?? "")}
              options={fields.map(({ key, label }) => ({ value: key, label }))} />
            <LabeledSelect label="Route to" placeholder="Choose an issue or change" value={targetId || null} onChange={v => setTarget(v ?? "")}
              options={later.targets.map(t => ({ value: t.id, label: t.title }))} />
          </div>
          <NoteField label="Observation or requested correction" rows={2} {...draft.observation} />
          <PersonField people={actors} {...draft.person} />
          <Button type="submit" className="w-fit" disabled={draft.disabled}>Save finding</Button>
          {draft.feedback && <p role="status" className="text-sm">{draft.feedback}</p>}
        </form>
      )}
      <FindingsList findings={findings} destination="target" />
    </>
  );
}

function ReviewedComparison({ finding, editions }: { finding: DesignFinding; editions: DesignEdition[] }) {
  const earlier = editions.find(edition => edition.id === finding.priorId);
  const later = editions.find(edition => edition.id === finding.currentId);
  if (!earlier || !later) return <p>Unavailable</p>;
  return <>
    <EditionComparison earlier={earlier} later={later} fields={comparisonFields(earlier, later)} fieldKey={finding.fieldKey} />
    <section aria-label="Recorded finding"><FindingSummary finding={finding} destination="target" /></section>
  </>;
}

const editionKey = ({ serial, revisionId }: Pick<RecordUnit, "serial" | "revisionId">) => unitSelection(serial, revisionId);

export function DocumentReview({ recordId, title, members, mode, linked }: {
  linked: boolean;
  recordId: string; title: string; members: readonly RecordUnit[]; mode: "design" | "target";
}) {
  const params = useSearchParams();
  const requested = params.get("documentFinding");
  const url = editionUrl(endpoint, { [mode === "design" ? "recordId" : "targetId"]: recordId }, members);
  const { data, failed, watch, reload } = useOpenRecord<DesignReviewData>(url);
  const units = new Map(members.map(member => [editionKey(member), member]));
  const inScope = (entry: Pick<RecordUnit, "serial" | "revisionId">) => units.has(editionKey(entry));
  const findings = data?.findings.filter(inScope) ?? [];
  const editionsByUnit = Map.groupBy(data?.editions.filter(inScope) ?? [], editionKey);
  const historyByUnit = Map.groupBy(findings, editionKey);
  return (
    <div ref={watch} className="grid min-w-0 gap-2 empty:hidden">
      {failed && <p role="alert" className="text-sm">Unable to load document review. <Button size="sm" variant="outline" onClick={reload}>Retry</Button></p>}
      {linked && mode === "design" && requested && data && !findings.some(f => f.id === requested) && (
        <p role="status" className="text-sm">Reviewed comparison unavailable for this selection.</p>
      )}
      {mode === "target" && <FindingsList findings={findings} destination="design" />}
      {[...editionsByUnit].map(([key, editions]) => {
        if (editions.length < 2) return null;
        const unit = units.get(key)!;
        const history = historyByUnit.get(key) ?? [];
        const anchored = history.find(f => f.id === requested);
        return (
          <ArchiveDialog key={key} id={`compare-${recordId}-${key}`}
            label={"Compare document editions" + (editionsByUnit.size > 1 ? " · " + unit.serial : "")}
            title={anchored ? "Reviewed document comparison" : "Compare document editions"}
            description={`${title} · ${unit.serial} · ${unit.revision}`} pinned={Boolean(anchored)}
            clearOnClose={anchored ? ["documentFinding"] : undefined} onOpen={reload}>
              {anchored ? <ReviewedComparison finding={anchored} editions={editions} /> :
                <CompareEditions key={editions.at(-1)!.id} earlier={editions[editions.length - 2]}
                  later={editions[editions.length - 1]} findings={history} onSaved={reload} />}
          </ArchiveDialog>
        );
      })}
    </div>
  );
}
