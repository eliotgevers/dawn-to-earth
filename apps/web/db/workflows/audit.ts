import { methods } from "@/components/verification/model";
import { isRecordUnit, sameUnit, type RecordUnit, recordActivity, isRemovedRecord } from "@/lib/records/journal";
import { recordConnection, recordLabel, type RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import { unitSelection } from "@/components/workspace/selection";
import { toolHref, withSelections } from "@/lib/workspace-routes";
import { isObject, hasText, entryText, openAssignments, type WorkCase, type ToolCommand, type ToolContext, type WorkWrite } from "./cases";

type Dossier = {
  checkId?: string;
  buildId: string;
  requirement: { id: string; expected: string };
  evidence: {
    id: string;
    source: string;
    observation: string;
    observed?: string | null;
    interval?: { start: number; end: number } | null;
    at: string;
  };
  review: { id: string; actor: string | null; at: string; decision: string; reason: string };
};
export type AuditCase = WorkCase & { unit: RecordUnit; data: Dossier };

export function isAuditCase(c: WorkCase): c is AuditCase {
  const { checkId, buildId, evidence, requirement, review } = c.data;
  if (c.tool !== "audit" || !isRecordUnit(c.unit) ||
      !isObject(evidence) || !isObject(requirement) || !isObject(review)) return false;
  const { interval } = evidence;

  return [buildId, evidence.id, evidence.source, evidence.observation, requirement.id,
    requirement.expected, review.id, review.decision, review.reason].every(hasText) &&
    (checkId === undefined || hasText(checkId)) &&
    (review.actor === null || hasText(review.actor)) &&
    (evidence.observed == null || typeof evidence.observed === "string") &&
    (interval == null || (isObject(interval) && Number.isSafeInteger(interval.start) &&
      Number.isSafeInteger(interval.end) && Number(interval.start) > 0 && Number(interval.end) >= Number(interval.start))) &&
    hasText(evidence.at) && hasText(review.at) && Date.parse(review.at) >= Date.parse(evidence.at);
}

export function auditSearchText(row: AuditCase | ToolContext["workspace"]["reviewsWithoutSnapshot"][number]) {
  return ("decision" in row
    ? [row.decision, row.id, row.reviewer, row.reason, row.unit.serial + " · " + row.unit.revision, row.source?.label, row.source?.identity]
    : [row.title, row.unit.serial, row.unit.revision, row.data.review.actor, row.data.review.decision,
      row.data.requirement.id, row.data.evidence.source, row.data.review.id]).join(" ");
}

export const subjects = { requirement: "Requirement", evidence: "Evidence", review: "Decision" } as const;
type Subject = keyof typeof subjects;
const isSubject = (v: unknown): v is Subject => typeof v === "string" && Object.hasOwn(subjects, v);

type Change = {
  id: string;
  at: string;
  title: string;
  detail: string;
  reviewer?: string | null;
  link?: RecordConnection;
};
export function replaySources(row: AuditCase, workspace: ToolContext["workspace"]) {
  const { requirement, evidence, review, buildId, checkId } = row.data;
  const { assembly, evidence: archive, local } = workspace;
  const reviewedAt = Date.parse(review.at);
  const changes = new Map<string, Change>();
  function addLater(change: Change) {
    if (Date.parse(change.at) > reviewedAt) changes.set(change.id, change);
  }
  const links: RecordConnection[] = [];
  const currentRequirement = assembly.find(r => r.kind === "requirement" && r.id === requirement.id && (!r.unit || sameUnit(r.unit, row.unit)));
  if (currentRequirement && !isRemovedRecord(requirement.id, local, row.unit)) {
    links.push(recordConnection("engineering", requirement.id, row.unit, {
      view: "Requirements", label: recordLabel("requirement", currentRequirement.reference, currentRequirement.title), identity: currentRequirement.title,
    }));
  }
  const build = assembly.find(r => (r.kind === "build" || r.kind === "queue") && r.id === buildId && (!r.unit || sameUnit(r.unit, row.unit)));
  if (build && !isRemovedRecord(buildId, local, row.unit)) links.push(recordConnection("production", buildId, row.unit, {
    view: "Builds", label: recordLabel(build.kind === "queue" ? "queue" : "build", build.reference, build.title), identity: build.title,
  }));

  const sources = checkId
    ? workspace.checks.find(check => check.id === checkId && sameUnit(check.unit, row.unit))?.captures ?? []
    : archive.filter(record => sameUnit(record.unit, row.unit) &&
        record.requirement.id === requirement.id && record.build.id === buildId);
  const sourcesById = new Map(sources.map(source => [source.id, source] as const));
  function evidenceLink(id: string) {
    const source = sourcesById.get(id);
    if (!source || isRemovedRecord(id, local, row.unit)) return;

    return recordConnection("verification", id, row.unit, {
      view: "test" in source ? methods[source.test].label : "Acceptance Review",
      label: source.recordedAt ? "Evidence · " + formatUtcDateTime(source.recordedAt) : source.source ?? "Archived evidence",
      identity: source.source,
    });
  }
  const original = evidenceLink(evidence.id);
  if (original) links.push(original);
  // Later reviews may reference the original even after the live archive entry is gone.
  for (const r of sources) {
    if (r.id !== evidence.id && r.recordedAt)
      addLater({
        id: r.id, at: r.recordedAt, title: "Evidence filed", detail: r.observation ?? "",
        link: evidenceLink(r.id),
      });
  }
  const originalSource = sourcesById.get(evidence.id);
  const method = originalSource && "test" in originalSource ? originalSource.test : undefined;
  const methodReviews = workspace.reviews.filter(r => r.test === method &&
    r.scope?.selection === unitSelection(row.unit.serial) && r.scope.revision === row.unit.revisionId &&
    r.evidenceIds.some(id => id === evidence.id || sourcesById.has(id)));
  const signedSources = [
    ...sources.flatMap(r => r.review ? [{ signed: r.review, sourceId: r.id }] : []),
    ...methodReviews.map(r => ({ signed: r, sourceId: r.evidenceIds.length === 1 ? r.evidenceIds[0] : undefined })),
  ];
  for (const { signed, sourceId } of signedSources) {
    if (signed.id === review.id) continue;
    addLater({
      id: signed.id,
      at: signed.recordedAt,
      title: signed.decision,
      detail: signed.reason,
      reviewer: "reviewer" in signed ? signed.reviewer ?? null : null,
      link: "auditCaseId" in signed && signed.auditCaseId
        ? { href: withSelections(toolHref("audit", signed.auditCaseId), [unitSelection(row.unit.serial, row.unit.revisionId)]), label: "Audit decision · " + formatUtcDateTime(signed.recordedAt), location: "Operations · Audit", identity: signed.id }
        : sourceId ? evidenceLink(sourceId) : undefined,
    });
  }
  for (const [id, subject] of [
    [requirement.id, "Requirement"],
    [evidence.id, "Evidence"],
  ] as const) {
    for (const r of recordActivity(local, id, row.unit)) {
      const action = r.action?.type;
      if (action !== "edit" && action !== "revise" && action !== "remove") continue;
      addLater({
        id: r.id,
        at: r.recordedAt,
        title:
          subject + (action === "remove" ? " removed" : action === "revise" ? " revision proposed" : " edited"),
        detail: r.description,
      });
    }
  }
  for (const event of currentRequirement?.history ?? []) {
    addLater({
      id: [requirement.id, event.at, event.actor, event.title].join(":"),
      at: event.at,
      title: event.title,
      detail: [event.note, event.actor].filter(Boolean).join(" · "),
    });
  }

  return {
    links,
    requirementRef: currentRequirement?.reference,
    changes: [...changes.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)),
  };
}

