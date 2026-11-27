import { sameUnit, type RecordUnit } from "@/lib/records/journal";
import { hasUnitRevision, projectById, revisionLabel, type CatalogRevision, type CatalogUnit, type Catalog, type UnitConfiguration } from "@/components/catalog/store";


export type ItemSelection = `project:${string}` | `system:${string}` | `revision:${string}` | `unit:${string}`;
export function parseSelection(value: string | null): ItemSelection | null {
  return value && /^(project|system|revision|unit):[^\s:]+$/.test(value) ? value as ItemSelection : null;
}

export function parseSelections(value: unknown): ItemSelection[] {
  const entries = Array.isArray(value) ? value : [value];
  return [...new Set(entries.flatMap((entry) => {
    const selection = typeof entry === "string" ? parseSelection(entry) : null;
    return selection ? [selection] : [];
  }))];
}

type ScopedUnit = UnitConfiguration & Pick<CatalogUnit, "serial">;
export type ScopeRevision = CatalogRevision & { title: string; units: readonly ScopedUnit[] };

export type SelectedItem = {
  directScopes: readonly { id: string; title: string; description?: string; recordIds: readonly string[] }[];
  revisions: readonly ScopeRevision[];
  label: string;
  recordIds: readonly string[];
  unit?: ScopedUnit;
  members: readonly RecordUnit[];
};

export function recordUnit(unit: Pick<CatalogUnit, "serial">, revision: CatalogRevision): RecordUnit {
  return { serial: unit.serial, revisionId: revision.id, revision: revision.version };
}

// A unit may cite its historical configuration. A revision-wide requirement cannot come from a single unit.
export function requirementApplies(catalog: Pick<Catalog, "units" | "revisions">, requirementId: string, revisionId: string, unit?: RecordUnit | null) {
  const revision = catalog.revisions.find(row => row.id === revisionId);
  if (!revision) return false;
  const shared = revision.recordIds.includes(requirementId);
  if (!unit) return shared;
  if (unit.revisionId !== revisionId) return false;
  const configuration = catalog.units.find(row => row.serial === unit.serial)?.configurations.find(row => row.revisionId === revisionId);
  return !!configuration && (shared || configuration.recordIds.includes(requirementId));
}

export function revisionCoverage(revision: Omit<ScopeRevision, "title">, id: string) {
  const shared = revision.recordIds.includes(id);
  const units = revision.units.filter((unit) => shared || unit.recordIds.includes(id))
    .map((unit) => recordUnit(unit, revision));
  return { shared, units };
}

export function unitSelection(serial: string, revisionId?: string): ItemSelection {
  return `unit:${serial}${revisionId ? `@${revisionId}` : ""}`;
}

export function serialFromSelection(selection: ItemSelection) {
  return selection.slice(5).split("@")[0];
}

function unitAtRevision(unit: CatalogUnit, revisionId: string): ScopedUnit {
  const configuration = unit.configurations.find((entry) => entry.revisionId === revisionId);
  return { serial: unit.serial, revisionId, recordIds: configuration?.recordIds ?? [], history: configuration?.history ?? [] };
}

export function includesUnit(item: SelectedItem | undefined, article?: RecordUnit | null) {
  return Boolean(article && item?.members.some((member) => sameUnit(member, article)));
}

type ScopeSource = {
  label: string;
  revisionIds: readonly string[];
  direct?: SelectedItem["directScopes"][number];
  projectId?: string;
  unit?: CatalogUnit;
};

export function scopeSource(catalog: Catalog, selection: ItemSelection): ScopeSource | undefined {
  const [kind, id] = selection.split(":");
  switch (kind) {
    case "project": {
      const project = projectById(catalog, id);
      return project && { label: project.title, direct: project, revisionIds: project.revisionIds, projectId: id };
    }
    case "system": {
      const system = catalog.systems.find((entry) => entry.id === id);
      const revisionIds = catalog.revisions.filter((revision) => revision.systemId === id).map((revision) => revision.id);
      return system && { label: system.title, direct: system, revisionIds };
    }
    case "revision": {
      const revision = catalog.revisions.find((entry) => entry.id === id);
      return revision && { label: revisionLabel(catalog, revision), revisionIds: [id] };
    }
    case "unit": {
      const [serial, requested] = id.split("@");
      const unit = catalog.units.find((entry) => entry.serial === serial);
      if (!unit) return;
      const revisionId = requested || unit.revisionId;
      if (!hasUnitRevision(unit, revisionId)) return;
      const name = unit.title ?? unit.serial;
      const version = revisionId !== unit.revisionId && catalog.revisions.find((revision) => revision.id === revisionId)?.version;
      return { label: version ? `${name} · ${version}` : name, revisionIds: [revisionId], unit };
    }
  }
}

export function itemChipLabel(catalog: Catalog | undefined, selection: ItemSelection) {
  return catalog && scopeSource(catalog, selection)?.label;
}

export function selectionSummary(catalog: Catalog, selections: readonly ItemSelection[]) {
  const sources = selections.map((selection) => scopeSource(catalog, selection)).filter(source => source !== undefined);
  if (!sources.length) return;

  const single = sources.length === 1 ? sources[0] : undefined;
  return { sources, shortLabel: single?.unit?.title ?? single?.unit?.serial,
    label: single?.label ?? `${sources.length} selected items` };
}

export function combinedItemDetails(catalog: Catalog | undefined, selections: readonly ItemSelection[]): SelectedItem | undefined {
  if (!catalog) return;
  const resolved = selectionSummary(catalog, selections);
  if (!resolved) return;
  const { sources, label } = resolved;
  const directScopes = sources.flatMap(source => source.direct ?? []);
  const currentUnits = Map.groupBy(catalog.units, unit => unit.revisionId);
  const revisions = catalog.revisions.flatMap((revision): ScopeRevision[] => {
    const applicable = sources.filter(source => source.revisionIds.includes(revision.id));
    if (!applicable.length) return [];
    const candidates = applicable.flatMap(source => source.unit ?? (currentUnits.get(revision.id) ?? [])
      .filter(unit => !source.projectId || unit.projectId === source.projectId));
    const units = Array.from(new Set(candidates), unit => unitAtRevision(unit, revision.id));
    return [{ ...revision, title: revisionLabel(catalog, revision), units }];
  });

  const exact = sources.length === 1 ? sources[0].unit : undefined;
  return {
    revisions, directScopes, label,
    unit: exact && (revisions[0]?.units[0] ?? unitAtRevision(exact, sources[0].revisionIds[0])),
    recordIds: [...new Set([...directScopes, ...revisions, ...revisions.flatMap(revision => revision.units)].flatMap(scope => scope.recordIds))],
    members: revisions.flatMap(revision => revision.units.map(unit => recordUnit(unit, revision))),
  };
}
