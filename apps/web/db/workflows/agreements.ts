import { toolHref, withSelections } from "@/lib/workspace-routes";
import type { ItemSelection } from "@/components/workspace/selection";
import { entryText } from "./cases";
import type { ToolCommand, ToolContext, WorkCase, WorkEvent, WorkTask, WorkWrite } from "./cases";

export const obligationKinds = ["Requirement", "Deliverable", "Acceptance"] as const;
export type ObligationKind = (typeof obligationKinds)[number];
export type Obligation = { clauseId: string; kind: ObligationKind; instruction: string };

type ScopeAcknowledgement = { versionId: string; edition: string; source: string; by?: string };
type Document = {
  edition: string;
  receipt: string;
  received: string;
  clauses: Record<string, string>;
  acknowledgement?: ScopeAcknowledgement;
};
type Clause = { id: string; title: string; kind: ObligationKind; instruction: string };
export type Agreement = {
  reference: string;
  projectId?: string;
  documents: [Document, Document];
  clauses: Clause[];
  related: { section: "engineering" | "production" | "verification"; id: string }[];
};

/** A packet may cite an earlier notice. The version ID always identifies the filed wording. */
export function agreementConnection(
  scope: { caseId: string; versionId: string; edition: string; reference?: string },
  selections: readonly ItemSelection[] = [],
) {
  const path = toolHref("agreements", scope.caseId) + "#scope-" + encodeURIComponent(scope.versionId);

  return {
    href: withSelections(path, selections),
    label: `Agreement ${scope.reference ?? scope.versionId} · ${scope.edition}`,
    location: "Engineering · Agreements",
    identity: scope.versionId,
  };
}

export function agreementData(record: WorkCase): Agreement {
  return record.data as Agreement;
}

export function agreementRequirementIds(agreement: Agreement) {
  return (agreement.related ?? []).filter(link => link.section === "engineering").map(link => link.id);
}

export function changedClauses(agreement: Agreement, baseline = agreement.documents[0]) {
  const requested = agreement.documents[1];
  const changed = [];
  for (const clause of agreement.clauses) {
    const before = baseline.clauses[clause.id];
    const after = requested.clauses[clause.id];
    if (before === after) continue;

    const difference = before === undefined ? "Added" : after === undefined ? "Removed" : "Changed";
    changed.push({ ...clause, after, difference });
  }

  return changed;
}

export type Notice = {
  number: number;
  edition: string;
  baselineEdition?: string;
  sourceReceipts: string[];
  purpose: string;
  obligations: Obligation[];
  clauses: Record<string, string>;
};
type Outcome = {
  noticeId: string;
  decision: "Adopt notice" | "Retain baseline";
  edition: string;
  evidence: string;
  acknowledgedBy?: string;
};

export function agreementHistory(record: WorkCase) {
  const history = record.history;
  const outcomes = Map.groupBy(history.filter(event => event.kind === "agreement" || event.kind === "withdrawal"),
    event => event.data.noticeId);
  const notices = history
    .filter((e) => e.kind === "notice")
    .map(event => ({ ...event, data: event.data as Notice, outcome: outcomes.get(event.id)?.[0] }))
    .sort((a, b) => a.data.number - b.data.number);
  const adoptedNotices = notices.filter(
    ({ outcome }) => outcome?.kind === "agreement" && receiptOutcome(outcome).decision === "Adopt notice",
  );
  const adopted = adoptedNotices.at(-1);
  let baseline = agreementData(record).documents[0];
  if (adopted?.outcome) {
    const receipt = receiptOutcome(adopted.outcome);
    baseline = {
      edition: adopted.data.edition,
      clauses: adopted.data.clauses,
      receipt: receipt.evidence,
      received: adopted.outcome.at.slice(0, 10),
      acknowledgement: {
        versionId: adopted.id,
        edition: receipt.edition,
        source: receipt.evidence,
        by: receipt.acknowledgedBy,
      },
    };
  }

  return { history, notices, current: notices.at(-1), baseline, adoptedNotices };
}

export const receiptOutcome = (event: WorkEvent) => event.data as Outcome;

/** An agreed scope identifies the promised edition. Unit QA and customer packet acceptance have their own decisions. */
export function acknowledgedAgreements(cases: WorkCase[]) {
  return cases.flatMap((record) => {
    if (record.tool !== "agreements" || !record.unit) return [];
    const agreement = agreementData(record);
    const { baseline: document } = agreementHistory(record);
    const ack = document.acknowledgement;
    if (!ack?.versionId?.trim() || !ack.source?.trim() || ack.edition !== document.edition) return [];
    if (document === agreement.documents[0] && !ack.by?.trim()) return [];

    return [
      {
        unit: record.unit,
        requirementIds: agreementRequirementIds(agreement),
        scope: {
          caseId: record.id,
          reference: agreement.reference,
          projectId: agreement.projectId,
          edition: document.edition,
          versionId: ack.versionId,
          acknowledgement: ack.source,
        },
      },
    ];
  });
}

