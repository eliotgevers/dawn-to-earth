import { unitProblem, entryText, hasText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkWrite } from "./cases";
import { acceptanceState } from "@/components/verification/acceptance";
import { isRecordUnit, sameUnit, type RecordUnit, isRemovedRecord } from "@/lib/records/journal";

export type Step = { id: string; label: string; detail: string };
type Release = {
  buildId: string;
  checkId: string;
  issueId: string;
  edition: string;
  steps: Step[];
};
export type Traveler = WorkCase & { unit: RecordUnit; data: Release };

export function isTraveler(row: WorkCase): row is Traveler {
  return (
    row.tool === "traveler" &&
    isRecordUnit(row.unit) &&
    [row.data.buildId, row.data.checkId, row.data.issueId, row.data.edition].every(hasText) &&
    Array.isArray(row.data.steps) &&
    row.data.steps.every((s) => s && hasText(s.id) && hasText(s.label) && hasText(s.detail)) &&
    new Set(row.data.steps.map((s) => s.id)).size === row.data.steps.length &&
    row.data.steps.at(-1)?.id === "handoff"
  );
}

function matchesSubject(subject: Record<string, string>, data: Record<string, unknown>) {
  return Object.entries(subject).every(([key, value]) => data[key] === value);
}

export function travelerProgress(row: Traveler) {
  const { buildId, edition, issueId, checkId } = row.data;
  const subject = { buildId, edition, unitSerial: row.unit.serial, revisionId: row.unit.revisionId };
  const history = row.history.filter(({ data }) =>
    data.issueId === issueId && data.checkId === checkId && matchesSubject(subject, data));

  const completed = new Map(history.filter((e) => e.kind === "step-recorded").map((e) => [e.data.stepId, e]));
  const lastHold = history.findLast((e) => e.kind === "traveler-paused" || e.kind === "traveler-resumed");
  const pause = lastHold?.kind === "traveler-paused" ? lastHold : undefined;
  const disposition =
    pause && history.findLast((e) => e.kind === "disposition-recorded" && e.data.pauseId === pause.id);
  const assignedAction = !pause ? "complete" : disposition?.data.resume === true ? "resume" : "dispose";
  const owner = assignedAction === "resume" ? pause?.actor : pause?.data.owner;

  return { history, completed, pause, disposition, owner, subject, assignedAction } as const;
}

export function travelerExecution(cases: WorkCase[]) {
  const travelers = [];
  const holds = [];
  for (const row of cases) {
    if (!isTraveler(row)) continue;
    const { completed, pause, owner } = travelerProgress(row);
    const evidenceId = completed.get("handoff")?.data.evidenceId;
    const source = { caseId: row.id, buildId: row.data.buildId, unit: row.unit };
    travelers.push({
      ...source, edition: row.data.edition, checkId: row.data.checkId,
      handoffEvidenceId: typeof evidenceId === "string" ? evidenceId : null,
    });
    if (pause && hasText(pause.data.note) && hasText(owner)) {
      holds.push({ ...source, reason: pause.data.note, owner });
    }
  }

  return { travelers, holds };
}

