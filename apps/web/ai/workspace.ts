import { createHash } from "node:crypto";
import { assembly, assemblyReader } from "./readers/assembly";
import { combinedItemDetails, scopeSource, unitSelection, type ItemSelection } from "@/components/workspace/selection";
import { db } from "@/db/connection";
import { isToolId, tools, withSelections } from "@/lib/workspace-routes";
import { matchingSources, type AskContext, type AskSource } from "./sources";
import { catalogViews, catalogSources } from "./readers/catalog";
import { workbenchSources } from "./readers/workbench";
import { operationSources } from "./readers/operations";
import { verificationSources } from "./readers/verification";
import { loadCatalog } from "@/db/catalog";
import { readTimeline } from "@/db/records/timeline";
import { loadWikiIndex, readWikiArticle } from "@/components/panel/wiki-files";
import { interfaceCompareHref, studyScope } from "@/lib/archives/study";
import { interfaces, sourceFor } from "@/lib/archives/docking";
import { categories } from "@/components/panel/tool-directory";
import type { Catalog } from "@/components/catalog/store";

const operations = ["readiness", "fleet", "flight", "recordings", "calendar", "service", "planning"] as const;
const verification = ["verification-overview", "evidence", "acceptance", "acceptance-history", "review", "verification-sources", "verification-comparison"] as const;
const workbenches = Object.keys(tools) as (keyof typeof tools)[];
export const registers = [...assembly, ...operations, ...verification, ...catalogViews, ...workbenches,
  "Wiki", "Timeline", "Catalog", "Compare", "Tools"] as const;
type View = typeof registers[number];

const contains = <T extends string>(values: readonly T[], key: string): key is T => values.some(value => value === key);

function openId(view: View, page: AskContext) {
  const path = page.path;
  if (view === "Wiki") return page.wikiId;
  if (view === "Timeline" || view === "Tools") return;
  if (isToolId(view)) return path === "/" + tools[view].section + "/" + view ? page.case : undefined;
  if (view === "Catalog" || contains(catalogViews,view)) return path === "/catalog"
    ? page.files ?? page.id?.replace(/^catalog-(projects|systems|units|references)-/, "") ?? page.revisions : undefined;
  if (view === "Compare") return path === "/engineering" ? page.feature ?? page.compare : undefined;
  if (contains(verification,view)) return path === "/verification" ? page.finding ?? page.id : undefined;
  if (view === "fleet") return path === "/operations/fleet" ? page.sat ?? page.program : undefined;
  if (view === "calendar") return path === "/operations/aurora" ? page.day ?? page.month : undefined;
  if (view === "recordings") return path === "/operations/aurora" ? page.finding ?? page.pair : undefined;
  if (view === "service" && path === "/operations/aurora" && page.record) return page.document ?? page.record;
  if (view === "service" || view === "flight") return path === "/operations/aurora" ? page.document ?? page.id ?? page.flight : undefined;
  if (view === "planning") return path === "/production" ? page.id ?? page.scenario : undefined;
  if (view === "readiness") return path === "/operations" ? page.id : undefined;
  const production = view === "issue" || view === "build" || view === "production-overview";
  return path === (production ? "/production" : "/engineering") ? page.id : undefined;
}

