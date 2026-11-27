import { catalogUnits, isCatalogArchived, projectById, revisionLabel, type Catalog, type CatalogList, type CatalogFilters } from "@/components/catalog/store";
import { missionIndex } from "@/components/operations/fleet/index-records";
import { studyScope } from "@/lib/archives/study";
import { combinedItemDetails, type ItemSelection } from "@/components/workspace/selection";
import { readPublicReferences } from "@/db/catalog";
import type { Reader } from "@/db/connection";
import { matchingSources, type AskContext, type AskSource } from "../sources";

export const catalogViews = ["projects", "systems", "revisions", "units", "references"] as const;
type View = typeof catalogViews[number];

export async function catalogSources(view: View, catalog: Catalog, scope: readonly ItemSelection[], context: AskContext, database: Reader) {
  const active = context.path === "/catalog" && (context.view || "projects") === view;
  const archived = active && context.archived === "1";
  const filter: CatalogFilters = active && !archived ? { ...context, project: context.project === "" ? null : context.project } : {};
  const item = combinedItemDetails(catalog, scope);
  const revisions = item ? item.revisions : catalog.revisions;

  function source(id: string, title: string, excerpt: string, tab: CatalogList | "references", extra?: URLSearchParams): AskSource {
    const params = extra ?? new URLSearchParams();
    params.set("view", tab);
    if (archived) params.set(tab + ".archived", "1");
    return { id, title, kind: "Catalog", excerpt: excerpt.slice(0, 650),
      href: "/catalog?" + params + (extra ? "" : "#catalog-" + tab + "-" + encodeURIComponent(id)) };
  }

  let rows: AskSource[];
  switch (view) {
    case "projects":
      rows = catalog.projects.filter(project => isCatalogArchived(catalog, "project", project.id) === archived &&
        (!item || scope.includes(`project:${project.id}`) || catalog.units.some(u => u.projectId === project.id && item.members.some(m => m.serial === u.serial))) &&
        (!filter.system || project.revisionIds.some(id => catalog.revisions.some(r => r.id === id && r.systemId === filter.system && !isCatalogArchived(catalog,"system",r.systemId)))))
        .map(p => source(p.id, p.title, [p.customer, p.description].filter(Boolean).join(" · "), "projects"));
      break;
    case "systems":
      rows = catalog.systems.filter(s => isCatalogArchived(catalog, "system", s.id) === archived &&
        (!item || scope.includes(`system:${s.id}`) || revisions.some(r => r.systemId === s.id)) &&
        (!filter.project || projectById(catalog, filter.project)?.revisionIds.some(id => catalog.revisions.some(r => r.id === id && r.systemId === s.id))))
        .map(s => source(s.id, s.title, s.description ?? "", "systems"));
      break;
    case "revisions":
      rows = revisions.filter(r => !isCatalogArchived(catalog,"system",r.systemId) && (!context.revisions || r.systemId === context.revisions) && (!context.files || r.id === context.files))
        .map(r => source(r.id, revisionLabel(catalog, r), [r.version, ...catalog.projects.filter(p => p.revisionIds.includes(r.id)).map(p => p.title)].join(" · "), "systems", new URLSearchParams({ files: r.id })));
      break;
    case "units":
      rows = catalogUnits(catalog, filter, archived).filter(u => !item || item.members.some(m => m.serial === u.serial &&
        (m.revisionId === u.revisionId || u.configurations.some(c => c.revisionId === m.revisionId))))
        .map(u => {
          const revision = catalog.revisions.find(r => r.id === u.revisionId);
          return source(u.serial, [u.title, u.serial].filter(Boolean).join(" · "), [
            revision && revisionLabel(catalog, revision), projectById(catalog,u.projectId)?.title || "Unassigned", u.batch,
          ].filter(Boolean).join(" · "), "units");
        });
      break;
    case "references": {
      const references = await readPublicReferences(database);
      const projects = new Set(studyScope(catalog, scope).projectIds);
      const related = scope.length ? missionIndex(catalog, references)
        .filter(m => projects.has(m.id)).flatMap(m => m.reference ?? []) : references;
      rows = related.filter(r => r.id !== "dawn-heritage-index")
        .map(r => source(r.id, r.title, [r.status, r.summary].join(" · "), "references"));
      break;
    }
  }
  return active ? matchingSources(rows, context.q ?? null) : rows;
}
