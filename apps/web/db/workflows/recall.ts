import { sameUnit } from "@/lib/records/journal";
import { entryText, isQAReviewer, type ToolCommand, type ToolContext, type WorkCase, type WorkWrite } from "./cases";

type RegisterEntry = {
  evidenceId: string;
  serial: string;
  revisionId: string;
  instrument: string | null;
  captured: string | null;
};

type Certificate = {
  instrument: string;
  previous: string;
  corrected: string;
  correction: string;
  register: string;
  since: string;
  through: string;
  entries: RegisterEntry[];
};

export type RecallCase = WorkCase & { data: Certificate };

type ScopeStatus = "Matched" | "Uncertain" | "Excluded";
const conclusions = ["Impact documented", "No impact identified", "Provenance unresolved"] as const;

export function reviewOutcomes(status: ScopeStatus) {
  return conclusions.filter(outcome => status === "Uncertain" || outcome !== "Provenance unresolved");
}

function classify(entry: RegisterEntry, certificate: Certificate): { status: ScopeStatus; basis: string } {
  if (entry.instrument && entry.instrument !== certificate.instrument)
    return { status: "Excluded", basis: "Different instrument" };
  if (entry.captured && (entry.captured < certificate.since || entry.captured > certificate.through))
    return { status: "Excluded", basis: "Capture outside affected period" };
  if (!entry.instrument || !entry.captured)
    return { status: "Uncertain", basis: [!entry.instrument && "Instrument missing", !entry.captured && "Capture date missing"].filter(Boolean).join(" · ") };

  return { status: "Matched", basis: "Same instrument and affected capture date" };
}

// The evidence identity, recovered provenance and QA assignment are joined once, for both reads and writes.
export function inspections(work: RecallCase, { workspace, tasks }: ToolContext) {
  const certificate = work.data;
  const archive = new Map(workspace.evidence.map(record => [record.id, record]));
  const history = work.history;
  const findings = history.filter(event => event.kind === "recall.reviewed");
  const assigned = new Map(tasks.filter(task => task.tool === work.tool && task.caseId === work.id)
    .map(task => [task.sourceId, task]));

  return certificate.entries.map(entry => {
    const record = archive.get(entry.evidenceId);
    const evidence = sameUnit(record?.unit, entry) ? record : undefined;
    const task = assigned.get(entry.evidenceId);
    const request = task && history.find(event => event.id === task.eventId && event.kind === "recall.queued");
    const queued = request?.data.inspections;
    const original = Array.isArray(queued) && queued.find(row => row?.evidenceId === entry.evidenceId &&
      sameUnit(row, entry));
    const missing = [original?.instrument === null && "instrument", original?.captured === null && "capture date"]
      .filter(Boolean).join(" and ");
    const decisions = task ? findings.filter(event => event.data.taskId === task.id).reverse() : [];
    const recovered = findings.findLast(({ data }) => data.certificate === certificate.corrected &&
      data.evidenceId === entry.evidenceId && data.serial === entry.serial && data.revisionId === entry.revisionId &&
      typeof data.provenanceSource === "string")?.data;
    const source = {
      ...entry,
      instrument: entry.instrument ?? (typeof recovered?.instrument === "string" ? recovered.instrument : null),
      captured: entry.captured ?? (typeof recovered?.captured === "string" ? recovered.captured : null),
    };
    const match = evidence ? classify(source, certificate)
      : { status: "Uncertain" as const, basis: "Evidence identity could not be verified" };
    const reviewProblem = !original || request?.data.certificate !== certificate.corrected
      ? "The assignment does not identify this certificate edition. Check the original review request."
      : !evidence || !sameUnit(task?.unit, entry)
        ? "The assignment no longer matches its archived evidence."
        : undefined;

    return {
      ...source, ...match, evidence, task, decisions, request, missing, reviewProblem,
      assignable: Boolean(evidence && !task && match.status !== "Excluded"),
    };
  });
}

export function isRecallCase(record: WorkCase): record is RecallCase {
  return record.tool === "recall";
}

