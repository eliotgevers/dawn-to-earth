"use client";
import { CompareDialog, CompareFields } from "@/components/records/compare-dialog";
import { shortNoteField } from "@/components/records/presentation";
import { useCaseForm, useDecisionFocus } from "@/components/records/case-form";
import { CaseHeading, CaseList } from "@/components/records/case-list";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PersonField, LabeledSelect, TextField, NoteField } from "@/components/records/forms";
import { ConnectionLink, ConnectionList } from "@/components/records/links";
import { connectionToRecord } from "@/components/records/schema";
import { recordConnection, type RecordConnection } from "@/lib/records/links";
import { methods } from "@/components/verification/model";
import { isRemovedRecord } from "@/lib/records/journal";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkCase } from "@/db/workflows/cases";
import {
  campaignEditions,
  campaignSteps,
  reviewedFindings,
  sourceObservation,
  type Edition,
} from "@/db/workflows/campaign";

const submissionFields = [
  { key: "question", label: "Research question", prompt: "Next research question" },
  { key: "material", label: "Submission material", prompt: "Submission material" },
  { key: "change", label: "Change note", prompt: "What changes this revision?" },
] as const;

export default function CampaignView(props: ToolProps) {
  const { dossier: record } = props;
  if (record) return <CampaignRecord record={record} {...props} />;
  return <CaseList label="Research campaigns" rows={props.cases.map(record => {
    const { campaign, current, step, owner } = campaignEditions(record);
    return {
      record,
      detail: ["Demo research submission", campaign.project, "Revision " + current.submission.number, props.personName(owner, "")].filter(Boolean).join(" · "),
      status: campaignSteps[step],
    };
  })} />;
}

