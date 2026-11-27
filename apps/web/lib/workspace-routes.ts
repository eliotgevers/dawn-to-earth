import { methodIds, methods } from "@/components/verification/model";
import { unitSelection, type ItemSelection } from "@/components/workspace/selection";
import type { WorkTask } from "@/db/workflows/cases";

export const sectionLabels: Record<string, string> = {
  "/operations": "Operations", "/catalog": "Catalog", "/engineering": "Engineering", "/production": "Production", "/verification": "Verification",
};

export const tools = {
  traveler: { section: "production", name: "Shop-Floor Execution" },
  inventory: { section: "production", name: "Inventory & Material Movement" },
  containment: { section: "production", name: "Containment Map" },
  qualification: { section: "engineering", name: "Qualification Reuse Studio" },
  agreements: { section: "engineering", name: "Customer Scope Editor" },
  recovery: { section: "production", name: "Supplier Recovery Desk" },
  exchange: { section: "verification", name: "Evidence Exchange" },
  recall: { section: "verification", name: "Calibration Recall" },
  audit: { section: "operations", name: "Audit Replay" },
  reconciliation: { section: "production", name: "Data Reconciliation Workbench" },
  campaign: { section: "engineering", name: "Research Campaign Workspace" },
  improvement: { section: "production", name: "Production Improvement Lab" },
} as const;

export type ToolId = keyof typeof tools;

export function isToolId(value: string): value is ToolId {
  return Object.hasOwn(tools, value);
}

export function toolHref(tool: ToolId, caseId?: string, anchor?: string) {
  return (
    "/" + tools[tool].section + "/" + tool + (caseId ? "?" + new URLSearchParams({ case: caseId }) : "") +
    (anchor ? "#" + encodeURIComponent(anchor) : "")
  );
}

export function assignmentHref(task: Pick<WorkTask, "tool" | "caseId" | "sourceId" | "unit">) {
  const path = toolHref(task.tool, task.caseId);
  const scoped = task.tool === "audit" && task.unit
    ? withSelections(path, [unitSelection(task.unit.serial, task.unit.revisionId)]) : path;

  return scoped + "#" + encodeURIComponent(task.sourceId);
}

export type Section = (typeof tools)[ToolId]["section"];
export type Destination = { id: string; label: string; divider?: boolean; children?: Destination[] };
export const primary: Record<Section, Destination[]> = {
  engineering: [
    { id: "overview", label: "Overview" },
    { id: "requirement", label: "Requirements", divider: true, children: [
      { id: "requirement", label: "Records" },
      { id: "qualification", label: "Qualification" },
    ] },
    { id: "configuration", label: "Design" },
    { id: "change", label: "Changes" },
    { id: "agreements", label: "Agreements" },
    { id: "campaign", label: "Research" },
  ],
  production: [
    { id: "overview", label: "Overview" },
    { id: "planning", label: "Planning", divider: true },
    { id: "build", label: "Builds" },
    { id: "issue", label: "Issues" },
    { id: "materials", label: "Materials", divider: true, children: [
      { id: "inventory", label: "Stock" },
      { id: "containment", label: "Lot trace" },
      { id: "recovery", label: "Recovery" },
      { id: "reconciliation", label: "Reconciliation" },
    ] },
  ],
  verification: [
    { id: "overview", label: "Overview" },
    ...methodIds.map((id, index) => ({ id, label: methods[id].label, divider: index === 0 })),
    { id: "sources", label: "Sources", divider: true, children: [
      { id: "exchange", label: "Bundles" },
      { id: "recall", label: "Certificates" },
    ] },
  ],
  operations: [
    { id: "fleet", label: "Fleet" },
    { id: "aurora", label: "Aurora" },
    { id: "readiness", label: "Readiness", divider: true },
    { id: "audit", label: "Audit" },
  ],
};

// Traveler and improvement open from specific build records. All other tools use their actual navigation entry.
export function toolTab(tool: ToolId) {
  const tabs = primary[tools[tool].section];
  const entry = tool === "traveler" || tool === "improvement"
    ? tabs.find((tab) => tab.id === "build")
    : tabs.find((tab) => tab.id === tool || tab.children?.some((child) => child.id === tool));
  if (!entry) throw new Error("Missing section tab for " + tool);

  return entry;
}

// Group tabs open their first child. A tool ID is also its route segment.
function landingId(tab: Destination) {
  return tab.children?.[0].id ?? tab.id;
}

export function coreView(section: Section, view: string | null) {
  return primary[section].find((tab) => tab.id === view && !isToolId(landingId(tab)))?.id ?? primary[section][0].id;
}

export function appendSelections(url: URL, selections: readonly ItemSelection[]) {
  if (url.searchParams.has("item")) return;
  for (const item of selections) url.searchParams.append("item", item);
}

export function withSelections(path: string | URL, selections: readonly ItemSelection[]) {
  const url = typeof path === "string" ? new URL(path, "http://localhost") : path;
  appendSelections(url, selections);

  return url.pathname + url.search + url.hash;
}

export function tabHref(section: Section, tab: Destination, selections: readonly ItemSelection[]) {
  const id = landingId(tab);
  if (section === "operations" && id === "fleet") return "/operations/fleet";
  if (section === "operations" && id === "aurora") return withSelections("/operations/aurora", selections);
  if (section === "operations" && id === "readiness") return withSelections("/operations", selections);
  const path = isToolId(id)
    ? toolHref(id)
    : "/" + section + (tab.id === primary[section][0].id ? "" : "?view=" + tab.id);

  return withSelections(path, selections);
}

const toolPaths = new Set([...Object.keys(tools).map(id => toolHref(id as ToolId)), "/operations/aurora"]);
export function isToolDestination(href: string) {
  const path = href.split(/[?#]/, 1)[0];

  return toolPaths.has(path);
}
