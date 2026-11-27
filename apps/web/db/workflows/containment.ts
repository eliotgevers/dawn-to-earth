import { isQAReviewer, isObject, hasText, entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkWrite } from "./cases";
import type { RecordUnit } from "@/lib/records/journal";

type Installation = {
  id: string;
  unit: RecordUnit;
  buildId: string;
  stage: "In production" | "Delivered";
  recordedLot: string | null;
  source: string;
};

export type Lot = {
  lotId: string;
  notice: string;
  receiptCaseId?: string;
  reason: string;
  installations: Installation[];
};

type Source = { tool?: "inventory" | "exchange"; lotId: string; eventId: string; caseId: string; fileId: string; receiptTitle?: string };
export type TraceRow = Installation & {
  state: "Recorded match" | "Unconfirmed" | "Different lot" | "Conflicting records";
  lots: string[];
  imports: Source[];
};

export function traceLot(record: WorkCase, events: readonly WorkEvent[]) {
  const lot = record.data as Lot;
  // A source register can be cited for several units. Attach each receipt to its exact edition.
  const installations = lot.installations.map(row => ({ ...row, imports: [] as Source[] }));
  const byRegister = Map.groupBy(installations, row => row.id);
  for (const event of events) {
    const inventory = event.tool === "inventory" && event.kind === "installation-recorded";
    if (!inventory && !(event.tool === "exchange" && event.kind === "bundle-imported")) continue;
    if (!Array.isArray(event.data.lotCorrections)) continue;
    for (const claim of event.data.lotCorrections) {
      if (!isObject(claim) || typeof claim.sourceId !== "string" ||
        !hasText(claim.fileId) || !hasText(claim.lotId)) continue;
      for (const installation of byRegister.get(claim.sourceId) ?? []) {
        if (installation.unit.serial !== claim.serial || installation.unit.revisionId !== claim.revisionId) continue;
        installation.imports.push({
          ...(inventory && { tool: "inventory" as const }),
          lotId: claim.lotId, eventId: event.id, caseId: event.caseId, fileId: claim.fileId, receiptTitle: event.title,
        });
      }
    }
  }
  const rows = installations.map((installation): TraceRow => {
    const { imports } = installation;
    imports.sort((a, b) => a.eventId.localeCompare(b.eventId) || a.fileId.localeCompare(b.fileId));
    const lots = [
      ...new Set([
        ...(installation.recordedLot ? [installation.recordedLot] : []),
        ...imports.map((source) => source.lotId),
      ]),
    ].sort();
    const state =
      lots.length > 1
        ? "Conflicting records"
        : !lots.length
          ? "Unconfirmed"
          : lots[0] === lot.lotId
            ? "Recorded match"
            : "Different lot";

    return { ...installation, state, lots };
  });
  const stamp = JSON.stringify(
    rows.map(({ id, unit, stage, source, state, lots, imports }) => [
      id,
      unit.serial,
      unit.revisionId,
      stage,
      source,
      state,
      lots,
      imports.map(({ lotId, eventId, caseId, fileId }) => ({ lotId, eventId, caseId, fileId })),
    ]),
  );
  const { lotId, notice, reason, receiptCaseId } = lot;

  return { lotId, notice, reason, receiptCaseId, rows, stamp };
}

export function submittedScope(event?: WorkEvent): TraceRow[] {
  return Array.isArray(event?.data.scope) ? event.data.scope : [];
}

export function lotReview(record: WorkCase, events: readonly WorkEvent[]) {
  const trace = traceLot(record, events);
  const history = record.history;
  const latest = history.at(-1);
  const submission =
    latest?.kind === "scope-submitted" ? latest : history.find((event) => event.id === latest?.data.submissionId);
  let status: "Trace installations" | "Trace updated" | "Awaiting QA" | "Scope confirmed" | "Scope returned" =
    "Trace installations";
  if (submission && submission.data.stamp !== trace.stamp) status = "Trace updated";
  else if (latest?.kind === "scope-submitted") status = "Awaiting QA";
  else if (latest?.kind === "scope-confirmed") status = "Scope confirmed";
  else if (latest?.kind === "scope-returned") status = "Scope returned";

  return { trace, history, latest, submission, status };
}

export function decide(context: ToolContext, command: ToolCommand): WorkWrite | string {
  const record = command.dossier;
  const { trace, latest, submission, status } = lotReview(record, context.relatedEvents);
  if (command.data.previousEventId !== (latest?.id ?? null))
    return "The review changed. Refresh and check its latest decision.";
  if (command.data.stamp !== trace.stamp)
    return "The installation evidence changed. Recheck the trace before continuing.";
  const note = entryText(command.data.note, 2000);
  if (!note) return "Enter a reason of up to 2,000 characters.";

  const reviewTasks = latest?.kind === "scope-submitted"
    ? openAssignments(latest, context.tasks).map(task => task.id)
    : [];
  if (command.action === "request-review") {
    if (status === "Awaiting QA") return "This scope is already with QA.";
    const ids = command.data.installationIds;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string"))
      return "Select one or more distinct installation records.";
    const selectedIds = new Set(ids);
    const scope = trace.rows.filter((row) => selectedIds.has(row.id) && row.state !== "Different lot");
    if (scope.length !== ids.length)
      return "Only installations with a matching or unresolved lot can enter this scope.";
    const prior = submittedScope(submission);
    if (status === "Scope confirmed" && prior.length === ids.length && prior.every(row => selectedIds.has(row.id)))
      return "QA has already confirmed these installations against the current trace.";
    const owner = context.workspace.users.find((user) => user.id === command.data.owner && isQAReviewer(user));
    if (!owner) return "Choose a QA owner.";
    return {
      kind: "scope-submitted",
      title: `Review containment scope for ${trace.lotId}`,
      data: { lotId: trace.lotId, note, owner: owner.id, stamp: trace.stamp, scope },
      tasks: scope.map((row) => ({
        section: "verification",
        title: `Review lot trace for ${row.unit.serial}`,
        owner: owner.id,
        unit: row.unit,
        sourceId: row.id,
      })),
      completeTaskIds: reviewTasks,
    };
  }
  if (command.action !== "review-scope") return "Unknown containment action.";
  if (latest?.kind !== "scope-submitted") return "Choose a submitted scope to review.";
  if (status === "Trace updated")
    return "The submitted scope predates a changed trace. Submit an updated scope.";
  const outcome = command.data.outcome;
  if (outcome !== "Confirmed" && outcome !== "Returned") return "Choose a scope decision.";

  return {
    kind: outcome === "Confirmed" ? "scope-confirmed" : "scope-returned",
    title: outcome === "Confirmed" ? "Containment scope confirmed" : "Containment scope returned",
    data: { submissionId: latest.id, note, outcome },
    completeTaskIds: reviewTasks,
  };
}
