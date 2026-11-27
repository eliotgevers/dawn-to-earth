import type { ComponentProps } from "react";
import { editionUrl, useOpenRecord } from "@/components/records/watch-open-record";
import { useSearchParams } from "next/navigation";
import { ConnectionList } from "@/components/records/links";
import { modelStudyHref, validationDecisions, type ValidationData, type ValidationStudy } from "@/lib/evidence/validation";
import type { RecordUnit } from "@/lib/records/journal";
import type { RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";

type Props = Pick<ComponentProps<typeof ConnectionList>, "article" | "links"> & { sourceId: string; unit: RecordUnit };

function modelLinks(studies: ValidationData): RecordConnection[] {
  const result: RecordConnection[] = [];
  for (const study of studies) {
    result.push({ href: modelStudyHref(study), label: study.modelEditionId, location: "Engineering · Model validation", identity: study.title });
    for (const judgment of study.judgments) {
      result.push({
        href: modelStudyHref(study, judgment.id), label: `${judgment.basis.condition.label} · ${validationDecisions[judgment.decision]}`,
        location: "Engineering · Model judgment", identity: judgment.id,
        detail: `${judgment.actorName} · ${formatUtcDateTime(judgment.createdAt)}`,
      });
    }
  }
  return result;
}

function sourceRegisters(studies: ValidationData, studyId: string | null, rowId: string | null, judgmentId: string | null) {
  const registers = studies.filter(study => study.evidenceIds.length === 1);
  if (!rowId) return registers;
  const study = registers.find(entry => entry.id === studyId);
  const row = study?.rows.find(entry => entry.id === rowId);
  if (!study || !row) return [];
  if (judgmentId) {
    const judgment = study.judgments.find(entry => entry.id === judgmentId);
    if (!judgment || judgment.basis.sourceDigest !== study.sourceDigest ||
        judgment.basis.condition.id !== row.conditionId || !judgment.basis.selected.some(saved => saved.id === row.id)) return [];
  }
  return [{ ...study, rows: [row] }];
}

function ObservationRegister({ study, pinned }: { study: ValidationStudy; pinned: boolean }) {
  const conditions = new Map(study.conditions.map(c => [c.id, c.label]));
  return (
    <details className="space-y-2" open={pinned || undefined}>
      <summary className="cursor-pointer text-sm font-medium">Archived observations · {study.modelEditionId}</summary>
      <p className="mt-0.5 text-xs text-muted-foreground">{study.quantity} · observed ({study.unit})</p>
      <dl className="divide-y">
        {study.rows.map(row => (
          <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-sm">
            <dt className="min-w-0 wrap-break-word">
              {row.source} <span className="block mt-0.5 text-xs text-muted-foreground">{conditions.get(row.conditionId)}</span>
            </dt>
            <dd className="tabular-nums">{row.observed} {study.unit}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function ValidationEvidence({ sourceId, unit, article, links }: Props) {
  const params = useSearchParams();
  const { data, failed, watch } = useOpenRecord<ValidationData>(
    editionUrl("/api/model-validation", { evidenceId: sourceId }, [unit]),
  );
  const rowId = params.get("validationRow");
  const registers = data && sourceRegisters(data, params.get("modelStudy"), rowId, params.get("validation"));
  const destinations = data ? modelLinks(data) : [];
  return (
    <>
      <div ref={watch} className="grid gap-2">
        {registers?.length ? registers.map(study => (
          <ObservationRegister key={`${study.id}:${rowId ?? ""}`} study={study} pinned={Boolean(rowId)} />
        )) : <p className="mt-0.5 text-xs text-muted-foreground" role="status">{data || failed ? "Unavailable" : "Loading archived observations…"}</p>}
      </div>
      <ConnectionList links={[...links, ...destinations]} article={article} sourceId={sourceId} />
    </>
  );
}
