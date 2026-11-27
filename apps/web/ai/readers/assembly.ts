import { combinedItemDetails, type ItemSelection } from "@/components/workspace/selection";
import { withSelections } from "@/lib/workspace-routes";
import { db } from "@/db/connection";
import type { AskSource } from "../sources";
import { engineeringRows } from "@/components/records/schema";
import { engineeringOverviewRows } from "@/components/engineering/overview";
import { engineeringDetails } from "@/components/engineering/records";
import { productionRegister } from "@/components/production/builds";
import { readEngineering, readProduction } from "@/db/records/assembly";
import { filedReference, recordHref } from "@/lib/records/links";

export const assembly = ["requirement", "change", "component", "interface", "issue", "build", "engineering-overview", "production-overview"] as const;
type AssemblyView = typeof assembly[number];

export function assemblyReader(scope: readonly ItemSelection[]) {
  let engineering: ReturnType<typeof readEngineering> | undefined;
  let production: ReturnType<typeof readProduction> | undefined;

  return async (view: AssemblyView): Promise<AskSource[]> => {
    const productionView = view === "issue" || view === "build" || view === "production-overview";
    if (!db) throw new Error("Workspace unavailable");
    const data = productionView ? await (production ??= readProduction(db)) : await (engineering ??= readEngineering(db));
    const item = combinedItemDetails(data.records.catalog, scope);
    if (!item) return [];

    if ("execution" in data) {
      const register = productionRegister(data, item, view === "production-overview" ? "overview" : view);
      return (register?.rows ?? []).map(row => ({
        id: row.id, ref: filedReference(row.record.reference), kind: "Production",
        title: [filedReference(row.record.reference), row.title].filter(Boolean).join(" · "),
        excerpt: [row.status, row.owner, row.blocker, row.next, row.decision].filter(Boolean).join(" · "),
        href: recordHref("production", row.id, row.record.unit ?? data.records.verification.article),
      }));
    }
    if (view === "engineering-overview") {
      return engineeringOverviewRows(data, item).map(row => ({
        id: row.id, kind: "Engineering", title: row.title,
        excerpt: [row.status, row.scope, row.owner, row.next, row.decision, row.blocker].filter(Boolean).join(" · "),
        href: row.href.startsWith("#") ? withSelections("/engineering" + row.href,scope) : row.href,
      }));
    }

    const kind = view === "requirement" || view === "change" ? view : "configuration";
    const rows = engineeringRows(data.records.engineering, kind, view === "interface", item, data.records.verification.article, data.local);
    return rows.map(({ record, revision, decision, status }) => {
      const details = engineeringDetails({ record, kind, item, revision, decision, seed: data.records, local: data.local });
      const fields = [...details.primary, ...details.metadata].flatMap(([label, value]) =>
        typeof value === "string" && value ? [label + ": " + value] : []);
      return {
        id: record.id, ref: filedReference(record.reference), kind: "Engineering",
        title: [filedReference(record.reference), revision?.title ?? record.title].filter(Boolean).join(" · "),
        excerpt: [status,...fields].join(" · "),
        href: withSelections(recordHref("engineering", record.id), scope),
      };
    });
  };
}
