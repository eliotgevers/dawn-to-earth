import { sameUnit, recordActivity } from "@/lib/records/journal";
import { entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkWrite } from "./cases";

type Submission = { number: number; question: string; material: string; change: string };
type Finding = {
  id: string;
  locator: string;
  observation: string;
  disposition: "Observation" | "Open question";
};
type Archive = { reference: string; findings: Finding[]; evidenceId?: string; evidenceVersion?: string };
export type Campaign = {
  project: string;
  partner: string;
  requirement: { id: string };
  evidence: { id: string };
  previous: Submission;
  draft: Submission;
  availableArchive?: Archive;
};

export function sourceObservation(spec: Campaign, unit: WorkCase["unit"], workspace: ToolContext["workspace"]) {
  const source = workspace.evidence.find((e) => e.id === spec.evidence.id);
  if (
    !source ||
    source.requirement.id !== spec.requirement.id ||
    !sameUnit(source.unit, unit)
  )
    return;
  const activity = recordActivity(workspace.local, source.id, unit);
  if (activity.some(entry => entry.action?.type === "remove")) return;
  const edit = activity.find(entry => entry.action?.type === "edit");
  const observation = edit?.description ?? source.observation;
  const reference = edit?.context ?? source.source;
  if (observation && reference)
    return {
      id: source.id,
      title: edit?.title ?? source.title,
      observation,
      reference,
      test: source.test,
      version: edit?.id ?? source.id,
    };
}

export type Edition = {
  submission: Submission;
  id: string;
  draft?: WorkEvent;
  previous?: Edition;
  handoff?: WorkEvent;
  archive?: Archive;
  archiveEntry?: WorkEvent;
  review?: WorkEvent;
};

export function campaignEditions(record: WorkCase) {
  const campaign = record.data as Campaign;
  const previous: Edition = { id: record.id + "-r" + campaign.previous.number, submission: campaign.previous };
  const draft: Edition = {
    id: record.id + "-r" + campaign.draft.number,
    submission: campaign.draft, previous, archive: campaign.availableArchive,
  };
  const editionsById = new Map([[previous.id, previous], [draft.id, draft]]);
  const history = record.history;
  for (const event of history) {
    const id = String(event.data.submissionId);
    const edition = editionsById.get(id);
    if (event.kind === "iteration-prepared") {
      editionsById.set(id, {
        id, submission: event.data.submission as Submission, draft: event,
        previous: editionsById.get(String(event.data.previousSubmissionId)),
      });
    } else if (edition) {
      if (event.kind === "submission-handed-off") {
        edition.handoff = event;
        edition.submission = event.data.submission as Submission;
        if ("archive" in event.data) edition.archive = (event.data.archive as Archive | null) ?? undefined;
      }
      if (event.kind === "archive-indexed") {
        edition.archive = event.data.archive as Archive;
        edition.archiveEntry = event;
      }
      if (event.kind === "results-reviewed") edition.review = event;
    }
  }
  const editions = [...editionsById.values()];
  const current = editions[editions.length - 1];
  const step: keyof typeof campaignSteps = current.review ? "prepare" : !current.handoff ? "handoff" : current.archive ? "review" : "index";
  const owner = step === "handoff" || step === "prepare" ? campaign.partner : current.handoff?.data.reviewer;

  return { campaign, editions, current, last: history.at(-1), step, owner };
}

export const campaignSteps = {
  handoff: "Hand off submission",
  index: "Record archive extract",
  review: "Review archived results",
  prepare: "Choose findings for next revision",
} as const;

export function reviewedFindings(edition: Edition) {
  const ids = new Set(edition.review?.data.findingIds as string[] | undefined);

  return (edition.archive?.findings ?? []).filter((f) => ids.has(f.id));
}

