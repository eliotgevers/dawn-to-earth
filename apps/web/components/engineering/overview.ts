import { applicableRevisions } from "@/components/records/schema";
import type { AssemblyOverviewRow as Row } from "@/components/records/layout";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import type { readEngineering } from "@/db/records/assembly";
import { assemblyStatusTone, openChanges, type RecordUnit, isRemovedRecord, recordActivity, recordDecision } from "@/lib/records/journal";
import { recordField, recordHref, recordUnitLabel } from "@/lib/records/links";

type Assembly = Awaited<ReturnType<typeof readEngineering>>;
type Overview = Pick<Assembly, "records" | "local" | "engineeringWork">;

function changeRow(base: Omit<Row, "priority">, decision?: ReturnType<typeof recordDecision>): Row {
  const status = decision?.status ?? base.status;
  return { ...base, status, priority: openChanges.has(status) ? 0 : 3,
    ...(decision && { tone: assemblyStatusTone(status), activity: decision.recordedAt, decision: decision.description }) };
}

export function engineeringOverviewRows({ records, local, engineeringWork }: Overview, item: SelectedItem): Row[] {
  const rows: Row[] = [];
  const ids = new Set(item.recordIds);
  const work = new Map(engineeringWork.map(entry => [entry.recordId, entry]));

  const requirements = new Map<string, string>();
  for (const record of records.engineering) {
    const { id, title, status, tone, unit } = record;
    if (record.kind === "requirement") requirements.set(id, title);
    if (record.kind !== "change") continue;
    if (record.origin === "local") {
      if (!includesUnit(item, unit) || isRemovedRecord(id, local, unit)) continue;
      const activity = recordActivity(local, id, unit);
      const row = changeRow({ id, title, status, tone: assemblyStatusTone(status), scope: recordUnitLabel(unit), href: `#${id}`,
        activity: activity[0]?.recordedAt ?? record.recordedAt }, recordDecision(local, id, unit));
      if (openChanges.has(row.status)) row.next = recordField(record, "Proposed change");
      rows.push(row);
      continue;
    }
    if (!ids.has(id)) continue;
    const info = work.get(id);
    const assignment = { title, status, tone, owner: info?.owner ?? undefined, next: info?.next ?? undefined };
    const revisions = applicableRevisions(item.revisions, id, local);
    const pending: string[] = [];
    for (const { revision, members } of revisions) {
      const serials: string[] = [];
      for (const unit of members) {
        const decision = recordDecision(local, id, unit);
        if (decision) rows.push(changeRow({ ...assignment, id: decision.id, scope: recordUnitLabel(unit),
          href: recordHref("engineering", id, unit) }, decision));
        else serials.push(unit.serial);
      }
      if (serials.length) pending.push(`${serials.join(", ")} · ${revision.version}`);
      else if (!members.length) pending.push(revision.title);
    }
    if (!revisions.length) for (const scope of item.directScopes) if (scope.recordIds.includes(id)) pending.push(scope.title);
    if (pending.length) rows.push(changeRow({ ...assignment, id, href: `#${id}`, scope: pending.join(" / "),
      decision: info?.decision ?? undefined, activity: record.history?.at(-1)?.at }));
  }

  function gapApplies(requirementId: string, unit?: RecordUnit) {
    return ids.has(requirementId) && includesUnit(item, unit) && !isRemovedRecord(requirementId, local, unit);
  }
  for (const { id, kind, status, unit, history } of records.production) {
    if (kind !== "issue" || status === "Resolved") continue;
    const info = work.get(id);
    if (!info?.requirementId || !gapApplies(info.requirementId, unit) || isRemovedRecord(id, local, unit)) continue;
    const title = requirements.get(info.requirementId);
    if (title === undefined) continue;
    rows.push({ id, title, status, tone: assemblyStatusTone(status),
      href: `#${info.requirementId}`, kind: "Evidence gap", scope: recordUnitLabel(unit), next: info.next ?? undefined,
      blocker: info.blocker ?? undefined, activity: recordActivity(local, id, unit)[0]?.recordedAt ?? history?.at(-1)?.at,
      priority: 1 });
  }
  for (const { id, title, unit, gap } of records.evidence) {
    if (!gap || !gapApplies(gap.requirementId, unit)) continue;
    rows.push({ id, title, status: "Follow-up needed", tone: "amber",
      href: recordHref("verification", id, unit), kind: "Evidence gap", scope: recordUnitLabel(unit),
      next: gap.next, activity: gap.at, priority: 1 });
  }
  return rows;
}
