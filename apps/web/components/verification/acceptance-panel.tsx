import { ClipboardCheck, ScanLine } from "lucide-react";
import { EmptyRecords } from "@/components/records/empty";
import { RecordResults } from "@/components/records/results";
import { toolHref } from "@/lib/workspace-routes";
import { FrameComparison } from "./archive-frames";
import { sameUnit } from "@/lib/records/journal";
import { useVerification, saveWorkspace } from "@/lib/workspace";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearRecordHash, openRecordHash } from "@/components/workspace/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormDialog, LabeledSelect, NoteField, TextField } from "@/components/records/forms";
import { ConnectionLink, ConnectionList } from "@/components/records/links";
import { GroupedRecordRows, RecordFacts, RecordRow } from "@/components/records/layout";
import { findingConnection, recordConnection, recordUnitLabel } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import { citedWork, acceptanceActions, acceptanceState, type AcceptanceCheck } from "./acceptance";

const approve = { value: "Approved", label: "Accept evidence" } as const;
const hold = { value: "On hold", label: "Keep on hold" } as const;

export function AcceptancePanel({
  checks,
  linked,
  onCollapse,
}: {
  onCollapse: () => void;
  checks: readonly AcceptanceCheck[];
  linked?: string;
}) {
  const target = checks.find(check => check.captures?.some(capture => capture.id === linked))?.id ?? linked;
  const rows = checks.map((check) => ({
    id: check.id, check, state: acceptanceState(check),
  }));
  return (
    <section aria-labelledby="acceptance-checks" className="mt-6">
      <h2 id="acceptance-checks" className="mb-2 text-base font-semibold tracking-tight">Acceptance Review</h2>
      <RecordResults records={rows} searchLabel="Search acceptance checks" statusLabel="Acceptance stage"
        status={row => row.state.stage} searchText={({ check, state }) =>
          [state.artifact.title, recordUnitLabel(check.unit), state.stage, check.owner, state.nextAction].join(" ")}>
        {matches => <GroupedRecordRows records={matches} label="Acceptance Review" scope={() => undefined}>
          {({ check, state }) => {
            const expanded = target === check.id;
            return (
              <RecordRow mobileTitleFirst key={check.id} id={check.id} expanded={expanded} toggle={() => {
                if (expanded) { clearRecordHash(); onCollapse(); }
                else openRecordHash("#" + check.id);
              }} status={state.stage} tone={state.accepted ? "green" : "amber"}
                title={state.artifact.title} reference={recordUnitLabel(check.unit)}>
                {expanded && <AcceptanceRecord check={check} linked={linked} state={state}
                  related={rows.filter((row) => sameUnit(row.check.unit, check.unit))} />}
              </RecordRow>
            );
          }}
        </GroupedRecordRows>}
      </RecordResults>
    </section>
  );
}

type CheckRow = { check: AcceptanceCheck; state: ReturnType<typeof acceptanceState> };
type Capture = NonNullable<AcceptanceCheck["captures"]>[number];
type AcceptanceDraft = { kind: "capture"; requestId: string } | { kind: "review"; evidence: Capture };

