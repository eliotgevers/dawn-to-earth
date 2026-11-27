import { assemblyAtUnit, unitProblem, isObject, hasText, entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkTask, type WorkWrite } from "./cases";
import { isRecordUnit, sameUnit, type RecordUnit } from "@/lib/records/journal";
import { validDay } from "@/lib/planning";

type RecoveryOption = {
  key: "wait" | "approved-source" | "substitute";
  title: string;
  material: string;
  document: string;
  approval: string;
  source: string;
  earliest: string;
};

type RecoverySource = {
  finding: string;
  issueId: string;
  checkId: string;
  planningTaskId: string;
  receipt: string;
  alternatives: RecoveryOption[];
};
export type RecoveryCase = WorkCase & { unit: RecordUnit; data: RecoverySource };

function isOptionKey(value: unknown): value is RecoveryOption["key"] {
  return value === "wait" || value === "approved-source" || value === "substitute";
}

function isOption(option: unknown): option is RecoveryOption {
  if (!isObject(option)) return false;

  return (
    isOptionKey(option.key) &&
    [option.title, option.material, option.document, option.approval, option.source].every(hasText) &&
    validDay(option.earliest)
  );
}

export function isRecoveryCase(row: WorkCase): row is RecoveryCase {
  const { data } = row;

  return (
    row.tool === "recovery" &&
    isRecordUnit(row.unit) &&
    [data.issueId, data.checkId, data.planningTaskId, data.finding, data.receipt].every(hasText) &&
    Array.isArray(data.alternatives) &&
    data.alternatives.length > 0 &&
    data.alternatives.every(isOption) &&
    new Set(data.alternatives.map((o) => o.key)).size === data.alternatives.length
  );
}

function proposedOption(proposal?: WorkEvent) {
  return isOption(proposal?.data.basis) ? proposal.data.basis : undefined;
}
const reviews = {
  engineering: {
    status: "Awaiting Engineering", heading: "Review substitute document",
    owner: "reviewer", section: "engineering", title: "Review the substitute document basis",
    decision: { value: "record-basis", label: "Record basis for Quality review" },
  },
  quality: {
    status: "Awaiting Quality", heading: "Review recovery plan",
    owner: "quality", section: "production", title: "Review the supplier recovery plan",
    decision: { value: "review", label: "Endorse recovery for Planning" },
  },
} as const;

function firstReview(option: unknown) {
  return option === "substitute" ? reviews.engineering : reviews.quality;
}

export function recoveryReview(row: RecoveryCase, workspace: ToolContext["workspace"]) {
  const { issue, problem } = recoveryScope(row, workspace);
  const history = row.history;
  const last = history.at(-1);
  let reviewer, proposal;
  if (last?.kind === "recovery-proposed") {
    proposal = last;
    reviewer = firstReview(last.data.option);
  } else if (last?.kind === "substitute-basis-recorded") {
    proposal = history.find(event => event.id === last.data.proposalId && event.kind === "recovery-proposed");
    reviewer = reviews.quality;
  }

  let status = problem ? "No active recovery" : "Choose a recovery";
  if (reviewer) status = reviewer.status;
  else if (last?.kind === "recovery-reviewed") status = "Reviewed for Planning";
  else if (last?.kind === "recovery-closed") status = "Closed";
  else if (last?.kind === "recovery-returned" && !problem) status = "Returned";

  const basis = proposedOption(proposal);
  const limitation = problem ?? (proposal && proposalProblem(row, proposal, basis));

  return { issue, problem, history, last, status, reviewer, proposal, basis, limitation };
}

function recoveryTarget(row: RecoveryCase) {
  const { issueId, checkId, planningTaskId } = row.data;

  return { issueId, checkId, planningTaskId, unitSerial: row.unit.serial, revisionId: row.unit.revisionId };
}

function sameTarget(row: RecoveryCase, event: WorkEvent) {
  return Object.entries(recoveryTarget(row)).every(([field, value]) => event.data[field] === value);
}

// A pending revision leaves the last reviewed plan in force. Planning applies the date only to the matching intake.
export function reviewedRecovery(row: RecoveryCase, history: WorkEvent[]) {
  const approved = history.findLast((event) => event.kind === "recovery-reviewed");
  if (!approved) return;
  const d = approved.data;
  const key = d.option;
  if (
    !isOptionKey(key) ||
    !validDay(d.readyOn) || !hasText(d.source) ||
    !sameTarget(row, approved)
  ) return;
  const proposal = history.find((event) => event.id === d.proposalId && event.kind === "recovery-proposed");
  const option = proposedOption(proposal);

  return {
    caseId: row.id, eventId: approved.id, ...recoveryTarget(row),
    option: key, title: option?.title ?? d.source, readyOn: d.readyOn,
  };
}

export function planningRecovery(cases: WorkCase[]) {
  return cases.filter(isRecoveryCase).flatMap((row) => reviewedRecovery(row, row.history) ?? []);
}