export function decide(context: ToolContext, command: ToolCommand): WorkWrite | string {
  const work = command.dossier;
  if (!isRecallCase(work)) return "The certificate or evidence archive is unavailable.";
  const rows = inspections(work, context);
  const note = entryText(command.data.note, 600);
  if (!note) return "Enter a review note of 1 to 600 characters.";

  if (command.action === "queue") {
    const { evidenceIds, ownerId } = command.data;
    const owner = context.workspace.users.find(user => user.id === ownerId && isQAReviewer(user));
    if (!owner) return "Choose a QA reviewer.";
    if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > rows.length || new Set(evidenceIds).size !== evidenceIds.length)
      return "Select one or more distinct inspections.";
    const byEvidence = Map.groupBy(rows, row => row.evidenceId);
    const inspections = [];
    const tasks: NonNullable<WorkWrite["tasks"]> = [];
    for (const id of evidenceIds) {
      const row = byEvidence.get(id)?.[0];
      if (row?.task) return "An inspection in this selection has already been assigned.";
      if (!row?.assignable || !row.evidence) return "A selected inspection is outside this recall or cannot be linked to its evidence.";
      const { evidence, evidenceId, serial, revisionId, captured, instrument, status, basis } = row;
      inspections.push({ evidenceId, serial, revisionId, captured, instrument, status, basis, archivedDecisionId: evidence.review?.id ?? null });
      tasks.push({
        section: "verification", sourceId: evidenceId, unit: evidence.unit, owner: owner.id,
        title: `${status === "Uncertain" ? "Trace inspection provenance" : "Review recalled inspection"} · ${evidence.title}`,
      });
    }
    return {
      kind: "recall.queued", title: `Assigned ${tasks.length} inspection${tasks.length === 1 ? "" : "s"} for QA review`,
      data: { certificate: work.data.corrected, owner: owner.name, ownerId: owner.id, note, inspections },
      tasks,
    };
  }
  if (command.action === "resolve") {
    const row = rows.find(row => row.task && row.task.id === command.data.taskId);
    const task = row?.task;
    if (!task || task.completedAt) return "Choose an open assignment from this recall.";
    if (row.reviewProblem) return row.reviewProblem;
    if ((command.data.previousReview ?? null) !== (row.decisions[0]?.id ?? null))
      return "A newer QA finding was recorded. Close and reopen the review to see it.";
    const outcome = reviewOutcomes(row.status).find(choice => choice === command.data.outcome);
    if (!outcome)
      return "Choose an outcome that applies to this inspection.";
    let recovered: { instrument: string; captured: string; provenanceSource: string } | undefined;
    if (row.status === "Uncertain" && outcome !== "Provenance unresolved") {
      const source = entryText(command.data.source, 160);
      const instrument = row.instrument ?? command.data.instrument;
      const captured = row.captured ?? command.data.captured;
      if (!source) return "Cite the register or attachment identifying the missing provenance.";
      if (typeof instrument !== "string" || !work.data.entries.some((entry) => entry.instrument === instrument))
        return "Choose the instrument identified in the source.";
      if (typeof captured !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(captured) ||
          !Number.isFinite(Date.parse(captured)) || new Date(captured).toISOString().slice(0,10) !== captured ||
          (row.evidence?.recordedAt && captured > row.evidence.recordedAt.slice(0,10)))
        return "Enter a valid capture date on or before the archived record date.";
      if (outcome === "Impact documented" && classify({ ...row, instrument, captured }, work.data).status === "Excluded")
        return "This instrument and capture date are outside the correction. Review the outcome.";
      recovered = { instrument, captured, provenanceSource: source };
    }
    return {
      kind: "recall.reviewed", title: `${row.serial} · ${outcome}`,
      completeTaskIds: outcome === "Provenance unresolved" ? undefined : [task.id],
      data: { taskId: task.id, evidenceId: row.evidenceId, serial: row.serial, revisionId: row.revisionId, certificate: work.data.corrected, outcome, note, ...recovered },
    };
  }

  return "Unknown recall action.";
}
