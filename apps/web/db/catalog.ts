import { sameUnit, type UnitEdition } from "@/lib/records/journal";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Reader, WorkspaceDatabase } from "./connection";
import { type CatalogDirectory, canAssignProject, isCatalogArchived, revisionInUse, type Catalog, type CatalogEdit, type CatalogEntry } from "@/components/catalog/store";
import { catalogEntries, catalogFlights, catalogSpacecraft, deliveryPackets, packetResponses, publicReferences, revisionFiles, revisionReviews, verificationReviews, workItems } from "./schema";
import { acceptanceReviewConnection, acceptanceState, imageComparisonConnection } from "@/components/verification/acceptance";
import { methods } from "@/components/verification/model";
import type { RecordConnection } from "@/lib/records/links";
import { studyCatalog, interfaceCompareHref, operationsStudies, type StudyId } from "@/lib/archives/study";
import { withSelections } from "@/lib/workspace-routes";
import { unitSelection, type ItemSelection } from "@/components/workspace/selection";
import { readAcceptanceChecks } from "./verification/acceptance";
import { workDestination } from "./records/work";
import { readAcknowledgedAgreements } from "./operations/tools";
import { isObject } from "@/db/workflows/cases";

type Row = typeof catalogEntries.$inferInsert;

function catalogId(entry: CatalogEntry) {
  return "entity" in entry ? `${entry.entity}:${entry.id}` : "serial" in entry ? entry.serial : entry.id;
}

export function catalogRows(catalog: Catalog): Row[] {
  return (Object.entries(catalog) as [keyof Catalog, readonly CatalogEntry[]][]).flatMap(([kind, entries]) =>
    entries.map((data, position) => ({
      kind, position, data,
      id: catalogId(data),
    })),
  );
}

// The directory needs historical revision identities for its links; the destinations own their full history.
type CatalogFilter = (keyof Catalog)[] | SQL;
export function loadCatalog(db: Reader, filter?: CatalogFilter): Promise<Catalog>;
export function loadCatalog(db: Reader, filter: CatalogFilter | undefined, directory: true): Promise<CatalogDirectory>;
export async function loadCatalog(db: Reader, filter?: CatalogFilter, directory = false): Promise<CatalogDirectory> {
  const { data, kind, position, id } = catalogEntries;
  const entry = directory ? sql`case when ${kind} <> 'units' then ${data} else jsonb_set(${data}, '{configurations}', (
    select coalesce(jsonb_agg(jsonb_build_object('revisionId', config->'revisionId') order by n), '[]'::jsonb)
    from jsonb_array_elements(${data}->'configurations') with ordinality as f(config, n)
  )) end` : data;
  const groups = await db.select({ kind, entries: sql`jsonb_agg(${entry} order by ${position}, ${id})` })
    .from(catalogEntries).where(Array.isArray(filter) ? inArray(kind, filter) : filter).groupBy(kind);

  return {
    projects: [], systems: [], revisions: [], units: [], archivedProjects: [], archivedRows: [],
    ...Object.fromEntries(groups.map(group => [group.kind, group.entries])),
  };
}

async function projectAgreements(db: Reader) {
  const [scopes, packets] = await Promise.all([
    readAcknowledgedAgreements(db),
    db.select({
      id: deliveryPackets.id, serial: deliveryPackets.serial, revisionId: deliveryPackets.revisionId,
      version: deliveryPackets.version, caseId: sql<string>`scope->>'caseId'`, scopeVersionId: sql<string>`scope->>'versionId'`, outcome: packetResponses.outcome,
    }).from(deliveryPackets)
      .crossJoin(sql`jsonb_array_elements(${deliveryPackets.contents}->'scopes') as scope`)
      .leftJoin(packetResponses, eq(packetResponses.packetId, deliveryPackets.id))
      .where(sql`scope->>'projectId' is not null`).orderBy(desc(deliveryPackets.version)),
  ]);

  return scopes.map(({ scope, unit }) => ({
    ...scope, packet: packets.find(packet => packet.caseId === scope.caseId && packet.scopeVersionId === scope.versionId &&
      sameUnit(packet, unit)),
  }));
}

