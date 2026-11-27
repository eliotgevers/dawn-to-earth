"use client";
import { RevisionFiles } from "./revision-files";
import { EmptyRecords } from "@/components/records/empty";
import { distinctConnections, recordHref, type RecordConnection } from "@/lib/records/links";
import { recordLink } from "@/components/records/presentation";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { agreementConnection } from "@/db/workflows/agreements";
import { withSelections } from "@/lib/workspace-routes";
import { useRouter, useSearchParams } from "next/navigation";
import { watchRecordFocus } from "@/components/workspace/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ConnectionLink, ContentLinkLabel, SourceLink } from "@/components/records/links";
import { Filter } from "lucide-react";
import { type SelectOption, LabeledSelect, FormDialog, TextField } from "@/components/records/forms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RecordResults } from "@/components/records/results";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { unitSelection } from "@/components/workspace/selection";
import type { CatalogTab } from "@/db/catalog";
import { saveWorkspace } from "@/lib/workspace";
import {
  isCatalogArchived, revisionLabel,
  revisionInUse,
  projectById,
  type CatalogDirectory,
  type CatalogEntryEdit,
  type CatalogRowKind,
  catalogUnits, projectRevisions, revisionOptions,
  type CatalogFilters,
  type CatalogList,
  unassigned,
  assignmentOptions,
} from "@/components/catalog/store";
import { MissingRecord } from "@/components/workspace/section-tabs";
import { RecordActionButton } from "@/components/records/actions";

type CatalogRow = Exclude<CatalogEntryEdit, { level: "revision" }> & {
  detail: string;
  links: () => ReactNode;
};

const catalogViews = {
  projects: { level: "project", label: "Projects" },
  systems: { level: "system", label: "Systems" },
  units: { level: "unit", label: "Units" },
} as const;

type CatalogRowsScope = {
  catalog: CatalogDirectory;
  archived: boolean;
  units: CatalogDirectory["units"];
  filter: CatalogFilters;
  drillDown: (view: "systems" | "units", filter: CatalogFilters, sourceId: string, label: string) => ReactNode;
};

function projectRows({ catalog, archived, drillDown, filter, units }: CatalogRowsScope, { agreements, studyLinks }: Extract<CatalogTab, { view: "projects" }>) {
  const revisionSystems = new Map(
    catalog.revisions
      .filter(({ systemId }) => !isCatalogArchived(catalog, "system", systemId))
      .map(({ id, systemId }) => [id, systemId]),
  );
  const assigned = Map.groupBy(units, unit => unit.projectId);
  const scopesByProject = Map.groupBy(agreements, scope => scope.projectId);
  return catalog.projects
    .filter(({ id }) => isCatalogArchived(catalog, "project", id) === archived)
    .flatMap((project): CatalogRow[] => {
      const { id, revisionIds } = project;
      const source = `catalog-projects-${id}`;
      const studies = filter.system ? studyLinks[id]?.filtered[filter.system] : studyLinks[id]?.all;
      const systems = new Set(revisionIds.flatMap((revision) => revisionSystems.get(revision) ?? []));
      if (filter.system && !systems.has(filter.system)) return [];
      return [
        {
          ...project, level: "project",
          detail: project.description || "Unavailable",
          links: () => (
            <>
              {!archived && (
                <div className="mt-1 flex flex-wrap gap-x-3">
                  {drillDown("systems", { project: id }, source, `Systems (${systems.size})`)}
                  {drillDown("units", { project: id }, source, `Units (${assigned.get(id)?.length ?? 0})`)}
                  {studies?.map(connection => <ConnectionLink key={connection.href} sourceId={source} connection={connection} />)}
                  {project.recordIds.length > 0 && (
                    <ConnectionLink sourceId={source} connection={{
                      href: withSelections("/engineering", [`project:${id}`]),
                      label: "Engineering overview",
                    }} />
                  )}
                </div>
              )}
              {scopesByProject.get(id)?.map(({ packet, ...scope }) => (
                <div key={scope.caseId} className="flex flex-wrap gap-x-4">
                  <ConnectionLink sourceId={source} connection={agreementConnection(scope, [`project:${id}`])} />
                  {packet && <span>
                    <ConnectionLink sourceId={source} connection={{
                      href: recordHref("operations", "packet-" + packet.id, packet),
                      label: `Packet v${packet.version} · ${packet.serial}`, location: "Operations · Readiness",
                    }} />
                    <span className="ms-1 text-xs text-muted-foreground">
                      {packet.outcome ? "Customer " + packet.outcome.toLowerCase() : "Awaiting customer response"}
                    </span>
                  </span>}
                </div>
              ))}
            </>
          ),
        },
      ];
    });
}

