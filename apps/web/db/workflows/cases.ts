import { isRemovedRecord, sameUnit, type RecordUnit } from "@/lib/records/journal";
import { isCatalogArchived } from "@/components/catalog/store";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import type { readToolContext } from "@/db/operations/tools";
import type { toolCases, toolDecisions, toolAssignments } from "@/db/schema";

export type { ToolId } from "@/lib/workspace-routes";

export type CaseRow = typeof toolCases.$inferSelect;
export type WorkCase = CaseRow & { history: WorkEvent[] };
// A dossier's roster can contain gaps. Only an exact recorded subject puts it in a scoped index.
export function caseMatches(record: WorkCase, selected: SelectedItem) {
  if (record.unit) return includesUnit(selected, record.unit);
  const { data, tool } = record;
  if (tool === "qualification") return selected.revisions.some(revision => revision.id === data.revisionId);
  if (tool === "recall") return Array.isArray(data.entries) && data.entries.some(row => includesUnit(selected, row));
  const rows = tool === "containment" ? data.installations :
    tool === "inventory" || tool === "improvement" ? data.orders : undefined;
  return Array.isArray(rows) && rows.some(row => includesUnit(selected, row?.unit));
}

export type WorkEvent = typeof toolDecisions.$inferSelect;

export type ToolContext = Awaited<ReturnType<typeof readToolContext>>;
export type WorkTask = typeof toolAssignments.$inferSelect;
// Follow-up work belongs to the decision that opened it, even if a newer case uses the same source.
export function openAssignments(event: WorkEvent | undefined, tasks: readonly WorkTask[]) {
  return event ? tasks.filter(task => task.eventId === event.id && task.caseId === event.caseId &&
    task.tool === event.tool && !task.completedAt) : [];
}

export type ToolCommand = { dossier: WorkCase; action: string; actor: string; data: Record<string, unknown> };
export function hasText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// QA assignments belong to a review role; any demo actor can still record the outcome.
export function isQAReviewer(person: { role: string }) {
  return person.role === "Reviewer" || person.role === "Quality lead";
}

// Notes and document references are user-entered and have field-specific limits.
export function entryText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value.trim() : "";

  return text.length <= limit ? text : "";
}

export type WorkWrite = {
  kind: string;
  title: string;
  data: Record<string, unknown>;
  tasks?: Pick<typeof toolAssignments.$inferInsert, "title" | "owner" | "sourceId" | "section" | "unit" | "selection">[];
  completeTaskIds?: string[];
};

// Current work uses the catalog's active unit edition. Archived decisions keep their original edition.
export function unitProblem(catalog: Pick<ToolContext["workspace"]["catalog"], "units" | "archivedRows">, unit: RecordUnit) {
  const current = catalog.units.find(candidate => candidate.serial === unit.serial);
  if (!current) return "The unit is missing from the catalog.";
  if (isCatalogArchived(catalog, "unit", unit.serial)) return "The unit is archived.";
  if (current.revisionId !== unit.revisionId) return "The unit is now assigned to another revision.";
}

export function assemblyAtUnit(workspace: ToolContext["workspace"], id: string, unit: RecordUnit) {
  if (!isRemovedRecord(id, workspace.local, unit)) {
    return workspace.assembly.find(record => record.id === id && sameUnit(record.unit, unit));
  }
}
