"use client";
import { ConnectionLink } from "@/components/records/links";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import { tools, assignmentHref } from "@/lib/workspace-routes";
import type { WorkTask } from "@/db/workflows/cases";

export function RelatedWork({
  section,
  item,
  tasks,
}: {
  section: WorkTask["section"];
  item?: SelectedItem;
  tasks: readonly WorkTask[];
}) {
  if (!item) return null;
  const scopes = new Set([
    ...item.revisions.map(revision => "revision:" + revision.id),
    ...item.directScopes.map(scope => ("revisionIds" in scope ? "project:" : "system:") + scope.id),
  ]);
  const open = tasks.filter(task => task.section === section &&
    (task.unit ? includesUnit(item, task.unit) : task.selection && scopes.has(task.selection)));
  if (!open.length) return null;
  return (
    <section className="grid gap-2.5 pt-2 wrap-anywhere mt-4">
      <h2>Assigned work</h2>
      <ul className="divide-y">
        {open.map((t) => (
          <li key={t.id} className="py-2">
            <ConnectionLink connection={{ href: assignmentHref(t), label: t.title, identity: t.unit?.serial, location: tools[t.tool].name }} />
            {t.unit && <span className="block mt-0.5 text-xs text-muted-foreground">{t.unit.serial} · {t.unit.revision}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