async function reviewedRevisions(db: Reader, id?: string) {
  const referenced = db.select({ id: verificationReviews.id }).from(verificationReviews)
    .where(sql`${verificationReviews.data}->'scope'->>'selection' = 'revision:' || ${catalogEntries.id}`);
  const assigned = db.select({ id: revisionReviews.id }).from(revisionReviews)
    .where(or(eq(revisionReviews.fromId, catalogEntries.id), eq(revisionReviews.toId, catalogEntries.id),
      eq(revisionReviews.revisionId, catalogEntries.id)));
  const filed = db.select({ id: revisionFiles.fileId }).from(revisionFiles).where(eq(revisionFiles.revisionId, catalogEntries.id));
  const rows = await db.select({ id: catalogEntries.id }).from(catalogEntries).where(and(
    eq(catalogEntries.kind, "revisions"), id ? eq(catalogEntries.id, id) : undefined, sql`(exists (${referenced}) or exists (${assigned}) or exists (${filed}))`,
  ));

  return rows.map(({ id }) => id);
}

async function unitConnections(db: Reader) {
  const [checks, assignments] = await Promise.all([
    readAcceptanceChecks(db),
    db.select({ ...workDestination, method: workItems.method, serial: workItems.serial, revisionId: workItems.revisionId })
      .from(workItems).where(isNull(workItems.completedAt)),
  ]);
  const units: Record<string, RecordConnection[]> = {};
  function add({ serial, revisionId }: UnitEdition, connection: RecordConnection) {
    (units[unitSelection(serial, revisionId)] ??= []).push(connection);
  }
  for (const check of checks) {
    const archive = imageComparisonConnection(check);
    if (archive) {
      add(check.unit, archive);
      if (!check.captures.length) continue;
    }
    const review = acceptanceReviewConnection(check);
    if (check.artifact === "image" && acceptanceState(check).stage !== "Waiting for review") {
      review.label = "Image acceptance record";
    }
    add(check.unit, review);
  }
  for (const task of assignments) {
    add(task, {
      href: task.href, location: `Verification · ${methods[task.method].label}`,
      label: task.actionLabel, identity: task.title,
    });
  }

  return units;
}

// Send destinations to Catalog, leaving archived samples and their eligibility checks on the server.
function catalogStudyLinks(catalog: CatalogDirectory, kind: "project" | "system", publicLinks: ReadonlyMap<string, RecordConnection[]> = new Map()) {
  const directory = studyCatalog(catalog);
  const links: Record<string, { all: RecordConnection[]; filtered: Record<string, RecordConnection[]> }> = {};
  for (const project of directory.projects) {
    const connections = publicLinks.get(project.id);
    if (connections?.length) links[project.id] = { all: [...connections], filtered: {} };
  }
  for (const study of Object.keys(operationsStudies) as StudyId[]) {
    const sources = directory.sourcesFor(study);
    const rows = Map.groupBy(sources, source => kind === "project" ? source.projectId : source.systemId);
    for (const [id, applicable] of rows) {
      const entry = links[id] ??= { all: [], filtered: {} };
      function connection(scope: ItemSelection[]): RecordConnection {
        return { href: withSelections(study === "docking" ? interfaceCompareHref(new URLSearchParams()) : "/operations/aurora?view=recordings", scope),
          label: study === "aurora" ? "Compare payload runs" : "Compare interface revisions",
          location: study === "aurora" ? "Operations · Aurora" : "Engineering · Design · Interfaces" };
      }
      entry.all.push(connection([`${kind}:${id}`]));
      // A project-filtered system (or system-filtered project) is an intersection, unlike the picker's union.
      for (const [filter, matching] of Map.groupBy(applicable, row => kind === "project" ? row.systemId : row.projectId)) {
        const scope = matching.map((row): ItemSelection => row.serial === null ? `revision:${row.revisionId}` : unitSelection(row.serial, row.revisionId));
        (entry.filtered[filter] ??= []).push(connection(scope));
      }
    }
  }

  return links;
}

export function readPublicReferences(db: Reader) {
  const { position, ...fields } = getTableColumns(publicReferences);

  return db.select(fields).from(publicReferences).orderBy(asc(position));
}