export const assignment: Record<ObligationKind, Pick<WorkTask, "owner" | "section">> = {
  Requirement: { owner: "reviewer", section: "engineering" },
  Deliverable: { owner: "technician", section: "production" },
  Acceptance: { owner: "quality", section: "verification" },
};

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const record = command.dossier;
  if (!record.unit) return "Choose an agreement with a recorded unit and revision.";
  const agreement = agreementData(record);
  const data = command.data;
  if (command.action === "complete") {
    const task = ctx.tasks.find(
      (task) => task.tool === "agreements" && task.caseId === record.id && task.id === data.taskId,
    );
    if (!task || task.completedAt) return "Choose an open obligation from this notice.";
    const outcome = entryText(data.result, 500);
    const evidence = entryText(data.evidence, 180);
    const recordId = data.recordId || null;
    if (
      recordId !== null &&
      !agreement.related.some((link) => link.section === task.section && link.id === recordId)
    )
      return "Choose a related record from this obligation’s section and unit.";
    if (!outcome || !(recordId || evidence)) return "Record the result and identify its source.";
    return {
      kind: "follow-through",
      title: `Completed: ${task.title}`,
      data: { taskId: task.id, sourceId: task.sourceId, outcome, evidence, recordId },
      completeTaskIds: [task.id],
    };
  }
  const { current, notices, baseline } = agreementHistory(record);
  if (command.action === "assemble") {
    const [original, request] = agreement.documents;
    if (current && !current.outcome) return "Record or withdraw the pending notice before preparing another.";
    if ((current?.id ?? null) !== data.previousNoticeId)
      return "The notice history changed. Reopen the agreement.";
    const purpose = entryText(data.purpose, 500);
    if (!purpose) return "Enter the reason for the notice (up to 500 characters).";
    if (!Array.isArray(data.obligations) || !data.obligations.length)
      return "Include at least one changed clause.";
    const changed = changedClauses(agreement, baseline);
    const remaining = new Map(changed.map((row) => [row.id, row]));
    const obligations: Obligation[] = [];
    const clauses = { ...baseline.clauses };
    for (const item of data.obligations) {
      const row = item && remaining.get(item.clauseId);
      if (!row) return "Choose distinct changed clauses from this agreement.";
      if (!obligationKinds.includes(item.kind)) return "Choose a valid obligation type.";
      const instruction = entryText(item.instruction, 300);
      if (!instruction) return "Enter a downstream action for every included clause (up to 300 characters).";
      remaining.delete(row.id);
      obligations.push({ clauseId: row.id, kind: item.kind, instruction });
      if (row.after === undefined) delete clauses[row.id];
      else clauses[row.id] = row.after;
    }
    const number = notices.length + 1;
    // A partial notice gets its own edition; it never purports to adopt the entire requested issue.
    const edition =
      !remaining.size ? request.edition : `${original.edition} + notice ${number}`;
    return {
      kind: "notice",
      title: `Prepared change notice ${number}`,
      data: {
        number,
        edition,
        baselineEdition: baseline.edition,
        previousNoticeId: current?.id ?? null,
        purpose,
        clauses,
        obligations,
        sourceReceipts: [baseline.receipt, request.receipt],
      },
    };
  }

  if (command.action !== "withdraw" && command.action !== "agreement")
    return "Choose an available agreement action.";
  if (!current || current.id !== data.noticeId || current.outcome)
    return "Choose the current notice awaiting a decision.";
  if (command.action === "withdraw") {
    const reason = entryText(data.reason, 500);
    if (!reason) return "Enter the reason for withdrawing this notice.";
    return {
      kind: "withdrawal",
      title: `Withdrew notice ${current.data.number}`,
      data: { noticeId: current.id, reason },
    };
  }
  const decision = data.decision;
  if (decision !== "Adopt notice" && decision !== "Retain baseline")
    return "Choose the recorded agreement.";
  const evidence = entryText(data.evidence, 180);
  if (!evidence) return "Enter the acknowledgement reference (up to 180 characters).";
  const acknowledgedBy = entryText(data.acknowledgedBy, 100);
  if (!acknowledgedBy) return "Enter the person or group named in the acknowledgement.";
  const adopt = decision === "Adopt notice";
  const edition = adopt ? current.data.edition : baseline.edition;

  return {
    kind: "agreement",
    title: `Recorded agreement to ${edition}`,
    data: {
      noticeId: current.id,
      decision,
      edition,
      evidence,
      acknowledgedBy,
    },
    tasks: adopt
      ? current.data.obligations.map((obligation) => ({
          ...assignment[obligation.kind],
          title: obligation.instruction,
          unit: record.unit,
          sourceId: `${record.id}/${obligation.clauseId}`,
        }))
      : [],
  };
}