function selectedIds(value: unknown, options: Finding[]) {
  if (!Array.isArray(value) || value.length > options.length) return;
  const ids = new Set(value);
  const matches = options.filter((finding) => ids.has(finding.id)).map((finding) => finding.id);
  if (ids.size === value.length && matches.length === ids.size) return matches;
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const { action, data } = command;
  const record = command.dossier;
  const { campaign, current, last, step, owner } = campaignEditions(record);
  if (data.submissionId !== current.id || data.lastEvent !== (last?.id ?? null))
    return "This submission changed. Reopen the campaign before recording another action.";
  if (action !== step) return "This action is unavailable at the current submission stage.";
  const task = openAssignments(last, ctx.tasks).find(t => t.sourceId === current.id && t.owner === owner);
  if (last && !task) return "The assignment changed. Reopen the campaign.";
  const done = task ? [task.id] : [];
  const revision = current.submission.number;
  const assignment = (owner: string, title: string, id = current.id) => ({
    title: record.title + " · " + title,
    sourceId: id,
    owner,
    section: "engineering" as const,
    unit: record.unit,
  });
  if (action === "handoff") {
    const reviewer = ctx.workspace.users.find((user) => user.id === data.reviewer);
    const note = entryText(data.note, 800);
    if (!reviewer || !note) return "Choose an internal reviewer and record what needs checking.";
    return {
      kind: "submission-handed-off",
      title: "Revision " + revision + " handed to " + reviewer.name,
      data: {
        submissionId: current.id,
        reviewer: reviewer.id,
        note,
        submission: current.submission,
        archive: current.archive ?? null,
      },
      completeTaskIds: done,
      tasks: [assignment(reviewer.id, current.archive ? "Review results" : "Index archive extract")],
    };
  }
  if (action === "index" && current.handoff && task) {
    let archive: Archive;
    if (data.evidenceId !== undefined) {
      const source = sourceObservation(campaign, record.unit, ctx.workspace);
      const locator = entryText(data.sourceLocator, 160);
      if (!source || source.id !== data.evidenceId || source.version !== data.sourceVersion)
        return "The cited evidence or its revision changed. Reopen the campaign before citing it.";
      if (!locator) return "Identify the source page, row or caption used for this submission.";
      archive = {
        reference: source.reference,
        evidenceId: source.id,
        evidenceVersion: source.version,
        findings: [
          {
            id: "record-observation",
            observation: source.observation,
            locator,
            disposition: "Observation",
          },
        ],
      };
    } else {
      const reference = entryText(data.reference, 160);
      if (!reference || !Array.isArray(data.findings) || !data.findings.length || data.findings.length > 12)
        return "Record a source reference and at least one finding with a locator.";
      const findings: Finding[] = [];
      for (const row of data.findings) {
        if (!row || typeof row !== "object") return "Each finding needs a locator, observation and kind.";
        const locator = entryText(row.locator, 160),
          observation = entryText(row.observation, 800);
        if (!locator || !observation || !["Observation", "Open question"].includes(row.disposition))
          return "Each finding needs a locator, observation and kind.";
        findings.push({
          id: "finding-" + (findings.length + 1),
          locator,
          observation,
          disposition: row.disposition,
        });
      }
      archive = { reference, findings };
    }
    return {
      kind: "archive-indexed",
      title: "Archive extract recorded for revision " + revision,
      data: { submissionId: current.id, handoffId: current.handoff.id, archive },
      completeTaskIds: done,
      tasks: [assignment(task.owner, "Review results")],
    };
  }
  if (action === "review" && current.handoff && current.archive) {
    const note = entryText(data.note, 800),
      findingIds = selectedIds(data.findingIds, current.archive.findings);
    if (!note || !findingIds) return "Add a review conclusion and select findings from this archive.";
    return {
      kind: "results-reviewed",
      title: "Results reviewed for revision " + revision,
      data: {
        submissionId: current.id,
        handoffId: current.handoff.id,
        archiveEntryId: current.archiveEntry?.id ?? null,
        archiveReference: current.archive.reference,
        findingIds,
        note,
      },
      completeTaskIds: done,
      tasks: [assignment(campaign.partner, "Choose findings for next revision")],
    };
  }
  if (action === "prepare" && current.review && current.archive) {
    const question = entryText(data.question, 800),
      material = entryText(data.material, 200),
      change = entryText(data.change, 800);
    const carry = selectedIds(data.findingIds, reviewedFindings(current));
    if (!question || !material || !change || !carry)
      return "Enter the next question, material and change. Carry only findings released in this review.";
    const submission: Submission = { number: revision + 1, question, material, change };
    const id = record.id + "-r" + submission.number;
    return {
      kind: "iteration-prepared",
      title: "Revision " + submission.number + " prepared",
      data: {
        submissionId: id,
        submission,
        previousSubmissionId: current.id,
        reviewId: current.review.id,
        archiveReference: current.archive.reference,
        findingIds: carry,
      },
      completeTaskIds: done,
      tasks: [assignment(campaign.partner, "Hand off revision " + submission.number, id)],
    };
  }

  return "This action is unavailable at the current submission stage.";
}