export async function readCatalogTab(db: Reader, tab: string | string[] | undefined) {
  if (tab === "references") return { view: tab, references: await readPublicReferences(db) } as const;
  const directory = loadCatalog(db, undefined, true);
  if (tab === "systems") {
    const [catalog, locked] = await Promise.all([directory, reviewedRevisions(db)]);

    return { view: tab, catalog, locked, studyLinks: catalogStudyLinks(catalog, "system") } as const;
  }
  if (tab === "units") {
    const [catalog, connections] = await Promise.all([directory, unitConnections(db)]);
    for (const { serial, revisionId } of studyCatalog(catalog).sourcesFor("docking")) {
      if (!serial) continue;
      const scope = unitSelection(serial, revisionId);
      (connections[scope] ??= []).push({
        label: "Compare interface revisions", location: "Engineering · Design · Interfaces",
        href: withSelections(interfaceCompareHref(new URLSearchParams()), [scope]),
      });
    }

    return { view: tab, catalog, connections } as const;
  }
  const [catalog, agreements, spacecraft, flights] = await Promise.all([
    directory, projectAgreements(db),
    db.select({ project: sql<string>`${catalogSpacecraft.data}->>'projectId'`, id: catalogSpacecraft.noradId,
      name: sql<string>`${catalogSpacecraft.data}->>'name'` }).from(catalogSpacecraft),
    db.select({ project: sql<string>`${catalogFlights.data}->>'projectId'` }).from(catalogFlights)
      .groupBy(sql`${catalogFlights.data}->>'projectId'`),
  ]);
  const publicLinks = new Map<string, RecordConnection[]>();
  for (const [project, craft] of Map.groupBy(spacecraft, row => row.project)) {
    publicLinks.set(project, craft.map(({ id, name }) => ({
      href: "/operations/fleet?sat=" + id, label: name, location: "Operations · Fleet",
    })));
  }
  for (const { project } of flights) publicLinks.set(project, [...(publicLinks.get(project) ?? []), {
    href: withSelections("/operations/aurora", [`project:${project}`]), label: "Flight archive", location: "Operations · Aurora",
  }]);

  return { view: "projects", catalog, agreements, studyLinks: catalogStudyLinks(catalog, "project", publicLinks) } as const;
}

export type CatalogTab = Awaited<ReturnType<typeof readCatalogTab>>;

// Catalog edits

function text(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 100;
}

function optionalText(value: unknown, max: number) {
  return value === undefined || typeof value === "string" && value.length <= max;
}

function isCatalogEdit(edit: unknown): edit is CatalogEdit {
  if (!isObject(edit)) return false;
  if (!text(edit.id) || !/^[a-z0-9][a-z0-9._-]*$/i.test(edit.id)) return false;
  if ("create" in edit && typeof edit.create !== "boolean") return false;
  switch (edit.level) {
    case "project":
    case "system": return text(edit.title) && optionalText(edit.description, 1000) &&
      (edit.level === "system" || optionalText(edit.customer, 100) && Array.isArray(edit.revisionIds) && edit.revisionIds.every(text));
    case "revision": return text(edit.version) && text(edit.systemId);
    case "unit": return text(edit.revisionId) && (edit.projectId === null || text(edit.projectId)) &&
      optionalText(edit.title, 100) && optionalText(edit.batch, 100);
    case "archive": return typeof edit.archived === "boolean" && ["project", "system", "unit"].some((level) => level === edit.entity);
    case "remove": return edit.entity === "revision";
    default: return false;
  }
}

type CatalogDatabase = Pick<WorkspaceDatabase, "select" | "insert" | "delete">;

const kinds = { project: "projects", system: "systems", revision: "revisions", unit: "units" } as const;

function conflict(error = "The linked Catalog record has changed. Review the current assignments.") {
  return { error, status: 409 } as const;
}

