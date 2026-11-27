"use client";
import { TableColumns } from "@/components/records/table";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ArchiveDialog } from "@/components/records/archive-dialog";
import { PersonField, LabeledSelect, NoteField } from "@/components/records/forms";
import { ConnectionLink } from "@/components/records/links";
import { useRecordSubmission } from "@/components/records/use-record-submission";
import { editionUrl, useOpenRecord } from "@/components/records/watch-open-record";
import { sameUnit, type RecordUnit } from "@/lib/records/journal";
import { formatUtcDateTime } from "@/lib/utc-time";
import { useAssembly } from "@/lib/workspace";
import {
  assessReadings,
  residualSummary,
  judgmentIssue,
  type ValidationCondition,
  validationDecisions,
  numberLabel,
  type ValidationRow,
  type ValidationData,
  type ValidationStudy,
  type ValidationDecision,
  type ValidationJudgment,
  judgmentMatchesStudy,
  modelStudyHref,
} from "@/lib/evidence/validation";
import { ValidationObservations } from "./validation-observations";

const endpoint = "/api/model-validation";
type Actor = ReturnType<typeof useAssembly>["actors"][number]["id"];
type Draft = {
  rows: string[];
  decision: ValidationDecision | null;
  observation: string;
  actor: Actor | null;
};
const blank: Draft = { rows: [], decision: null, observation: "", actor: null };

function JudgmentForm({
  study,
  condition,
  independent,
  draft,
  edit,
  saved,
}: {
  study: ValidationStudy;
  condition: ValidationCondition;
  independent: ValidationRow[];
  draft: Draft;
  edit: (patch: Partial<Draft>) => void;
  saved: (id: string) => void;
}) {
  const { actors } = useAssembly();
  const { busy, feedback, submit } = useRecordSubmission(endpoint, saved);
  const issue = draft.decision && judgmentIssue(condition, independent, draft.rows, draft.decision);
  const valid = Boolean(draft.decision && !issue && draft.observation.trim() && draft.actor);
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    void submit({
      studyId: study.id,
      recordId: study.recordId,
      serial: study.serial,
      revisionId: study.revisionId,
      modelEditionId: study.modelEditionId,
      sourceDigest: study.sourceDigest,
      conditionId: condition.id,
      rowIds: [...draft.rows].sort(),
      decision: draft.decision,
      observation: draft.observation.trim(),
      actor: draft.actor,
    });
  }
  return (
    <form className="grid gap-3 border-t pt-4" onSubmit={save}>
      <h3 className="text-sm font-semibold">Record a validation judgment</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledSelect
          label="Decision"
          placeholder="Choose a decision"
          value={draft.decision}
          onChange={(decision) => edit({ decision })}
          options={Object.entries(validationDecisions).map(([value, label]) => ({
            value: value as ValidationDecision,
            label,
          }))}
        />
        <PersonField
          value={draft.actor}
          onChange={(actor) => edit({ actor })}
          people={actors}
        />
      </div>
      <NoteField label="Basis and follow-up"
          required
          maxLength={1000}
          rows={2}
          value={draft.observation}
          onChange={(e) => edit({ observation: e.target.value })}
        />
      {issue && <p className="text-xs text-muted-foreground">{issue}</p>}
      <Button type="submit" className="w-fit" disabled={busy || !valid}>
        Save judgment
      </Button>
      {feedback && (
        <p role="status" className="text-sm">
          {feedback}
        </p>
      )}
    </form>
  );
}