export function travelerRecord(
  row: Traveler,
  { workspace }: Pick<ToolContext, "workspace">,
) {
  const { catalog, checks, assembly, local } = workspace;
  const progress = travelerProgress(row);
  const { history, completed, pause, disposition, subject, assignedAction } = progress;
  const check = checks.find(
    (c) =>
      c.id === row.data.checkId &&
      c.buildId === row.data.buildId &&
      c.issueId === row.data.issueId &&
      sameUnit(c.unit, row.unit),
  );
  const recordFor = (id: string) => assembly.find(record => record.id === id && sameUnit(record.unit, row.unit));
  const build = recordFor(row.data.buildId);
  const issue = recordFor(row.data.issueId);
  const acceptance = check && acceptanceState(check);
  const evidence =
    acceptance?.match && acceptance.review?.decision !== "On hold" ? acceptance.current : undefined;
  const observation =
    check && acceptance
      ? {
          captureId: acceptance.current?.id ?? null,
          source: acceptance.current?.source ?? check.initial?.source ?? null,
          observed: (acceptance.current ? acceptance.current.mark : check.initial?.mark) || null,
          expected: acceptance.expected,
        }
      : undefined;
  const handoff = completed.get("handoff");
  const outdated = !!handoff && handoff.data.evidenceId !== evidence?.id;
  const next = row.data.steps.find((s) => !completed.has(s.id) || (s.id === "handoff" && outdated));
  const unavailable =
    !build ||
    !check ||
    !issue ||
    isRemovedRecord(issue.id, local, row.unit) ||
    isRemovedRecord(build.id, local, row.unit) ||
    !!unitProblem(catalog, row.unit);
  const needsEvidence = next?.id === "handoff" && !evidence;
  let status = completed.size ? "In progress" : "Ready to start";
  if (unavailable) status = "Read only";
  else if (pause) status = assignedAction === "resume" ? "Awaiting resume" : "On hold";
  else if (!next) status = "Handed off";
  else if (outdated) status = "Handoff needs review";
  else if (needsEvidence) status = "Awaiting evidence";

  const target = {
    ...subject,
    previousId: history.at(-1)?.id ?? null,
    stepId: next?.id,
    captureId: observation?.captureId,
    evidenceId: evidence?.id,
    pauseId: pause?.id,
    dispositionId: disposition?.id,
  };

  return {
    ...progress,
    check,
    issue,
    build,
    evidence,
    acceptance,
    needsEvidence,
    target,
    observation,
    outdated,
    next,
    unavailable,
    status,
  };
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const row = command.dossier;
  if (!isTraveler(row)) return "Choose a released traveler.";
  const { data: input, action } = command;
  const state = travelerRecord(row, ctx);
  if (state.unavailable || !matchesSubject(state.subject, input))
    return "The build, unit or released traveler does not match.";
  if (input.previousId !== state.target.previousId)
    return "This traveler changed. Review its current state before saving.";
  const note = entryText(input.note, 2000);
  if (!note) return "Enter a note of up to 2,000 characters.";
  const base = {
    ...state.subject,
    issueId: row.data.issueId,
    checkId: row.data.checkId,
    note,
  };
  const task = (title: string, owner: string) => ({
    title,
    owner,
    sourceId: "traveler-action",
    section: "production" as const,
    unit: row.unit,
  });
  if (action === "pause") {
    if (state.pause) return "This traveler already has an open discrepancy.";
    const owner = ctx.workspace.actors.find(actor => actor.id === input.owner);
    if (!owner)
      return "Choose a discrepancy owner.";
    return {
      kind: "traveler-paused",
      title: "Traveler paused for discrepancy",
      data: { ...base, owner: owner.id, stepId: state.next?.id ?? "handoff" },
      tasks: [task("Record traveler discrepancy disposition · " + row.unit.serial, owner.id)],
    };
  }
  if (action === "dispose") {
    if (state.assignedAction !== "dispose" || !state.pause || input.pauseId !== state.pause.id)
      return "Select the current unresolved discrepancy.";
    if (input.outcome !== "Keep on hold" && input.outcome !== "Authorize resume")
      return "Choose a disposition.";
    const resume = input.outcome === "Authorize resume";
    return {
      kind: "disposition-recorded",
      title: resume ? "Traveler resume authorized" : "Traveler hold retained",
      data: { ...base, resume, pauseId: state.pause.id },
      ...(resume
        ? {
            completeTaskIds: openAssignments(state.pause, ctx.tasks).map(task => task.id),
            tasks: [task("Resume traveler · " + row.unit.serial, state.pause.actor)],
          }
        : {}),
    };
  }
  if (action === "resume") {
    if (state.assignedAction !== "resume" || input.dispositionId !== state.target.dispositionId)
      return "A recorded disposition authorizing resume is required.";
    return {
      kind: "traveler-resumed",
      title: "Traveler resumed",
      completeTaskIds: openAssignments(state.disposition, ctx.tasks).map(task => task.id),
      data: { ...base, pauseId: state.target.pauseId, dispositionId: state.target.dispositionId },
    };
  }
  const step = state.next;
  if (action !== "complete" || state.pause || !step || input.stepId !== step.id)
    return "Only the current unpaused step can be recorded.";

  const data: WorkWrite["data"] = { ...base, stepId: step.id };
  if (step.id === "inspect") {
    if (!state.observation || input.captureId !== state.observation.captureId)
      return "The archive entry changed. Compare the current entry before recording the document check.";
    data.inspected = state.observation;
  } else if (step.id === "handoff") {
    if (!state.evidence || input.evidenceId !== state.evidence.id)
      return "Select the current matching evidence from this build before handing it off.";
    data.evidenceId = state.evidence.id;
    data.replaces = state.completed.get(step.id)?.id;
  }

  return { kind: "step-recorded", title: step.label, data };
}