export function workspaceReader(scope: readonly ItemSelection[], context: AskContext = {}) {
  const assemblyRecords = assemblyReader(scope);
  let catalogRead: Promise<Catalog> | undefined;
  const catalog = () => {
    if (!db) throw new Error("Database unavailable");
    return catalogRead ??= loadCatalog(db);
  };

  async function read(view: View, query: string | null, method?: string | null, offset = 0, before?: string | null) {
    const selection = view === "Timeline" ? context.timelineScope ?? scope : scope;
    const current = query?.toLowerCase() === "current";
    const filter = current ? openId(view, context) : query;
    const matching = (rows: AskSource[]) => matchingSources(rows, filter ?? null);
    const list = (rows: AskSource[], label: string, article?: string) => {
      if (rows.length === 1 && rows[0].handoff) return { summary: rows[0].excerpt, sources: rows };
      const found = matching(rows);
      if (filter && !found.length && rows.length) {
        return { summary: `${label} has ${rows.length} entries in scope. None matched that record search. Use query=null to list the entries for the selected item.`, sources: [] };
      }
      const page = found.slice(offset,offset + 8);
      const range = offset >= found.length && offset > 0 ? " No more entries on this page." :
        found.length > 8 ? ` Showing entries ${offset + 1}–${offset + page.length}.` : "";
      return { summary: `${label} · ${found.length} matching entries.${range}`,
        sources: page.map(s => ({ ...s, excerpt: s.excerpt.slice(0,700) })), article };
    };
    if (current && !filter) return { summary: "No individual record is open. Use query=null to list this view for the current Catalog selection.", sources: [] };

    if (view === "Wiki") {
      const index = await loadWikiIndex();
      const entries: AskSource[] = index.map(a => ({ id: a.slug, wikiId: a.id, kind: "Wiki", title: a.title, excerpt: a.summary }));
      const found = matching(entries);
      if (found.length !== 1) return list(entries, "Wiki directory; use an exact title or ID to read the full article");
      const meta = index.find(a => a.id === found[0].wikiId)!;
      const article = await readWikiArticle(meta.slug.split("/"));
      return list(found, "Wiki article", article?.markdown);
    }
    if (view === "Tools") {
      const rows = categories.flatMap(category => category.tools.map((t): AskSource => ({
        id: t.slug, kind: "Tools", panel: "Tools", title: t.name, excerpt: category.name + " · Open the interactive AeroVia tool in the side panel.",
      })));
      return list(rows, "Tools");
    }
    if (!selection.length && (contains(assembly,view) || ["Timeline","Compare","audit","readiness"].includes(view) || contains(verification,view) && view !== "verification-sources"))
      return { summary: "Select a Catalog item to read " + view + ".", sources: [] };
    if (!db) throw new Error("Database unavailable");

    const directory = await catalog();
    if (selection.some(id => !scopeSource(directory, id))) {
      return { summary: "This view’s Catalog selection is unavailable. Select the item again.", sources: [] };
    }

    const selected = combinedItemDetails(directory, selection)?.label;
    const label = [view, selected].filter(Boolean).join(" · ");
    if (contains(assembly,view)) return list(await assemblyRecords(view),label);
    if (isToolId(view)) return list(await workbenchSources(view,scope,query && !current && query !== context.case ? { ...context, case: undefined } : context), label);
    if (contains(operations,view)) return list(await operationSources(view,scope,context,filter),label);
    if (contains(verification,view)) return list(await verificationSources(view,scope,{ ...context, method: method ?? context.method }),label);
    if (view === "Catalog" || contains(catalogViews,view)) {
      const active = context.path === "/catalog" ? context.view || "projects" : undefined;
      const views = view !== "Catalog" ? [view] : active && contains(catalogViews,active) ? [active] : catalogViews.filter(v => v !== "references");
      const groups = await Promise.all(views.map(v => catalogSources(v,directory,scope,context,db!)));
      return list(groups.flat(),label);
    }
    if (view === "Compare") {
      const rows = studyScope(directory,scope,"docking").targets.flatMap(target => target.subjects.flatMap(subject => {
        const source = sourceFor(subject);
        if (!source) return [];
        const { serial, revisionId } = target.scope;
        const key = subject.split("/")[0];
        const name = interfaces.find(r => r.key === key)?.name ?? key;
        const params = new URLSearchParams({ item: serial ? unitSelection(serial,revisionId) : "revision:" + revisionId, feature: source.feature.id });
        return [{ id: source.feature.id, ref: key, kind: "Compare" as const, title: name + " · " + source.label,
          excerpt: [source.referenceRevision + ": " + source.feature.reference.description, source.proposedRevision + ": " +
            (source.feature.proposed?.description || "No archived view"), source.feature.basis].join(" · "), href: interfaceCompareHref(params,key) }];
      }));
      return list(rows,label + " · filed interface comparisons");
    }
    const { events } = await readTimeline(db, selection);
    // Some UI event keys contain the entire observation. Return a short, stable lookup ID.
    const eventId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 24);
    let earlier = events;
    if (before) {
      const index = events.findIndex(event => eventId(event.key) === before);
      if (index >= 0) {
        earlier = events.slice(0, index);
      } else {
        const time = Date.parse(before);
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(before) || !Number.isFinite(time))
          return { summary: "Choose an ISO UTC date or an event ID returned for this Timeline.", sources: [] };

        earlier = events.filter(event => Date.parse(event.at) < time);
      }
    }

    const rows = earlier.toReversed().map((event): AskSource => {
      const link = event.links.find(l => !l.unavailable && /^\/(engineering|production|verification|operations)([/?#]|$)/.test(l.href));
      const fields = { kind: "Timeline" as const, id: eventId(event.key), title: event.title, excerpt: [event.at,event.actor,event.note,link?.identity].filter(Boolean).join(" · ") };
      return link ? { ...fields, href: link.href } : { ...fields, panel: "Timeline" };
    });
    return list(rows, label);
  }

  return {
    page: context.path,
    selectionCount: scope.length,
    view: registers.find(view => view === context.view),
    async read(...args: Parameters<typeof read>) {
      try {
        return await read(...args);
      } catch {
        return { summary: `The ${args[0]} records could not be read. Try opening that view again.`, sources: [] };
      }
    },
  };
}
export type WorkspaceReader = ReturnType<typeof workspaceReader>;

export function requestedRegister(question: string) {
  return registers.find(name => new RegExp(`\\b${name}s?\\b`, "i").test(question));
}