export async function saveCatalog(db: CatalogDatabase, edit: unknown) {
  if (!isCatalogEdit(edit)) return { error: "Enter valid Catalog fields.", status: 400 } as const;
  const entityKind = kinds[edit.level === "archive" || edit.level === "remove" ? edit.entity : edit.level];
  const kind = edit.level === "archive" ? "archivedRows" : entityKind;
  const id = edit.level === "archive" ? `${edit.entity}:${edit.id}` : edit.id;

  if (edit.level === "remove" || edit.level === "archive" && !edit.archived) {
    if (edit.level === "remove") {
      const catalog = await loadCatalog(db, ["revisions", "units", "projects", "archivedProjects"]);
      const revision = catalog.revisions.find((row) => row.id === id);
      if (!revision || revisionInUse(catalog, revision)) return conflict();
      if ((await reviewedRevisions(db, id)).length) return conflict("Filed records use this revision.");
    }
    await db.delete(catalogEntries).where(and(eq(catalogEntries.kind, kind), eq(catalogEntries.id, id)));

    return { saved: true } as const;
  }

  const exact = and(eq(catalogEntries.kind, entityKind), eq(catalogEntries.id, edit.id));
  const dependencies: Record<typeof edit.level, CatalogFilter | undefined> = {
    archive: exact, system: exact, project: ["projects", "units", "revisions"],
    revision: ["revisions", "systems"], unit: ["units", "revisions", "projects", "archivedRows"],
  };
  const catalog = await loadCatalog(db, dependencies[edit.level]);
  const prior = catalog[entityKind].find(row => catalogId(row) === edit.id);
  if (edit.level !== "archive" && edit.create === false && !prior) return conflict();
  if (edit.level !== "archive" && edit.create && prior)
    return conflict(edit.level === "unit" ? "This serial number is already in use." : "This Catalog record already exists.");
  const recordIds = prior && "recordIds" in prior ? prior.recordIds : [];
  let data: CatalogEntry;
  switch (edit.level) {
    case "archive":
      if (!prior) return conflict();
      data = { id: edit.id, entity: edit.entity };
      break;
    case "project": {
      const assigned = new Set(edit.revisionIds);
      if (catalog.units.some((unit) => unit.projectId === id && !assigned.has(unit.revisionId)))
        return conflict("Keep the revisions used by units assigned to this project.");
      if (edit.revisionIds.some((id) => !catalog.revisions.some((revision) => revision.id === id))) return conflict();
      const { title, customer, description, revisionIds } = edit;
      data = { id, title, customer, description, revisionIds, recordIds };
      break;
    }
    case "system": {
      data = { id, title: edit.title, description: edit.description, recordIds };
      break;
    }
    case "revision": {
      if (!catalog.systems.some(({ id }) => id === edit.systemId)) return conflict();
      if (prior && (!("systemId" in prior) || prior.systemId !== edit.systemId)) return conflict();
      if (catalog.revisions.some((r) => r.id !== id && r.systemId === edit.systemId && r.version.toLowerCase() === edit.version.toLowerCase()))
        return conflict("Enter a revision name that is unique within this system.");
      data = { id, systemId: edit.systemId, version: edit.version, recordIds };
      break;
    }
    case "unit": {
      const unit = prior && "serial" in prior ? prior : undefined;
      const { title, revisionId, projectId, batch } = edit;
      if (catalog.units.some((unit) => unit.serial.toLowerCase() === id.toLowerCase() && unit.serial !== id))
        return conflict("This serial number is already in use.");
      const revision = catalog.revisions.find((r) => r.id === revisionId);
      if (!revision || (unit?.revisionId !== revisionId && isCatalogArchived(catalog, "system", revision.systemId)))
        return conflict("Choose a system revision.");
      if (projectId !== null && !canAssignProject(catalog, projectId, revisionId, unit))
        return conflict("Choose a project that uses this revision.");
      const configurations = unit?.configurations ?? [];
      data = {
        serial: id, title, revisionId, projectId, batch,
        configurations: configurations.some((entry) => entry.revisionId === revisionId)
          ? configurations : [...configurations, { revisionId, recordIds: [], history: [] }],
      };
      break;
    }
  }
  const position = sql`(select coalesce(max(${catalogEntries.position}), -1) + 1 from ${catalogEntries} where ${catalogEntries.kind} = ${kind})`;
  await db.insert(catalogEntries).values({ kind, id, position, data })
    .onConflictDoUpdate({ target: [catalogEntries.kind, catalogEntries.id], set: { data } });

  return { saved: true } as const;
}

export function loadUnitCatalog(db: Reader, serial: string, revisionId: string) {
  const { kind, id } = catalogEntries;

  return loadCatalog(db, or(
    and(eq(kind, "units"), eq(id, serial)), and(eq(kind, "revisions"), eq(id, revisionId)),
    and(eq(kind, "archivedRows"), eq(id, `unit:${serial}`)),
  ));
}

// A write can cite the recorded edition even after this serial changes revision.
export async function readUnitEdition(db: Reader, serial: string, revisionId: string) {
  const {units: [unit], revisions: [edition], archivedRows} = await loadUnitCatalog(db, serial, revisionId);
  if (!unit || !edition) return;
  const configuration = unit.configurations.find(row => row.revisionId === revisionId);
  const current = unit.revisionId === revisionId;
  if (!current && !configuration) return;

  return {
    unit: {serial, revisionId, revision: edition.version}, current, archived: Boolean(archivedRows?.length),
    registered: !!configuration, recordIds: [...edition.recordIds, ...(configuration?.recordIds ?? [])],
  };
}
