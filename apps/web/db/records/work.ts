import { arrayOverlaps, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { affectsEvidence, methods, reviewActor, reviewApplies, reviewStep, type EvidenceRecord, type EvidenceReview, type ReviewRole, type ReviewTarget } from "@/components/verification/model";
import { recordHref } from "@/lib/records/links";
import type { Reader, WorkspaceDatabase } from "../connection";
import { revisionReviews, toolAssignments, users, workItems } from "../schema";
import { assignmentHref, tools } from "@/lib/workspace-routes";

type WorkItem = typeof workItems.$inferSelect;

export function readActors(db: Reader, id?: string) {
  return db.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(id === undefined ? undefined : sql`${users.id} = ${id}`).orderBy(asc(users.position));
}

export function reviewers(actors: Awaited<ReturnType<typeof readActors>>) {
  return actors.filter((person): person is typeof person & {id: ReviewRole} => person.id !== "research-partner");
}

export const workDestination = { title: workItems.title, href: workItems.href, actionLabel: workItems.actionLabel };

export async function readHome(db: Reader) {
  const [users, work, impact, tasks] = await Promise.all([
    readActors(db),
    db.select({ ...workDestination, method: workItems.method, id: workItems.id, assigneeId: workItems.assigneeId, waitingUserIds: workItems.waitingUserIds,
      reason: workItems.reason, priority: workItems.priority }).from(workItems).where(isNull(workItems.completedAt)).orderBy(
      sql`case ${workItems.priority} when 'urgent' then 0 when 'follow_up' then 1 else 2 end`, asc(workItems.title)),
    db.select({
      id: revisionReviews.id, owner: revisionReviews.owner, reason: revisionReviews.reason,
      serial: revisionReviews.serial, revisionId: revisionReviews.revisionId, changeId: revisionReviews.changeId,
    }).from(revisionReviews).where(isNull(revisionReviews.completedAt)).orderBy(desc(revisionReviews.createdAt)),
    db.select({
      id: toolAssignments.id, title: toolAssignments.title, owner: toolAssignments.owner, unit: toolAssignments.unit,
      tool: toolAssignments.tool, caseId: toolAssignments.caseId, sourceId: toolAssignments.sourceId,
    }).from(toolAssignments).where(isNull(toolAssignments.completedAt)),
  ]);

  return {
    users,
    items: [
      ...work.map(({ method, ...item }) => ({ ...item, location: "Verification · " + methods[method].label })),
      ...impact.map(({ id, owner, reason, serial, revisionId, changeId }) => ({
        id, title: "Change impact · " + serial, assigneeId: owner, waitingUserIds: [],
        reason, priority: "follow_up" as const, actionLabel: "Review assigned change", location: "Engineering · Changes",
        href: recordHref("engineering", changeId, { serial, revisionId }, { impact: id }),
      })),
      ...tasks.map(task => ({
        id: task.id, title: task.title, assigneeId: task.owner, waitingUserIds: [],
        reason: task.unit ? task.unit.serial + " · " + task.unit.revision : "",
        priority: "follow_up" as const, actionLabel: "Open assignment", location: tools[task.tool].name, href: assignmentHref(task),
      })),
    ],
  };
}

// A live review and a replayed review must advance the same exact task.
export function reviewWorkChange(
  item: WorkItem,
  review: EvidenceReview,
  findEvidence: (id: string) => EvidenceRecord | undefined,
) {
  if (!review.scope || !affectsEvidence(review) || review.test !== item.method || !reviewApplies(review, item)) return;

  const linked = new Set(item.evidenceIds);
  const id = review.evidenceIds.find(id => linked.has(id));
  const record = id && findEvidence(id);
  if (!record) return;

  const assigneeId = reviewStep(review);
  const complete = review.decision === "Pass" || review.decision === "Not applicable" || review.decision === "Approved";
  const retest = assigneeId === "technician" ? record.capture?.handoffId : undefined;

  return {
    assigneeId,
    waitingUserIds: complete ? [] : [...new Set([
      ...(item.completedAt ? [] : item.waitingUserIds),
      reviewActor(review.decision),
    ])].filter((id) => id !== assigneeId),
    reason: review.reason,
    href: recordHref("verification", retest ?? record.id, record.unit),
    priority: assigneeId === "reviewer" ? "follow_up" as const : "urgent" as const,
    actionLabel: retest ? "Open retest handoff" : assigneeId === "quality" ? "Open exception evidence"
      : assigneeId === "technician" ? "Open follow-up evidence"
        : record.capture?.replaces ? "Review retest evidence" : "Review evidence",
    completedAt: complete ? review.recordedAt : null,
  };
}

export async function advanceReviewWork(
  db: Pick<WorkspaceDatabase, "select" | "update">,
  review: EvidenceReview,
  targets: readonly ReviewTarget[],
) {
  if (!review.evidenceIds.length || !affectsEvidence(review)) return;

  const items = await db.select().from(workItems)
    .where(arrayOverlaps(workItems.evidenceIds, [...review.evidenceIds]));
  const evidence = new Map(targets.map(target => [target.id, target.record]));

  await Promise.all(items.map(item => {
    const change = reviewWorkChange(item, review, id => evidence.get(id));
    if (change) return db.update(workItems).set(change).where(eq(workItems.id, item.id));
  }));
}