function showRevisions(system: string | null, files?: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("files");
  url.searchParams.delete("revisions");
  if (files) url.searchParams.set("files", files);
  else if (system) url.searchParams.set("revisions", system);
  url.hash = "";
  if (files) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function systemRows({ catalog, archived, filter, drillDown, units }: CatalogRowsScope,
  tab: Extract<CatalogTab, { view: "systems" }>, systemId: string | null, files: string | null) {
  const locked = new Set(tab.locked);
  const project = projectById(catalog, filter.project);
  if (filter.project && !project) return [];
  const revisions = Map.groupBy(projectRevisions(catalog, project), row => row.systemId);
  const byRevision = Map.groupBy(project ? units.filter(unit => unit.projectId === project.id) : units, unit => unit.revisionId);
  return catalog.systems
    .filter(({ id }) => isCatalogArchived(catalog, "system", id) === archived)
    .flatMap((system): CatalogRow[] => {
      const { id, title, description } = system;
      const versions = revisions.get(id) ?? [];
      const studies = project ? tab.studyLinks[id]?.filtered[project.id] : tab.studyLinks[id]?.all;
      if (project && !versions.length) return [];
      return [
        {
          ...system, level: "system",
          detail: description || "Unavailable",
          links: () => (
            <Dialog open={systemId === id || versions.some(revision => revision.id === files)}
              onOpenChange={open => showRevisions(open ? id : null)}>
              <DialogTrigger render={<Button type="button" variant="link" className="h-auto px-0" />}>
                <ContentLinkLabel kind="internal">Revisions ({versions.length})</ContentLinkLabel>
              </DialogTrigger>
              {!archived && studies?.map(connection => <ConnectionLink key={connection.href} className="ms-3"
                sourceId={`catalog-systems-${id}`} connection={connection} />)}
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{title} revisions</DialogTitle>
                  <DialogDescription className="sr-only">
                    Select a revision to view its units or edit its record.
                  </DialogDescription>
                </DialogHeader>
                <CatalogForms catalog={catalog}>
                  {versions.length ? (
                    <ul className="divide-y" aria-label={`${title} revisions`}>
                      {versions.map((revision) => {
                        const count = byRevision.get(revision.id)?.length ?? 0;
                        const edit = { ...revision, level: "revision" as const };
                        return (
                          <li key={revision.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2">
                            <div className="min-w-0">
                              <span className="block wrap-anywhere font-medium">{revision.version}</span>
                              <div className="flex flex-wrap items-baseline gap-x-3">
                                {count > 0 && drillDown("units",
                                  { project: filter.project, system: id, revision: revision.id },
                                  `catalog-systems-${id}`, `Units (${count})`,
                                )}
                                <RevisionFiles revision={revision} systemTitle={title} open={files === revision.id}
                                  onOpenChange={open => showRevisions(id, open ? revision.id : undefined)} />
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {!revisionInUse(catalog, revision) && !locked.has(revision.id) && (
                                <CatalogRemoval id={revision.id} entity="revision" title={revision.version} />
                              )}
                              <CatalogEditor level="revision" edit={edit} label={revision.version} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <EmptyRecords />
                  )}
                  {!project && (
                    <div>
                      <CatalogEditor level="revision" parent={id} label="revision" />
                    </div>
                  )}
                </CatalogForms>
              </DialogContent>
            </Dialog>
          ),
        },
      ];
    });
}

function unitRows({ catalog, units }: CatalogRowsScope, { connections }: Extract<CatalogTab, { view: "units" }>) {
  const revisions = new Map(catalog.revisions.map((revision) => [revision.id, revision]));
  return units.map((unit): CatalogRow => {
    const { serial, title, revisionId, projectId, batch, configurations } = unit;
    const revision = revisions.get(revisionId);
    const project = projectById(catalog, projectId);
    const source = `catalog-units-${serial}`;
    const scope = unitSelection(serial, revisionId);
    const destinations: RecordConnection[] = [
      ...(connections[scope] ?? []),
      { href: recordHref("engineering", undefined, unit), label: "Engineering overview" },
    ];
    for (const entry of configurations) {
      const prior = revisions.get(entry.revisionId);
      if (!prior || prior.id === revisionId) continue;
      const edition = prior.systemId === revision?.systemId ? prior.version : revisionLabel(catalog, prior);
      destinations.push({
        href: recordHref("verification", undefined, { serial, revisionId: prior.id }),
        location: "Verification", label: `${edition} history`,
        identity: `${serial} · ${revisionLabel(catalog, prior)}`,
      });
    }
    return {
      level: "unit", id: serial, title, revisionId, projectId, batch,
      detail: [
        title && title !== serial && serial,
        revision ? revisionLabel(catalog, revision) : "Unavailable",
        project?.title ?? (projectId ? "Unavailable" : "Unassigned"),
      ]
        .filter(Boolean)
        .join(" · "),
      links: () => (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {distinctConnections(destinations).map(connection => (
            <ConnectionLink key={connection.href} sourceId={source} connection={connection} />
          ))}
        </div>
      ),
    };
  });
}

const filterKeys = ["project", "system", "revision", "batch"] as const;
const queryFilters = (filter: CatalogFilters) => Object.fromEntries(filterKeys.map(key => [key, filter[key]]));

export function CatalogTabs({ view, tabList, children }: { view: CatalogTab["view"]; tabList: ReactNode; children: ReactNode }) {
  const router = useRouter();
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        const url = new URL(window.location.href);
        url.searchParams.set("view", String(next));
        url.searchParams.delete("files");
        url.searchParams.delete("revisions");
        url.hash = "";
        router.push(url.pathname + url.search, { scroll: false });
      }}
      className="mt-3.5 min-w-0 gap-[19px] sm:mt-[19px]"
    >
      {tabList}
      <TabsContent
        key={view}
        value={view}
        className={view === "references" ? "min-w-0 max-w-3xl data-ending-style:hidden" : "min-w-0 data-ending-style:hidden"}
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}

export function Catalog({ tab }: { tab: CatalogTab }) {
  const { view } = tab;
  const [missing, setMissing] = useState("");
  const params = useSearchParams();
  const filters = params.toString();
  const files = params.get("files");
  const unavailable = tab.view === "systems" && files && !tab.catalog.revisions.some(row => row.id === files)
    ? files : missing;
  useEffect(() => watchRecordFocus(/^catalog-/, setMissing), [view, filters]);
  return <>
    {unavailable && <MissingRecord id={unavailable} />}
    {tab.view === "references" ? (
      <PublicReferences references={tab.references} />
    ) : (
      <CatalogListView tab={tab} />
    )}
  </>;
}

function PublicReferences({ references }: { references: Extract<CatalogTab, { view: "references" }>["references"] }) {
  const heritage = references.find(({ id }) => id === "dawn-heritage-index");
  const rows = references.filter(({ id }) => id !== "dawn-heritage-index");
  return (
    <>
      <RecordResults records={rows} searchText={({ title, status, summary }) => [title, status, summary].join(" ")}>
        {matching => (
            <ul className="divide-y max-w-[720px]" aria-label="Public references">
              {matching.map(({ id, title, status, summary, sources }) => (
                <li key={id} id={`catalog-references-${id}`} tabIndex={-1} className="grid gap-0.5 px-1 py-2">
                  <strong>{title}</strong>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {status} · {summary}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {sources.map((source) => (
                      <SourceLink key={source.href} href={source.href} className={`${recordLink} text-xs underline underline-offset-2`}>{source.title}</SourceLink>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
        )}
      </RecordResults>
      {heritage?.sources[0] && (
        <p className="mt-0.5 text-xs text-muted-foreground mt-3">
          {heritage.summary}{" "}
          <SourceLink href={heritage.sources[0].href}>{heritage.status}</SourceLink>
        </p>
      )}
    </>
  );
}

function CatalogFilter({ view, catalog, filter, update }: {
  view: CatalogList; catalog: CatalogDirectory; filter: CatalogFilters; update: (values: CatalogFilters) => void;
}) {
  const filterCount = Object.keys(filter).length;
  const choices = new Map<keyof CatalogFilters, SelectOption[]>();
  function active(kind: "project" | "system", id: string) {
    return id === filter[kind] || !isCatalogArchived(catalog, kind, id);
  }
  if (view !== "projects") {
    const projects = catalog.projects.filter(p => active("project", p.id)).map(p => ({ value: p.id, label: p.title }));
    if (view === "units") projects.unshift({ value: unassigned, label: "Unassigned" });
    choices.set("project", projects);
  }
  if (view !== "systems")
    choices.set("system", catalog.systems.filter(s => active("system", s.id)).map(s => ({ value: s.id, label: s.title })));
  if (view === "units") {
    choices.set("revision", revisionOptions(catalog, catalog.revisions.filter(r => r.id === filter.revision ||
      (filter.system ? r.systemId === filter.system : active("system", r.systemId)))));
    const batches = catalogUnits(catalog).flatMap(({ batch }) => batch ? [batch] : []);
    if (batches.length) choices.set("batch", [...new Set(batches)].sort((a, b) => a.localeCompare(b)).map(value => ({ value, label: value })));
  }
  return (
    <Dialog>
      <DialogTrigger
        aria-label={filterCount ? `Filter, ${filterCount} active` : "Filter"}
        render={<Button type="button" variant="outline" />}
      >
        <Filter aria-hidden="true" /> Filter
        {filterCount > 0 && (
          <span className="text-muted-foreground" aria-hidden="true">
            {filterCount}
          </span>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Filter {view}</DialogTitle>
          <DialogDescription className="sr-only">Choose which catalog records to show.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {Array.from(choices, ([key, options]) => {
            const label = key[0].toUpperCase() + key.slice(1);
            const plural = key === "batch" ? "batches" : key + "s";
            return <LabeledSelect key={key} label={label}
              options={[{ value: "", label: "All " + plural }, ...options]}
              value={filter[key] === null ? unassigned : filter[key] ?? ""}
              onChange={value => {
                if (value === null) return;
                const values: CatalogFilters = { [key]: key === "project" && value === unassigned ? null : value || undefined };
                if (key === "system" && value && !catalog.revisions.some(r => r.id === filter.revision && r.systemId === value))
                  values.revision = undefined;
                update(values);
              }}
            />;
          })}
        </div>
        {filterCount > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose render={<Button type="button" onClick={() => update(queryFilters({}))} />}>
              Clear filter
            </DialogClose>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CatalogListView({ tab }: { tab: Exclude<CatalogTab, { view: "references" }> }) {
  const { view, catalog } = tab;
  const params = useSearchParams();
  const { level, label } = catalogViews[view];
  const param = (key: string) => params.get(`${view}.${key}`);
  const query = param("q") ?? "";
  const filter: CatalogFilters = Object.fromEntries(filterKeys.flatMap(key => {
    const value = param(key);
    return value === null ? [] : [[key, key === "project" && value === "" ? null : value]];
  }));
  const archiveCount = catalog.archivedRows?.filter(row => row.entity === level).length ?? 0;
  const archived = Boolean(archiveCount && param("archived") === "1");

  function href(to: CatalogList, values: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(params);
    next.set("view", to);
    next.delete("files");
    next.delete("revisions");
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) next.delete(`${to}.${key}`);
      else next.set(`${to}.${key}`, value ?? "");
    }
    return `/catalog?${next}`;
  }

  function updateList(values: Record<string, string | null | undefined>) {
    window.history.replaceState(null, "", href(view, values));
  }
  function drillDown(to: "systems" | "units", filter: CatalogFilters, sourceId: string, text: string) {
    const path = href(to, { ...queryFilters(filter), q: undefined, archived: undefined });

    return <ConnectionLink scroll={false} scope={[]} sourceId={sourceId}
      connection={{ href: path + `#catalog-${to}-tab`, label: text }} />;

  }

  const units = catalogUnits(catalog, view === "units" && !archived ? filter : {}, view === "units" && archived);
  const props = { catalog, units, filter: archived ? {} : filter, archived, drillDown };
  const rows =
    tab.view === "projects"
      ? projectRows(props, tab)
      : tab.view === "systems"
        ? systemRows(props, tab, params.get("revisions"), params.get("files"))
        : unitRows(props, tab);
  return (
    <CatalogForms catalog={catalog}>
      <RecordResults
        records={rows}
        search={{ value: query, onChange: (value) => updateList({ q: value || undefined }) }}
        searchText={row => [row.title ?? row.id, row.detail,
          row.level === "unit" ? row.batch : row.level === "project" ? row.customer : ""].join(" ")}
        actions={
          <>
            {!archived && <CatalogFilter view={view} catalog={catalog} filter={filter} update={updateList} />}
            {archiveCount > 0 && (
              <Button
                type="button"
                variant="outline"
                aria-pressed={archived}
                onClick={() => updateList({ archived: archived ? undefined : "1" })}
              >
                Archived ({archiveCount})
              </Button>
            )}
            {!archived && <CatalogEditor level={level} label={level} disabled={level === "unit" && !catalog.revisions.some(r => !isCatalogArchived(catalog, "system", r.systemId))} />}
          </>
        }
      >
        {matching => (
            <ul className="divide-y max-w-[720px]" aria-label={label}>
              {matching.map(row => {
                const { id, detail, links } = row;
                const title = row.title ?? id;
                const customer = row.level === "project" ? row.customer?.trim() || "Unavailable" : undefined;
                return <li key={id} id={`catalog-${view}-${id}`} tabIndex={-1} className="flex items-center justify-between gap-2.5 px-1 py-2">
                  <div className="min-w-0 wrap-anywhere">
                    {customer ? (
                      <p className="flex min-w-0 items-baseline gap-1">
                        <strong className="min-w-0 truncate" title={title}>
                          {title}
                        </strong>
                        <span
                          className="min-w-0 truncate text-xs text-muted-foreground"
                          title={customer}
                        >
                          ({customer})
                        </span>
                      </p>
                    ) : (
                      <strong>{title}</strong>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
                    {(view === "projects" || !archived) && links()}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                      {!archived && <CatalogEditor level={row.level} edit={row} label={title} />}
                      <CatalogRemoval
                        id={id}
                        entity={level}
                        title={title}
                        archived={archived}
                        onSaved={archived && archiveCount === 1 ? () => updateList({ archived: undefined }) : undefined}
                      />
                  </div>
                </li>;
              })}
            </ul>
        )}
      </RecordResults>
    </CatalogForms>
  );
}

type EditForm = {
  level: CatalogEntryEdit["level"];
  edit?: CatalogEntryEdit;
  label: string;
  parent?: string;
};

type RemovalForm = {
  entity: CatalogRowKind | "revision";
  id: string;
  title: string;
  archived?: boolean;
  onSaved?: () => void;
};

type CatalogFormHandle = ReturnType<typeof BaseDialog.createHandle<EditForm | RemovalForm>>;
const CatalogFormContext = createContext<CatalogFormHandle | undefined>(undefined);

function CatalogEditor({ disabled, ...form }: EditForm & { disabled?: boolean }) {
  const handle = useContext(CatalogFormContext);
  const { level, edit, label } = form;
  return (
    <BaseDialog.Trigger handle={handle} payload={form} render={edit
      ? <RecordActionButton action="edit" iconOnly={level !== "revision"} aria-label={`Edit ${label}`} />
      : <Button variant="outline" className="bg-popover" type="button" aria-label={`Add ${level}`} disabled={disabled} size={level === "revision" ? "sm" : undefined} />
    }>
      {edit ? undefined : level === "revision" ? "Add revision" : "Add"}
    </BaseDialog.Trigger>
  );
}

function removalLabel({ entity, archived }: RemovalForm) {
  return entity === "revision" ? "Remove" : archived ? "Restore" : "Delete";
}

function CatalogRemoval(form: RemovalForm) {
  const handle = useContext(CatalogFormContext);
  const label = removalLabel(form);
  return (
    <BaseDialog.Trigger handle={handle} payload={form} render={form.archived
      ? <Button size="sm" variant="outline" aria-label={`Restore ${form.title}`} />
      : <RecordActionButton action="remove" iconOnly aria-label={`${label} ${form.title}`} />
    }>
      {form.archived ? label : undefined}
    </BaseDialog.Trigger>
  );
}

// A list owns one form. The revisions popup is its own list so Escape returns to that popup.
function CatalogForms({ catalog, children }: { catalog: CatalogDirectory; children: ReactNode }) {
  const [handle] = useState(() => BaseDialog.createHandle<EditForm | RemovalForm>());
  const [open, setOpen] = useState(false);
  async function save(edit: Record<string, unknown>, after?: () => void) {
    const { error } = await saveWorkspace({ operation: "catalog", edit });
    return error || (() => {
      setOpen(false);
      after?.();
    });
  }
  return (
    <CatalogFormContext value={handle}>
      {children}
      <BaseDialog.Root handle={handle} open={open} onOpenChange={setOpen}>
        {({ payload }) => open && payload && ("entity" in payload
          ? <ConfirmCatalogRemoval form={payload} save={save} />
          : <CatalogForm key={JSON.stringify([payload.level, payload.edit?.id, payload.parent])} catalog={catalog} form={payload} save={save} />)}
      </BaseDialog.Root>
    </CatalogFormContext>
  );
}

type FormSave = { save: (edit: Record<string, unknown>, after?: () => void) => Promise<string | (() => void)> };

function ConfirmCatalogRemoval({ form, save }: FormSave & { form: RemovalForm }) {
  const { title, entity, id, archived } = form;
  const action = removalLabel(form);
  const description = entity === "revision" ? `Remove ${title} from Catalog.`
    : archived ? `Return ${title} to the active Catalog and item picker.`
    : `Archive ${title} for this workspace. It will disappear from active Catalog lists and the item picker. Related records, assignments, links, and history will stay available. You can restore it from Archived.`;
  function submit() {
    const edit = entity === "revision" ? { level: "remove", entity, id } : { level: "archive", entity, id, archived: !archived };
    return save(edit, () => {
      form.onSaved?.();
      const destination = entity === "revision" ? '[role="dialog"] button[aria-label="Add revision"]'
        : 'main [role="tabpanel"]:not([hidden]) input[type="search"]';
      requestAnimationFrame(() => document.querySelector<HTMLElement>(destination)?.focus());
    });
  }
  return <FormDialog heading={`${action} ${entity}`} description={description}
    submit={action} variant={archived ? undefined : "destructive"} onSubmit={submit} />;
}

const nameField = { name: "title", label: "Name", required: true };
const descriptionField = { name: "description", label: "Description" };
const textFields = {
  project: [nameField, { name: "customer", label: "Customer" }, descriptionField],
  system: [nameField, descriptionField],
  revision: [{ name: "version", label: "Revision name", required: true }],
  unit: [{ name: "id", label: "Serial number", required: true }, { name: "title", label: "Display name" }],
} satisfies Record<EditForm["level"], { name: string; label: string; required?: boolean }[]>;

function CatalogForm({ catalog, form, save }: FormSave & { catalog: CatalogDirectory; form: EditForm }) {
  const { level, edit } = form;
  const unit = edit?.level === "unit" ? edit : undefined;
  const [revisionIds, setRevisionIds] = useState<readonly string[]>(edit?.level === "project" ? edit.revisionIds : []);
  const [revisionId, setRevisionId] = useState<string | null>(unit?.revisionId ?? null);
  const [projectId, setProjectId] = useState(unit?.projectId ?? "");
  const [newId] = useState(() => crypto.randomUUID());
  function submit(data: FormData) {
    if (level === "unit" && !revisionId) return "Choose a system revision.";
    const fields = Object.fromEntries(Array.from(data, ([name, value]) => [name, String(value).trim()])
      .filter(([name, value]) => value || name === "customer"));
    return save({
      ...fields, level, create: !edit, id: edit?.id ?? (level === "unit" ? fields.id : newId),
      ...(level === "project" && { revisionIds }),
      ...(level === "revision" && { systemId: edit?.level === "revision" ? edit.systemId : form.parent }),
      ...(level === "unit" && { revisionId, projectId: projectId || null }),
    });
  }
  const retained = new Set(level === "project" ? revisionIds : unit ? [unit.revisionId] : []);
  const revisions = revisionOptions(catalog, catalog.revisions.filter(r =>
    retained.has(r.id) || !isCatalogArchived(catalog, "system", r.systemId)));
  return (
    <FormDialog heading={`${edit ? "Edit" : "Add"} ${level}`} description="Changes are shared across this workspace."
      hideDescription onSubmit={submit}>
      {textFields[level].map(field => (
        <TextField key={field.name} {...field} defaultValue={edit && Reflect.get(edit, field.name)}
          maxLength={field.name === "description" ? 500 : 100} readOnly={field.name === "id" && !!edit} />
      ))}
      {level === "project" && (
        <LabeledSelect<string, true> label="System revisions" multiple options={revisions}
          value={[...revisionIds]} onChange={setRevisionIds}
          display={revisionIds.length ? `${revisionIds.length} selected` : "Choose revisions"}>
          {revisionIds.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">
            {revisions.filter(r => retained.has(r.value)).map(r => r.label).join(", ")}
          </p>}
        </LabeledSelect>
      )}
      {level === "unit" && <>
        <LabeledSelect label="System revision" options={revisions} value={revisionId} onChange={id => {
          setRevisionId(id);
          if (!assignmentOptions(catalog, id, unit).some(option => option.value === projectId)) setProjectId("");
        }} />
        <LabeledSelect label="Project assignment" options={assignmentOptions(catalog, revisionId, unit)}
          value={projectId} onChange={id => setProjectId(id ?? "")} />
        <TextField label="Batch" name="batch" defaultValue={unit?.batch} maxLength={100} />
      </>}
    </FormDialog>
  );
}