export function recoveryScope(row: RecoveryCase, workspace: ToolContext["workspace"]) {
  const { issueId, checkId, planningTaskId } = row.data;
  const issue = assemblyAtUnit(workspace, issueId, row.unit);
  let problem;
  if (unitProblem(workspace.catalog, row.unit)) problem = "The current unit revision no longer matches this receipt.";
  else if (!issue) problem = "The linked supplier issue is unavailable.";
  else if (issue.status === "Resolved") problem = "The supplier issue has been resolved.";
  else if (
    !workspace.reservations.some(task => task.id === planningTaskId && task.issueId === issueId &&
      task.checkId === checkId && sameUnit(task.unit, row.unit))
  ) problem = "The issue and planning reservation no longer refer to the same acceptance record.";

  return { issue, problem };
}

// Sign the proposal that was actually compared. A corrected source or receipt needs a new proposal.
function proposalProblem(row: RecoveryCase, proposal: WorkEvent, basis?: RecoveryOption) {
  const d = proposal.data;
  const option = row.data.alternatives.find((candidate) => candidate.key === d.option);
  if (!sameTarget(row, proposal)) {
    return "The proposal does not carry the current receipt and unit revision. Return it to the owner for a new comparison.";
  }
  if (
    !option ||
    !basis ||
    Object.entries(option).some(([key, value]) => basis[key as keyof RecoveryOption] !== value) ||
    !validDay(d.readyOn) ||
    d.readyOn < option.earliest
  ) {
    return "The recovery source has changed since this proposal. Return it to the owner to compare the current options.";
  }
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const row = command.dossier;
  if (!isRecoveryCase(row)) return "Choose a recovery case.";
  if (
    (command.data.unitSerial !== undefined && command.data.unitSerial !== row.unit.serial) ||
    (command.data.revisionId !== undefined && command.data.revisionId !== row.unit.revisionId)
  )
    return "The requested unit or revision does not match this recovery case.";
  const { last, reviewer, proposal, limitation, problem } = recoveryReview(row, ctx.workspace);
  if (limitation && command.action !== "return") return limitation;
  if ((last?.id ?? null) !== command.data.previousId)
    return "This recovery changed. Reload before recording a decision.";
  const rationale = entryText(command.data.rationale, 1500);
  if (!rationale) return "Enter a reason of 1 to 1,500 characters.";
  const data = row.data;
  const task = ({ title, owner, section }: Pick<WorkTask, "title" | "owner" | "section">) => ({
    title, owner, section, unit: row.unit, sourceId: data.issueId,
  });
  const close = openAssignments(last, ctx.tasks).map(task => task.id);
  if (command.action === "propose") {
    if (reviewer)
      return "Finish the open review before proposing another recovery.";
    const option = data.alternatives.find((o) => o.key === command.data.option);
    if (!option) return "Choose one of the recorded recovery options.";
    const readyOn = command.data.readyOn;
    if (!validDay(readyOn) || readyOn < option.earliest)
      return "Choose a valid forecast on or after the source’s earliest date.";
    return {
      kind: "recovery-proposed",
      title: "Proposed · " + option.title,
      data: {
        option: option.key,
        source: option.source,
        readyOn,
        rationale,
        basis: { ...option },
        ...recoveryTarget(row),
      },
      completeTaskIds: close,
      tasks: [task(firstReview(option.key))],
    };
  }
  if (!last || !reviewer) return "There is no open recovery proposal to review.";
  if (!proposal) return "The original proposal is unavailable.";
  const subject = {
    proposalId: proposal.id,
    option: proposal.data.option,
    source: proposal.data.source,
    readyOn: proposal.data.readyOn,
    rationale,
  };
  if (command.action === "return") {
    return {
      kind: problem ? "recovery-closed" : "recovery-returned",
      title: problem ? "Closed the outstanding recovery review" : "Returned to the record owner",
      data: problem ? { ...subject, scopeChange: problem } : subject,
      completeTaskIds: close,
      tasks: problem ? [] : [task({ title: "Revise the returned recovery plan", owner: "technician", section: "production" })],
    };
  }
  if (command.action !== reviewer.decision.value) return "Record the required review for this stage.";
  if (command.action === "record-basis") {
    const reference = entryText(command.data.reference, 150);
    if (!reference) return "Enter the retained Engineering decision reference.";
    return {
      kind: "substitute-basis-recorded",
      title: "Engineering recorded the substitution basis",
      data: { ...subject, reference },
      completeTaskIds: close,
      tasks: [task(reviews.quality)],
    };
  }

  return {
    kind: "recovery-reviewed",
    title: "Quality endorsed the recovery plan",
    completeTaskIds: close,
    data: {
      ...subject,
      ...recoveryTarget(row),
      basisEventId: last.kind === "substitute-basis-recorded" ? last.id : null,
    },
  };
}