const findingStages = new Map<string, { status: string; next: "respond" | "review" | null }>([
  ["finding-raised", { status: "Awaiting response", next: "respond" }],
  ["finding-returned", { status: "Returned to owner", next: "respond" }],
  ["finding-answered", { status: "Awaiting closure review", next: "review" }],
  ["finding-closed", { status: "Closed", next: null }],
]);

export function findingHistory(row: AuditCase, tasks: ToolContext["tasks"] = []) {
  const entries = row.history.filter(event => hasText(event.data.findingId));

  return Array.from(Map.groupBy(entries, event => event.data.findingId), ([id, history]) => {
    const first = history[0];
    const last = history[history.length - 1];
    const stage = findingStages.get(last.kind);
    const task = stage?.next && openAssignments(last, tasks).find(task => task.sourceId === id && sameUnit(task.unit, row.unit));

    return { id, history, first, last, stage, task };
  });
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const row = command.dossier;
  if (!isAuditCase(row)) return "Choose an archived decision.";
  const { action, data } = command;
  const { review } = row.data;
  if (data.decisionId !== review.id || data.unit !== row.unit.serial || data.revision !== row.unit.revisionId)
    return "The decision, unit or revision changed. Reopen this replay.";
  const reason = entryText(data.reason, 1200);
  if (!reason) return "Enter a note of up to 1,200 characters.";
  const histories = findingHistory(row, ctx.tasks);
  const scope = { decisionId: review.id, unit: row.unit.serial, revision: row.unit.revisionId };
  const users = ctx.workspace.users;
  const task = (owner: string, findingId: string, title: string) => ({
    title,
    owner,
    unit: row.unit,
    sourceId: findingId,
    section:
      owner === "reviewer"
        ? ("engineering" as const)
        : owner === "technician"
          ? ("production" as const)
          : ("verification" as const),
  });
  if (action === "raise") {
    const { subject, owner } = data;
    if (!isSubject(subject)) return "Choose a record for the finding.";
    if (!hasText(owner) || !users.some((u) => u.id === owner)) return "Choose a known follow-up owner.";
    const sourceId = row.data[subject].id;
    if (data.sourceId !== sourceId) return "The finding must cite the selected record in this replay.";
    const prior = histories.filter(({ first }) => first.data.subject === subject);
    const normalized = (value: unknown) => String(value).trim().replace(/\s+/g, " ").toLowerCase();
    if (prior.some(({ first }) => normalized(first.data.reason) === normalized(reason)))
      return "This finding has already been recorded.";
    const findingId = "finding-" + crypto.randomUUID();
    return {
      kind: "finding-raised",
      title: "Audit finding raised",
      data: { ...scope, subject, sourceId, findingId, owner, reason },
      tasks: [task(owner, findingId, "Respond to audit finding · " + subjects[subject])],
    };
  }
  const finding = histories.find(entry => entry.id === data.findingId);
  if (!finding?.stage?.next || data.previousId !== finding.last.id)
    return "This finding changed. Reopen the current action.";
  const { first, task: work, stage } = finding;
  if (!work) return "The assignment is no longer open for this unit and revision.";
  const subject = first.data.subject;
  const findingId = first.data.findingId;
  const owner = first.data.owner;
  if (!isSubject(subject) || !hasText(findingId) || !hasText(owner)) return "The original finding is unavailable.";
  const base = { ...scope, findingId, subject, sourceId: first.data.sourceId, reason };
  const completeTaskIds = [work.id];
  if (action === "respond" && stage.next === "respond") {
    const reference = entryText(data.reference, 200);
    if (!reference) return "Cite the follow-up document or archive reference.";
    return {
      kind: "finding-answered",
      title: "Follow-up submitted",
      data: { ...base, reference },
      completeTaskIds,
      tasks: [task("quality", findingId, "Review audit response · " + subjects[subject])],
    };
  }
  if (stage.next !== "review" || (action !== "close" && action !== "return"))
    return "The requested action does not match this finding’s current stage.";

  return action === "close"
    ? { kind: "finding-closed", title: "Audit finding closed", data: base, completeTaskIds }
    : {
        kind: "finding-returned",
        title: "Follow-up returned",
        data: base,
        completeTaskIds,
        tasks: [task(owner, findingId, "Revise audit response · " + subjects[subject])],
      };
}