function CampaignRecord({ record, workspace, submit, personName: actorName }: ToolProps & { record: WorkCase }) {
  const { campaign, editions, current, last, step, owner } = campaignEditions(record);
  const lastEvent = last?.id ?? null;
  const source = sourceObservation(campaign, record.unit, workspace);
  const requirement = workspace.assembly.find(row => row.kind === "requirement" && row.id === campaign.requirement.id);
  const links: RecordConnection[] = [];
  if (requirement && !isRemovedRecord(requirement.id, workspace.local, record.unit))
    links.push(connectionToRecord("engineering", { ...requirement, unit: record.unit ?? undefined }));
  if (source)
    links.push(recordConnection("verification", source.id, record.unit, {
      view: methods[source.test].label, label: "Source inspection", identity: source.title,
    }));
  const { pending, message, setError, record: saveStep } = useCaseForm(submit);
  const focus = useDecisionFocus(last ? [last] : []);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { actor, ...fields } = Object.fromEntries(form);
    if (typeof actor !== "string" || !actor) {
      setError("Choose the person recording this step.");
      event.currentTarget.querySelector<HTMLButtonElement>("button[role=combobox]")?.focus();
      return;
    }
    const data: Record<string, unknown> = { ...fields, submissionId: current.id, lastEvent };
    if (step === "prepare" || step === "review") data.findingIds = form.getAll("finding");
    if (step === "index" && !data.evidenceId) {
      const observations = form.getAll("observation");
      const dispositions = form.getAll("disposition");
      data.findings = form.getAll("locator").map((locator, index) => ({
        locator, observation: observations[index], disposition: dispositions[index],
      }));
    }
    const saved = {
      prepare: "Next revision saved.",
      handoff: "Submission handed off.",
      index: "Archive extract recorded.",
      review: "Review returned to the collaborator.",
    };
    saveStep({ action: step, actor, data }, id => focus(id, "campaign-step"), saved[step]);
  }
  return (
    <article className="grid gap-2.5 pt-2 wrap-anywhere min-w-0">
      <CaseHeading record={record} back="All campaigns">
        <p className="mt-0.5 text-xs text-muted-foreground">
          Demo research submission · {campaign.project} · {record.unit?.serial} · {record.unit?.revision}
        </p>
      </CaseHeading>
      <section
        id={current.id}
        className="grid min-w-0 scroll-mt-16 gap-4"
        aria-label={"Submission revision " + current.submission.number}
      >
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">Revision {current.submission.number}</h3>
            <RevisionComparison key={current.id} editions={editions} />
          </div>
          <p>{current.submission.question}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{current.submission.material}</p>
        </div>
        <CarriedFindings edition={current} />
        <form
          key={`step:${lastEvent ?? current.id}`}
          onSubmit={save}
          className="grid min-w-0 max-w-2xl gap-3 border-y border-border py-4"
        >
          <div>
            <h3 className="text-[13px] font-semibold" id="campaign-step" tabIndex={-1}>
              {campaignSteps[step]}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {actorName(owner)} ·{" "}
              {owner === campaign.partner ? "Research collaborator" : "Assigned reviewer"}
            </p>
          </div>
          <PersonField people={workspace.actors} name="actor" required />
          {current.handoff && !current.review && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Handoff recorded by {actorName(current.handoff.actor)} · {String(current.handoff.data.note)}
            </p>
          )}
          <SubmissionFields current={current} step={step} source={source} users={workspace.users} actorName={actorName} />
          <Button size="sm" className="w-fit" type="submit" disabled={pending}>
            {{
              handoff: `Hand off revision ${current.submission.number}`,
              index: "Save archive extract",
              review: "Return review to collaborator",
              prepare: `Save revision ${current.submission.number + 1}`,
            }[step]}
          </Button>
        </form>
        <p role="status" aria-live="polite" className="mt-0.5 text-xs text-muted-foreground empty:hidden">
          {message}
        </p>
      </section>
      <section aria-label="Submission history" className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Submission history</h3>
        <ul className="divide-y">
          {editions.toReversed().map((edition) => (
            <li key={edition.id}>
              <details id={edition.id === current.id ? undefined : edition.id} className="scroll-mt-16 py-2">
                <summary className="cursor-pointer">
                  Revision {edition.submission.number} · {edition.submission.material}
                </summary>
                <div className="mt-2 grid gap-2">
                  <p id={edition.draft?.id}>{edition.submission.question}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{edition.submission.change}</p>
                  {edition.handoff && (
                    <p id={edition.handoff.id}>
                      <strong>Handoff</strong> · {actorName(edition.handoff.actor)} to{" "}
                      {actorName(edition.handoff.data.reviewer)} · {formatUtcDateTime(edition.handoff.at)}
                      <br />
                      {String(edition.handoff.data.note)}
                    </p>
                  )}
                  {edition.archive && (
                    <div>
                      <strong>{edition.archive.reference}</strong>
                      {edition.archiveEntry && (
                        <p id={edition.archiveEntry.id} className="mt-0.5 text-xs text-muted-foreground">
                          Indexed by {actorName(edition.archiveEntry.actor)} ·{" "}
                          {formatUtcDateTime(edition.archiveEntry.at)}
                        </p>
                      )}
                      <ul>
                        {edition.archive.findings.map((f) => (
                          <li className="py-1" key={f.id}>
                            <FindingText finding={f} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {edition.review && (
                    <div id={edition.review.id}>
                      <p>
                        <strong>Review</strong> · {actorName(edition.review.actor)} ·{" "}
                        {formatUtcDateTime(edition.review.at)}
                      </p>
                      <p>{String(edition.review.data.note)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Released findings ·{" "}
                        {reviewedFindings(edition)
                          .map((f) => f.locator)
                          .join(", ") || "None"}
                      </p>
                    </div>
                  )}
                  <CarriedFindings edition={edition} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
      <ConnectionList title="Research basis" links={links} />
    </article>
  );
}

function SubmissionFields({ current, step, source, users, actorName }: {
  current: Edition;
  step: keyof typeof campaignSteps;
  source: ReturnType<typeof sourceObservation>;
  users: ToolProps["workspace"]["users"];
  actorName: (id: unknown) => string;
}) {
  if (step === "index") return <ArchiveForm source={source} />;
  if (step === "prepare") {
    if (!current.review || !current.archive) return null;
    return <>
      <div>
        <p>{String(current.review.data.note)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {actorName(current.review.actor)} · {current.archive.reference}
        </p>
      </div>
      <FindingChoices title="Carry into the next revision" findings={reviewedFindings(current)} />
      {submissionFields.map(({ key, prompt }) => key === "material"
        ? <TextField key={key} label={prompt} name={key} required maxLength={200} />
        : <NoteField key={key} label={prompt} name={key} className={shortNoteField} required maxLength={800} />
      )}
    </>;
  }
  const handoff = step === "handoff";
  return <>
    {handoff ? <PersonField people={users} name="reviewer" label="Send to reviewer"
      placeholder="Choose a reviewer" required showRole /> : current.archive && (
      <FindingChoices title="Findings to return" reference={current.archive.reference} findings={current.archive.findings} />
    )}
    <NoteField label={handoff ? "Review request" : "Review conclusion"} className={shortNoteField} required maxLength={800} name="note" />
  </>;
}

function RevisionComparison({ editions }: { editions: Edition[] }) {
  const pairs = editions.filter(edition => edition.previous);
  const [selectedId, setSelectedId] = useState(() => pairs.at(-1)?.id);
  const edition = pairs.find(pair => pair.id === selectedId);
  if (!edition?.previous) return null;
  const before = edition.previous.submission;
  const after = edition.submission;
  return (
    <CompareDialog title="Compare research submissions">
      <div className="grid min-w-0 gap-4">
        {pairs.length > 1 && (
          <LabeledSelect
            label="Submission to compare"
            value={edition.id}
            onChange={id => id && setSelectedId(id)}
            options={pairs.map(option => ({
              value: option.id, label: "Revision " + option.submission.number,
            }))}
          />
        )}
        <CompareFields
          referenceLabel={`Revision ${before.number}`}
          proposedLabel={`Revision ${after.number}`}
          fields={submissionFields.map(({ key, label }) => ({
            id: key, label, before: before[key], after: after[key],
          }))}
        />
      </div>
    </CompareDialog>
  );
}

type Finding = NonNullable<Edition["archive"]>["findings"][number];

function FindingText({ finding, reference }: { finding: Finding; reference?: string }) {
  return <span>
    {finding.observation}
    <span className="mt-0.5 text-xs text-muted-foreground block">
      {[finding.disposition, reference, finding.locator].filter(Boolean).join(" · ")}
    </span>
  </span>;
}

function CarriedFindings({ edition: { draft, previous } }: { edition: Edition }) {
  if (!draft || !previous) return null;
  const selections = new Set(draft.data.findingIds as string[]);
  const chosen = reviewedFindings(previous).filter((f) => selections.has(f.id));
  return (
    <div>
      <ConnectionLink className="w-fit" connection={{
        href: "#" + previous.id, label: "Findings · revision " + previous.submission.number,
      }} />
      {chosen.length ? (
        <ul>
          {chosen.map((f) => (
            <li key={f.id} className="py-1">
              <FindingText finding={f} reference={String(draft.data.archiveReference)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">No findings carried forward.</p>
      )}
    </div>
  );
}

function FindingChoices({
  title,
  reference,
  findings,
}: {
  title: string;
  reference?: string;
  findings: ReturnType<typeof reviewedFindings>;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="font-medium">{title}</legend>
      {reference && <p className="mt-0.5 text-xs text-muted-foreground">{reference}</p>}
      {findings.length === 0 && <p className="mt-0.5 text-xs text-muted-foreground">No findings returned in this review.</p>}
      {findings.map((finding) => (
        <label key={finding.id} className="flex items-start gap-2 py-1">
          <input type="checkbox" name="finding" value={finding.id} className="mt-1" />
          <FindingText finding={finding} />
        </label>
      ))}
    </fieldset>
  );
}

function ArchiveForm({ source }: { source: ReturnType<typeof sourceObservation> }) {
  const [rows, setRows] = useState([1]);
  const [citeEvidence, setCiteEvidence] = useState(false);
  const useEvidence = Boolean(source && citeEvidence);
  return (
    <>
      {source && (
        <label className="flex items-start gap-2 py-1">
          <input
            type="checkbox"
            className="mt-1"
            checked={useEvidence}
            onChange={(e) => setCiteEvidence(e.target.checked)}
          />
          <span>
            Cite linked evidence<span className="mt-0.5 text-xs text-muted-foreground block">{source.title}</span>
          </span>
        </label>
      )}
      {source && (
        <fieldset disabled={!useEvidence} hidden={!useEvidence} aria-label="Linked observation">
          <input type="hidden" name="evidenceId" value={source.id} />
          <input type="hidden" name="sourceVersion" value={source.version} />
          <p>
            {source.observation}
            <span className="mt-0.5 text-xs text-muted-foreground block">{source.reference}</span>
          </p>
          <TextField label="Source locator"
            required
            name="sourceLocator"
            maxLength={160}
            placeholder="Document page, row or caption"
          />
        </fieldset>
      )}
      <fieldset disabled={useEvidence} hidden={useEvidence} aria-label="Archive extract">
        <div className="grid gap-3">
          <TextField label="Archive reference" required name="reference" maxLength={160} />
          {rows.map((id, i) => (
            <fieldset key={id} className="grid gap-2">
              <legend className="font-medium">Finding {i + 1}</legend>
              <TextField label="Source locator" required name="locator" maxLength={160} placeholder="Document page, row or caption" />
              <NoteField label="Finding" className={shortNoteField} required name="observation" maxLength={800} />
              <LabeledSelect
                label="Finding kind"
                name="disposition"
                defaultValue="Observation"
                options={[
                  { value: "Observation", label: "Observation" },
                  { value: "Open question", label: "Open question" },
                ]}
              />
              {rows.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => setRows(rows.filter((key) => key !== id))}
                  type="button"
                >
                  Remove finding {i + 1}
                </Button>
              )}
            </fieldset>
          ))}
          {rows.length < 12 && (
            <Button
              size="sm"
              className="w-fit bg-popover"
              type="button"
              variant="outline"
              onClick={() => setRows([...rows, rows[rows.length - 1] + 1])}
            >
              Add finding
            </Button>
          )}
        </div>
      </fieldset>
    </>
  );
}