function AcceptanceRecord({
  state,
  linked,
  check,
  related,
}: CheckRow & { linked?: string; related: readonly CheckRow[] }) {
  const {targets} = useVerification();
  const artifact = state.artifact;
  const sourceId = linked ?? check.id;
  const { actions, captureLabel, comparisonLink } = acceptanceActions(check, state);
  const heading = useRef<HTMLHeadingElement>(null);
  const {accepted, reviewable} = state;
  const [draft, setDraft] = useState<AcceptanceDraft>();
  const unit = recordUnitLabel(check.unit);
  const savedReview = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  function openDraft(next: AcceptanceDraft) {
    savedReview.current = false;
    setDraft(next);
  }
  async function save(fields: FormData) {
    if (!draft) return;
    const capture = draft.kind === "capture";
    const decision = fields.get("decision");
    if (!capture && reviewable?.id !== draft.evidence.id) return "Review could not be saved. Another follow-up or decision is current.";
    if (!capture && decision !== "Approved" && decision !== "On hold") return "Choose a decision.";
    const scope = { checkId: check.id, ...check.unit };
    const notes = fields.get("notes");
    const { error } = await saveWorkspace(capture
      ? { ...scope, operation: "capture", requestId: draft.requestId, source: fields.get("source"),
          mark: fields.get("mark") ?? "", observation: notes }
      : { ...scope, operation: "review", evidenceId: draft.evidence.id, decision, reason: notes, reviewer: fields.get("reviewer") }, "acceptance");
    if (error) return error;
    return () => {
      savedReview.current = !capture;
      setAnnouncement(capture ? "Follow-up captured. Acceptance remains on hold pending review." :
        decision === "Approved" ? "Artifact accepted for this unit and revision." : "QA review saved. Acceptance remains on hold.");
      setDraft(undefined);
    };
  }

  return (
    <div className="grid gap-2.5 pt-2 wrap-anywhere">
      <h3 ref={heading} tabIndex={-1} className="sr-only">{accepted ? "Artifact accepted" : state.stage}</h3>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Dialog
        open={draft !== undefined}
        onOpenChange={(open) => {
          if (!open) setDraft(undefined);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(({label, href, evidence}, index) => href ? (
            <ConnectionLink key={label} primary={index === 0} sourceId={sourceId} connection={{ href, label }} />
          ) : (
            <DialogTrigger key={label} render={<Button type="button" size="sm" variant="outline" className="bg-popover"
              onClick={() => openDraft(evidence ? {kind: "review", evidence} : {kind: "capture", requestId: crypto.randomUUID()})} />}>
              {evidence ? <ClipboardCheck data-icon="inline-start" aria-hidden="true" /> : <ScanLine data-icon="inline-start" aria-hidden="true" />}
              {label}
            </DialogTrigger>
          ))}
        </div>
        {draft && (
          <FormDialog variant="outline"
            heading={draft.kind === "capture" ? captureLabel : "Review follow-up"}
            description={
              draft.kind === "capture" && state.accepted
                ? `${unit}. Saving another capture reopens the acceptance hold until QA reviews it.`
                : unit
            }
            finalFocus={() => (savedReview.current ? heading.current : true)}
            onSubmit={save}
          >
            <AcceptanceFields check={check} state={state} draft={draft} />
          </FormDialog>
        )}
      </Dialog>
      <RecordFacts
        entries={[
          [artifact.expectation, state.expected],
          ["Issue owner", check.owner],
          ["Next action", state.nextAction],
          ...(state.blocker ? [["Blocker", state.blocker] as const] : []),
        ]}
      />
      <AcceptanceHistory check={check} state={state} linked={linked} />
      <ConnectionList
        sourceId={sourceId}
        links={[
          recordConnection("operations", `unit-${check.unit.serial}-${check.unit.revisionId}`, check.unit, { label: "Readiness · " + check.unit.serial, view: "Readiness" }),
          citedWork(targets, "production", check.buildId, check.unit),
          ...(check.issueId ? [citedWork(targets, "production", check.issueId, check.unit)] : []),
          ...(check.changeId ? [citedWork(targets, "engineering", check.changeId, check.unit)] : []),
          citedWork(targets, "engineering", check.requirementId, check.unit),
          ...comparisonLink,
          ...(check.interfaceId ? [citedWork(targets, "engineering", check.interfaceId, check.unit)] : []),
        ]}
        article="qualification-acceptance"
      />
      <AcceptancePacket rows={related} />
    </div>
  );
}

function ArtifactDetails({ check, state, record, expected, expanded }: CheckRow & {
  record: NonNullable<AcceptanceCheck["initial"]> & Partial<Pick<Capture, "archive" | "interval">>;
  expected?: string;
  expanded?: boolean;
}) {
  const { expectation, observation } = state.artifact;
  const { archive, interval } = record;
  const frames = interval && `${interval.start}–${interval.end}`;
  const preview = archive && interval && <FrameComparison comparison={archive} first={interval.start} last={interval.end} />;
  const reviewing = expected !== undefined;
  const editionFacts = !archive ? [] : reviewing ? [
    ["Archive", archive.evidenceId], ["Original edition", archive.runId],
    ["Rerun edition", archive.rerunId], ["Requirement", archive.requirementId],
  ] as const : [["Run editions", `${archive.runId} → ${archive.rerunId}`]] as const;
  return <>
    <RecordFacts divided={reviewing} entries={[
      ...(reviewing ? [[expectation, expected], ["Original intake", check.initial?.mark]] as const : []),
      [observation, record.mark], ["Source", record.source],
      ...editionFacts,
      ...(interval || ("interval" in record && check.comparison) ? [["Selected frames", frames]] as const : []),
      ["Observation", record.observation],
    ]} />
    {preview && (reviewing ? preview : <details open={expanded} className="mt-2">
      <summary className="cursor-pointer">Inspect saved interval · {frames}</summary>
      {preview}
    </details>)}
  </>;
}

function AcceptanceFields({ check, state, draft }: CheckRow & { draft: AcceptanceDraft }) {
  const { artifact: labels } = state;
  const headerHelpId = check.id + "-header-help";
  if (draft.kind === "capture") {
    return (
      <>
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{labels.expectation} · {state.expected}</p>
        <TextField label="Source reference" name="source" required maxLength={500} />
        {check.artifact === "document" ? (
          <LabeledSelect
            name="mark"
            label={labels.observation}
            options={["Filed", "Missing"]}
          />
        ) : (
          <TextField label={labels.observation}
              name="mark"
              maxLength={100}
              placeholder={!check.artifact || check.artifact === "traveler" ? "Serial / Revision" : undefined}
              aria-describedby={headerHelpId}
            />
        )}
        <p id={headerHelpId} className="mt-1 text-[13px] leading-normal text-muted-foreground">
          {labels.help}
        </p>
        <NoteField label="Observation" name="notes" required maxLength={1000} rows={3} />
      </>
    );
  }
  const evidence = draft.evidence;
  const canAccept = state.canApprove && state.current?.id === evidence.id;
  return (
    <>
      <ArtifactDetails check={check} state={state} record={evidence} expected={state.expected} />
      {!canAccept && <p className="mt-1 text-[13px] leading-normal text-muted-foreground">QA can accept a follow-up once it meets this check.</p>}
      <LabeledSelect
        name="decision"
        label="Decision"
        placeholder="Choose a decision"
        options={canAccept ? [approve, hold] : [hold]}
      />
      <TextField label="Reviewer" name="reviewer" maxLength={100} placeholder="Quality assurance" />
      <NoteField label="Review reason" name="notes" required maxLength={500} rows={3} />
    </>
  );
}

function AcceptanceHistory({ check, state, linked }: CheckRow & { linked?: string }) {
  const { findings } = useVerification();
  return (
    <section aria-labelledby={`${check.id}-evidence`}>
      <h3 className="text-[13px] font-semibold" id={`${check.id}-evidence`}>Evidence history</h3>
      <ol className="divide-y">
        {state.submissions.map(({ review, ...record }) => (
          <li key={record.id} id={record.id} tabIndex={-1} className="scroll-mt-[calc(var(--header)+12px)] py-2">
            <strong>Follow-up</strong>
            <span className="block mt-0.5 text-xs text-muted-foreground">
              {record.id === state.current?.id ? "Current" : "Superseded"} · {formatUtcDateTime(record.recordedAt)}
            </span>
            <ArtifactDetails check={check} state={state} record={record} expanded={linked === record.id} />
            {review && (
              <div className="mt-1 text-[13px] leading-normal text-muted-foreground">
                <strong>{review.reviewer ?? "Quality assurance"} · {review.decision}</strong>
                {" "}· {formatUtcDateTime(review.recordedAt)} · {review.reason}
                <ConnectionList title="Decision basis" sourceId={record.id} links={[
                  ...(review.auditCaseId ? [{
                    href: toolHref("audit", review.auditCaseId), label: "Decision replay", location: "Operations · Audit",
                  }] : []),
                  ...findings.filter(f => f.decisionId === review.id && f.checkId === check.id).map(findingConnection),
                ]} />
              </div>
            )}
          </li>
        ))}
        <li className="py-2">
          <strong>Original intake</strong>
          {check.initial ? (
            <ArtifactDetails check={check} state={state} record={check.initial} />
          ) : (
            <EmptyRecords />
          )}
        </li>
      </ol>
    </section>
  );
}

function AcceptancePacket({ rows }: { rows: readonly CheckRow[] }) {
  const {targets} = useVerification();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="bg-popover" />}>View unit packet</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unit acceptance packet</DialogTitle>
          <DialogDescription>
            {recordUnitLabel(rows[0]?.check.unit)} · Covers {rows.length} tracked acceptance{" "}
            {rows.length === 1 ? "check" : "checks"}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {rows.map(({check, state}) => {
            const artifact = state.artifact;
            return (
              <li key={check.id} className="py-2">
                <strong>{artifact.title}</strong>
                <RecordFacts divided
                  entries={[
                    ["Status", state.stage],
                    [artifact.expectation, state.expected],
                    ["Source", state.current?.source ?? check.initial?.source],
                    ["Decision", state.review?.decision],
                    ["Reviewer", state.review?.reviewer],
                    ["Decided", state.review && formatUtcDateTime(state.review.recordedAt)],
                    ["Blocker", state.blocker],
                  ]}
                />
                <ConnectionList
                  onFollow={() => setOpen(false)}
                  links={[
                    recordConnection("verification", state.current?.id ?? check.id, check.unit, { label: state.current ? "Submitted evidence" : "Acceptance check", view: "Acceptance Review" }),
                    citedWork(targets, "engineering", check.requirementId, check.unit),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
