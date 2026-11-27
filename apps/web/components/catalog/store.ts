export type CatalogProject = {
  id: string;
  title: string;
  customer?: string;
  description?: string;
  revisionIds: readonly string[];
  recordIds: readonly string[];
};

export type CatalogSystem = {
  id: string;
  title: string;
  description?: string;
  recordIds: readonly string[];
};

export type CatalogRevision = {
  id: string;
  systemId: string;
  version: string;
  recordIds: readonly string[];
};

export type CatalogUnit = {
  serial: string;
  title?: string;
  revisionId: string;
  projectId: string | null;
  batch?: string;
  configurations: readonly UnitConfiguration[];
};

export type UnitConfiguration = {
  revisionId: string;
  recordIds: readonly string[];
  history: readonly {
    date: string;
    title: string;
    detail: string;
    recordId?: string;
  }[];
};

export type CatalogRowKind = "project" | "system" | "unit";
export type ArchivedCatalogRow = { entity: CatalogRowKind; id: string };

export type Catalog = {
  archivedRows?: readonly ArchivedCatalogRow[];
  projects: readonly CatalogProject[];
  archivedProjects?: readonly CatalogProject[];
  systems: readonly CatalogSystem[];
  revisions: readonly CatalogRevision[];
  units: readonly CatalogUnit[];
};

export type CatalogDirectory = Omit<Catalog, "units"> & {
  units: readonly (Omit<CatalogUnit, "configurations"> & {
    configurations: readonly Pick<UnitConfiguration, "revisionId">[];
  })[];
};

export type CatalogEntry = NonNullable<Catalog[keyof Catalog]>[number];

export function projectById(catalog: Pick<Catalog, "projects" | "archivedProjects">, id: string | null | undefined) {
  return (
    catalog.projects.find((project) => project.id === id) ??
    catalog.archivedProjects?.find((project) => project.id === id)
  );
}

export function isCatalogArchived(
  catalog: Pick<Catalog, "archivedRows">,
  entity: CatalogRowKind,
  id: string,
) {
  return (
    catalog.archivedRows?.some(
      (row) => row.entity === entity && row.id === id,
    ) ?? false
  );
}

// A saved assignment survives archival while the serial stays on the same revision.
export function canAssignProject(catalog: CatalogDirectory, projectId: string, revisionId: string,
  prior?: Pick<CatalogUnit, "projectId" | "revisionId">, project = catalog.projects.find(p => p.id === projectId)) {
  return prior?.projectId === projectId && prior.revisionId === revisionId ||
    !!project?.revisionIds.includes(revisionId) && !isCatalogArchived(catalog, "project", projectId);
}

export function hasUnitRevision(unit: CatalogDirectory["units"][number], revisionId: unknown) {
  return unit.revisionId === revisionId || unit.configurations.some(entry => entry.revisionId === revisionId);
}

export function revisionInUse(catalog: CatalogDirectory, revision: CatalogRevision) {
  return revision.recordIds.length > 0 ||
    catalog.units.some(unit => hasUnitRevision(unit, revision.id)) ||
    catalog.projects.some((project) => project.revisionIds.includes(revision.id)) ||
    Boolean(catalog.archivedProjects?.some((project) => project.revisionIds.includes(revision.id)));
}

export type CatalogEntryEdit = (
  | ({ level: "project" } & Omit<CatalogProject, "recordIds">)
  | ({ level: "system" } & Omit<CatalogSystem, "recordIds">)
  | ({ level: "revision" } & Omit<CatalogRevision, "recordIds">)
  | ({ level: "unit"; id: string } & Omit<CatalogUnit, "serial" | "configurations">)
) & { create?: boolean };

export type CatalogEdit =
  | CatalogEntryEdit
  | { level: "remove"; id: string; entity: "revision" }
  | ({ level: "archive"; archived: boolean } & ArchivedCatalogRow);

export function revisionLabel(catalog: Pick<Catalog, "systems">, revision: CatalogRevision) {
  return `${catalog.systems.find(({ id }) => id === revision.systemId)?.title ?? "Unavailable"} · ${revision.version}`;
}

// An existing historical assignment stays editable; new assignments need an active project on this revision.
export function assignmentOptions(
  catalog: CatalogDirectory, revisionId: string | null, unit?: Pick<CatalogUnit, "projectId" | "revisionId">,
) {
  const options = [{ value: "", label: "Unassigned" }];
  if (!revisionId) return options;
  const retired = unit?.revisionId === revisionId && catalog.archivedProjects?.find(project => project.id === unit.projectId);
  for (const project of retired ? [...catalog.projects, retired] : catalog.projects) {
    if (canAssignProject(catalog, project.id, revisionId, unit, project)) options.push({ value: project.id, label: project.title });
  }
  return options;
}

export function projectRevisions(catalog: CatalogDirectory, project: CatalogProject | undefined, system?: string) {
  const allowed = project && new Set(project.revisionIds);
  return catalog.revisions.filter(row => (!allowed || allowed.has(row.id)) && (!system || row.systemId === system));
}

export function revisionOptions(catalog: CatalogDirectory, revisions: CatalogDirectory["revisions"]) {
  return revisions.map(row => ({ value: row.id, label: revisionLabel(catalog, row) }));
}

export type CatalogList = "projects" | "systems" | "units";
export type CatalogFilters = Partial<Record<"system" | "revision" | "batch", string>> & { project?: string | null };

export function catalogUnits(catalog: CatalogDirectory, { project, system, revision, batch }: CatalogFilters = {}, archived = false) {
  const revisions = system && new Set(catalog.revisions.filter(row => row.systemId === system).map(row => row.id));
  return catalog.units.filter(unit =>
    isCatalogArchived(catalog, "unit", unit.serial) === archived &&
    (project === undefined || unit.projectId === project) &&
    (!revisions || revisions.has(unit.revisionId)) &&
    (!revision || unit.revisionId === revision) && (!batch || unit.batch === batch));
}

// Colon is not valid in an ID. The real project named "unassigned" remains selectable.
export const unassigned = ":unassigned";