function ConditionCoverage({
  study,
  independent,
  condition,
  choose,
}: {
  study: ValidationStudy;
  independent: ValidationRow[];
  condition?: string;
  choose: (id: string) => void;
}) {
  const summary = residualSummary(independent);
  return (
    <section className="grid gap-2" aria-label="Condition coverage">
      <p className="text-sm">
        {summary.count} independent readings · overall mean residual ({study.unit}){" "}
        {numberLabel(summary.mean, true)}
      </p>
      <table className="w-full text-left text-xs">
        <TableColumns
          caption="Independent observations against each condition target"
          labels={["Condition", "Available / target", "Mean residual"]}
          className="text-muted-foreground"
        />
        <tbody>
          {study.conditions.map((c) => {
            const stats = residualSummary(independent.filter((r) => r.conditionId === c.id));
            return (
              <tr key={c.id} className="border-t">
                <th scope="row" className="py-1 text-left">
                  <Button
                    size="sm"
                    variant={condition === c.id ? "secondary" : "ghost"}
                    className="max-w-full whitespace-normal text-left"
                    aria-pressed={condition === c.id}
                    onClick={() => choose(c.id)}
                  >
                    {c.label}
                  </Button>
                </th>
                <td className="py-1 tabular-nums">
                  {stats.count} / {c.requiredOrigins}
                </td>
                <td className="py-1 tabular-nums">{numberLabel(stats.mean, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RecordedJudgment({ study, judgment }: { study: ValidationStudy; judgment: ValidationJudgment }) {
  const {condition, selected, edition, sourceDigest} = judgment.basis;
  const original = {...study, ...edition, evidenceIds: sourceDigest === study.sourceDigest ? study.evidenceIds : []};
  return (
    <section aria-label={condition.label} className="grid min-w-0 gap-3">
      <h3 className="text-sm font-semibold">{condition.label}</h3>
      <div className="grid gap-1 border-l-2 pl-3 text-sm">
        <strong>{validationDecisions[judgment.decision]}</strong>
        <p className="whitespace-pre-line">{judgment.observation}</p>
        <span className="text-xs text-muted-foreground">
          {judgment.actorName} ·{" "}
          {formatUtcDateTime(judgment.createdAt)}
        </span>
      </div>
      <ValidationObservations study={original} rows={selected} judgment={judgment.id} />
      <p className="text-xs text-muted-foreground">
        {selected.length} reviewed / {condition.requiredOrigins} required origins
      </p>
    </section>
  );
}

function StudyReview({
  study,
  initialCondition,
  save,
}: {
  study: ValidationStudy;
  initialCondition: string | null;
  save: (id: string) => void;
}) {
  const params = useSearchParams();
  const [chosen, setChosen] = useState(initialCondition ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const condition = study.conditions.find((c) => c.id === chosen);
  const draft = (condition && drafts[condition.id]) || blank;
  const selected = draft.rows;
  function edit(patch: Partial<Draft>) {
    if (condition)
      setDrafts((prev) => ({ ...prev, [condition.id]: { ...(prev[condition.id] ?? blank), ...patch } }));
  }
  const { basisFor, independent } = assessReadings(study.rows);
  const rows = study.rows.filter((r) => r.conditionId === condition?.id);
  const selectedIds = new Set(selected);
  const marked = residualSummary(independent.filter(row => row.conditionId === condition?.id && selectedIds.has(row.id)));
  const archived = Boolean(study.supersededBy);
  return (
    <div className="grid min-w-0 gap-4">
      <ConditionCoverage study={study} independent={independent} condition={condition?.id} choose={setChosen} />
      {condition && (
        <section className="grid min-w-0 gap-3" aria-label={condition.label}>
          <h3 className="text-sm font-semibold">{condition.label}</h3>
          <ValidationObservations
            study={study}
            rows={rows}
            basisFor={basisFor}
            selected={selectedIds}
            toggle={
              archived
                ? undefined
                : (id) =>
                    edit({ rows: selectedIds.has(id) ? selected.filter((i) => i !== id) : [...selected, id] })
            }
          />
          <p className="text-xs text-muted-foreground">
            {marked.count} selected / {condition.requiredOrigins} required origins
            {marked.count > 0 && (
              <>
                {" "}
                · mean residual {numberLabel(marked.mean, true)} · mean absolute error{" "}
                {numberLabel(marked.absoluteMean)} {study.unit}
              </>
            )}
          </p>
          {!archived && (
            <JudgmentForm
              key={condition.id}
              study={study}
              condition={condition}
              independent={independent}
              draft={draft}
              edit={edit}
              saved={save}
            />
          )}
        </section>
      )}
      {study.supersededBy && (
        <p className="text-sm text-muted-foreground">
          This model edition is superseded. Its recorded judgments remain available.
        </p>
      )}
      {study.judgments.length > 0 && (
        <section aria-label="Recorded validation judgments" className="grid gap-1 border-t pt-3">
          <h3 className="text-sm font-semibold">Recorded judgments</h3>
          <ul className="divide-y">
            {study.judgments.map((j) => {
              return (
                <li key={j.id} className="py-1.5 text-xs">
                  <ConnectionLink connection={{
                    href: modelStudyHref(study, j.id, params), label: j.basis.condition.label,
                    identity: study.modelEditionId,
                  }} />
                  <span> · {validationDecisions[j.decision]}</span>
                  <span className="ml-2 text-muted-foreground">{formatUtcDateTime(j.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ModelValidation({ recordId, members, linked }: { recordId: string; members: readonly RecordUnit[]; linked: boolean }) {
  const params = useSearchParams();
  const requested = params.get("modelStudy"),
    judgmentId = params.get("validation");
  const { data, failed, watch, reload } = useOpenRecord<ValidationData>(
    editionUrl(endpoint, { recordId }, members),
  );
  const studies = data?.filter((study) =>
    members.some((unit) => sameUnit(unit, study)),
  ) ?? [];
  return (
    <div ref={watch} className="grid gap-2 empty:hidden">
      {failed && (
        <p role="alert">
          Unable to load model validation.{" "}
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </p>
      )}
      {linked && requested && data && !studies.some((s) => s.id === requested) && (
          <p role="status">Model validation unavailable for this selection.</p>
        )}
      {studies.map((study) => {
        const pinned = requested === study.id ? study.judgments.find((j) => j.id === judgmentId) : undefined;
        const invalid =
          requested === study.id &&
          judgmentId &&
          (!pinned || !judgmentMatchesStudy(study, pinned));
        const edition = pinned?.basis.edition ?? study;
        const unit = members.find(member => sameUnit(member, study));
        async function saved(id: string) {
          await reload();
          window.history.pushState(
            null,
            "",
            modelStudyHref(study, id, new URLSearchParams(window.location.search)),
          );
        }
        return (
          <ArchiveDialog key={study.id} id={"validation-" + study.id}
            label={"Validate model" + (studies.length > 1 ? " · " + study.modelEditionId : "")}
            title={pinned ? "Recorded model judgment" : "Model validation"}
            description={`${study.serial} · ${unit?.revision ?? ""} · ${edition.quantity} (${edition.unit})`}
            pinned={requested === study.id} onOpen={reload}
            clearOnClose={requested || judgmentId ? ["validation", "modelStudy", "modelCondition", "validationRow"] : undefined}>
              <div className="text-sm">
                <strong>{edition.title}</strong>
                <p className="text-xs text-muted-foreground">
                  {edition.source} · {study.modelEditionId}
                </p>
              </div>
              {invalid ? (
                <p>Reviewed model edition unavailable.</p>
              ) : pinned ? (
                <RecordedJudgment study={study} judgment={pinned} />
              ) : (
                <StudyReview
                  key={study.sourceDigest}
                  study={study}
                  initialCondition={params.get("modelCondition")}
                  save={(id) => void saved(id)}
                />
              )}
          </ArchiveDialog>
        );
      })}
    </div>
  );
}
