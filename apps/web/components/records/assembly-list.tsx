"use client";
import { FiledInterfaces, type InterfaceStudy } from "@/components/operations/docking/records";
import { EmptyRecords } from "@/components/records/empty";
import { sectionTabs, sectionTab } from "@/components/records/presentation";
import { RecordResults } from "@/components/records/results";
import { RelatedWork } from "@/components/workspace/related-work";
import { MissingRecord, SectionTabs, SectionSubview } from "@/components/workspace/section-tabs";
import { coreView, primary, toolHref, withSelections } from "@/lib/workspace-routes";
import { InternalLink } from "@/components/records/links";
import { ProductionPlanning } from "@/components/production/planning";
import { engineeringOverviewRows } from "@/components/engineering/overview";
import { changeImpactChoices } from "@/components/engineering/records";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  GroupedRecordRows,
  RecordRow,
  RecordDetails,
  BuildRecordDetails,
  WorkspaceOverview,
} from "@/components/records/layout";
import { AssemblyRecordActions, RecordNotes } from "@/components/records/actions";
import { RecordDialog, RecordDialogs } from "@/components/records/forms";
import { assemblyStatusTone, openChanges, sameUnit, recordKinds, visibleRecordNotes, type RecordEntry } from "@/lib/records/journal";
import { type SelectedItem } from "@/components/workspace/selection";
import { engineeringRows, listEntry } from "@/components/records/schema";
import {
  unresolvedIssueMessage,
  executionForBuild,
  productionRegister,
} from "@/components/production/builds";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useItemSelection,
  clearRecordHash,
  focusRecordToolbar,
  focusRelatedRecord,
  replaceRecordHash,
  setListLocation,
  watchRecordLinks,
} from "@/components/workspace/navigation";
import type { AssemblyRecord } from "@/db/records/assembly";
import type { AssemblyRecordKind } from "@/db/schema";
import { useAssembly } from "@/lib/workspace";

function RecordList({
  label,
  kind: defaultKind,
  rows,
  item,
  onRemove,
  linkedRecord,
}: {
  label: string;
  linkedRecord: string;
  kind: AssemblyRecordKind;
  item?: SelectedItem;
  onRemove: (id: string) => void;
  rows: readonly ReturnType<typeof listEntry>[];
}) {
  const workspace = useAssembly();
  const { records: seed, local } = workspace;
  const execution = "execution" in workspace ? workspace.execution : undefined;
  return (
    <GroupedRecordRows
      records={defaultKind === "change" ? rows.toSorted((a, b) =>
        Number(openChanges.has(b.status)) - Number(openChanges.has(a.status))) : rows}
      label={label}
      scope={row => row.scope}
    >
      {({ record, build, kind, owner, unit, status, removed, archived, revision, decision, activity, targets }) => {
        const { reference, tone } = record;
        const title = revision?.title ?? record.title;
        const notes = visibleRecordNotes(activity);
        const openLinkedIssue = kind === "issue" && status !== "Resolved" && (
          record.flaggedBuildId ||
          seed.verification.acceptanceChecks.some(check => check.issueId === record.id && sameUnit(check.unit, owner)) ||
          seed.production.some(queue => queue.kind === "queue" &&
            sameUnit(queue.unit ?? seed.verification.article, owner) && queue.overviewLinks?.some(link =>
              link.section === "production" && link.id === record.id))
        );
        const editable = removed || archived ? undefined : unit;
        const notesTarget = { id: record.id, title, kind };
        const entry = build || kind === "issue" || record.origin === "local" ? record : undefined;

        return (
          <RecordRow key={record.id} id={record.id} build={Boolean(build)} status={status}
            tone={archived ? "gray" : !removed && status !== record.status ? assemblyStatusTone(status) : tone}
            title={title} reference={reference} actions={<>
              {kind !== "requirement" && editable && entry && (
                <RecordDialog
                  type="edit"
                  entry={entry}
                  unit={editable}
                />
              )}
              {kind === "requirement" && editable && (
                <RecordDialog
                  type="revise"
                  record={record}
                  seed={seed}
                  item={item}
                  unit={editable}
                  saved={revision}
                />
              )}
              {targets.length > 0 && (
                <RecordDialog
                  type="remove"
                  retentionReason={openLinkedIssue ? unresolvedIssueMessage : undefined}
                  units={targets}
                  entry={{ id: record.id, kind, title }}
                  onSaved={() => onRemove(record.id)}
                />
              )}
            </>}>
            {build ? (
              <BuildRecordDetails
                sourceId={build.history.some(entry => entry.id === linkedRecord) ? linkedRecord : record.id}
                build={build}
                execution={executionForBuild(record.id, owner, execution)}
                local={local}
                owner={owner}
                editable={editable}
                status={status}
              />
            ) : kind === "queue" || kind === "build" ? (
              <AssemblyRecordActions record={record} status={status} unit={editable} activity={activity} />
            ) : (
              <RecordDetails
                record={record}
                seed={seed}
                linked={linkedRecord === record.id}
                workflow={{ status, unit: editable, activity, displayedActivity: decision?.id }}
                {...(kind === "issue" ? { activity, owner } : { kind, local, decision, revision, item })}
              />
            )}
            <RecordNotes target={notesTarget} notes={notes} unit={editable} />
          </RecordRow>
        );
      }}
    </GroupedRecordRows>
  );
}

type AssemblyTab = { id: AssemblyRecordKind; label: string };

const buildStatusLabels = { active: "Incomplete", completed: "Completed", archived: "Archived" };
const buildFilters = ["All", ...Object.values(buildStatusLabels)];
function recordSearch(record: AssemblyRecord, history: readonly AssemblyRecord[] = [], revision?: RecordEntry) {
  if (revision) {
    const { criterion, method, source } = revision.requirementRevision ?? {};
    return [revision.title, revision.description, criterion, method, source].join(" ");
  }

  const { title, unit, reference, status, fields, context } = record;
  return [title, unit?.serial, unit?.revision, reference, status, context, ...fields.flat(),
    ...history.flatMap(entry => [entry.id, entry.title, entry.reference, ...entry.fields.flat()])].join(" ");
}

const designViews = [{id:"components", label:"Components"}, {id:"interfaces", label:"Interfaces"}];

function recordDestination(board: "engineering" | "production", records: readonly AssemblyRecord[], hash: string, view: string | null) {
  const linked = records.find(row => row.id === hash);
  const active = linked?.kind === "queue" ? "build" : linked?.kind ?? coreView(board, view);
  const tab = primary[board].find((entry): entry is AssemblyTab =>
    entry.id === active && entry.id !== "evidence" && Object.hasOwn(recordKinds, entry.id));
  return { active, linked, tab };
}

function useAssemblyRecordLink(records: readonly AssemblyRecord[], selectionUrl: string) {
  const [linkedRecord, setLinkedRecord] = useState("");
  const [missingRecord, setMissingRecord] = useState("");
  const createdId = useRef<string | null>(null);
  function recordSaved(record: RecordEntry) {
    createdId.current = record.id;
    setLinkedRecord(record.id);
  }

  function clearRemovedRecord(id: string) {
    clearRecordHash(id);
    setLinkedRecord("");
    focusRecordToolbar();
  }

  useEffect(() => watchRecordLinks((id) => {
    setLinkedRecord(id);
    if (id) focusRelatedRecord(id);
  }), [selectionUrl]);

  // A newly selected tab or refreshed save can mount the target after its URL changes.
  useEffect(() => {
    if (!linkedRecord) return;

    const frame = requestAnimationFrame(() => {
      const found = focusRelatedRecord(linkedRecord);
      setMissingRecord(found ? "" : linkedRecord);
      if (found && createdId.current === linkedRecord) {
        replaceRecordHash(linkedRecord);
        createdId.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [linkedRecord, records, selectionUrl]);

  return { linkedRecord, missing: Boolean(missingRecord && missingRecord === linkedRecord),
    recordSaved, clearRemovedRecord, clearLinked: () => setLinkedRecord("") };
}

export function AssemblyRecordTabs({ board, interfaceStudy }: { board: "engineering" | "production"; interfaceStudy?: InterfaceStudy }) {
  const workspace = useAssembly();
  const { records: seed, local: localRecords } = workspace;
  const catalog = seed.catalog;
  const { item, selections, selectItems, selectionUrl } = useItemSelection(catalog);
  const query = useSearchParams();
  const { linkedRecord, missing, recordSaved, clearRemovedRecord, clearLinked } =
    useAssemblyRecordLink(seed[board], selectionUrl);
  const { active, linked, tab } = recordDestination(board, seed[board], linkedRecord, query.get("view"));
  const production = "execution" in workspace ? productionRegister(workspace, item, active, linked) : undefined;
  let content;
  if (active === "planning") {
    content = "schedule" in workspace && workspace.schedule
      ? <ProductionPlanning item={item} planning={{ ...workspace.schedule, execution: workspace.execution }} />
      : <p role="status">Planning data is unavailable.</p>;
  } else if (active === "overview" && !missing) {
    content = <>
      {!item ? <EmptyRecords unselected />
        : "engineeringWork" in workspace ? <WorkspaceOverview kind="engineering" seed={seed} item={item}
            records={localRecords} rows={engineeringOverviewRows(workspace, item)} />
        : <WorkspaceOverview kind="production" rows={production?.rows ?? []} />}
      <RelatedWork section={board} item={item} tasks={workspace.toolTasks} />
    </>;
  } else if (tab) {
    content = <AssemblyList interfaceStudy={interfaceStudy} tab={tab} board={board} item={item} selections={selections}
      linked={linked} linkedRecord={linkedRecord}
      production={production} onSaved={recordSaved} onRemove={clearRemovedRecord}
      clearLinked={clearLinked} />;
  }
  return (
    <SectionTabs section={board} active={active} catalog={catalog} selections={selections} onChange={selectItems}>
      {missing && <MissingRecord id={linkedRecord} />}
      {content}
    </SectionTabs>
  );
}

type AssemblyListProps = {
  interfaceStudy?: InterfaceStudy;
  tab: AssemblyTab; board: "engineering" | "production"; item?: SelectedItem;
  selections: ReturnType<typeof useItemSelection>["selections"];
  linked?: AssemblyRecord; linkedRecord: string;
  production: ReturnType<typeof productionRegister>; onSaved: (record: RecordEntry) => void; onRemove: (id: string) => void;
  clearLinked: () => void;
};

function assemblyRows({ tab, board, item, linked: target, production }: AssemblyListProps,
  seed: ReturnType<typeof useAssembly>["records"], local: readonly RecordEntry[], query: URLSearchParams) {
  const isBuilds = tab.id === "build";
  const linkedBuild = production?.linkedBuild;
  const exact = linkedBuild?.record ?? target;
  const exactFilter = linkedBuild?.filter;
  const requested = query.get("filter");
  const buildFilter = !isBuilds ? undefined : requested === "all" ? "All" : exactFilter ? buildStatusLabels[exactFilter] :
    buildFilters.find(label => label.toLowerCase() === requested) ?? "Incomplete";
  const interfaces = tab.id === "configuration" && (exact?.kind === "configuration" ? exact.designKind === "interface" :
    query.get("part") === "interfaces");
  const baseline = seed.verification.article;
  const rows = board === "production"
    ? (production?.rows ?? []).map(({ record, build }) => listEntry(record, board, item, baseline, local, [], build))
    : engineeringRows(seed.engineering, tab.id, interfaces, item, baseline, local);
  const linked = exact && !rows.some(row => row.id === exact.id)
    ? listEntry(exact, board, item, baseline, local, [], linkedBuild, true) : undefined;
  const creation = item && item.members.length && !linked && buildFilter !== "Archived" ? {
    units: item.members, kind: isBuilds && buildFilter !== "Completed" ? "queue" as const : tab.id,
    isInterface: interfaces, requireUnitChoice: !item.unit,
  } : undefined;
  return { rows, linked, buildFilter, interfaces, creation };
}

function listFilter(label: string, buildFilter: string | undefined, status: string | null,
  updateList: (key: string, value: string | null) => void) {
  return buildFilter ? {
    empty: "No builds recorded", statusLabel: "Build status", selectedStatus: buildFilter,
    onStatusChange: (value: string) => updateList("filter", value === "Incomplete" ? null : value.toLowerCase()),
    statusOptions: Object.values(buildStatusLabels),
  } : {
    statusLabel: label + " status", selectedStatus: status ?? "All",
    onStatusChange: (value: string) => updateList("status", value === "All" ? null : value),
  };
}

function AssemblyList(props: AssemblyListProps) {
  const { tab: { id, label }, board, item, selections, linkedRecord, onSaved, onRemove, clearLinked } = props;
  const { records: seed, local } = useAssembly();
  const query = useSearchParams();
  const { rows, linked, buildFilter, interfaces, creation } = assemblyRows(props, seed, local, query);
  const designView = interfaces ? "interfaces" : "components";
  function updateList(key: string, value: string | null) {
    clearLinked();
    setListLocation(id, key, value);
  }
  const filterProps = listFilter(label, buildFilter, query.get("status"), updateList);
  const recordView = { linkedRecord, kind: id, item, onRemove };
  const search = ({ record, build, status, revision }: typeof rows[number]) =>
    status + " " + recordSearch(record, build?.history, revision);

  const add = creation && (
    <RecordDialog
      type="add"
      {...creation}
      onSaved={onSaved}
    />
  );
  const listContent = <RecordDialogs impactChoices={id === "change" ? unit => changeImpactChoices(seed, local, unit) : undefined}>
    {linked && (
      <div className="mb-3">
        {item && !linked.removed && <p className="mt-1 text-[13px] leading-normal text-muted-foreground">Linked record outside selected item</p>}
        <RecordList {...recordView} label="Linked record" rows={[linked]} />
      </div>
    )}
    {interfaces ? <FiledInterfaces catalog={seed.catalog} selections={selections} study={props.interfaceStudy}
      rows={rows} search={search}
      actions={add} render={matches => <RecordList {...recordView} label="Interfaces" rows={matches} />} />
      : !item ? <EmptyRecords unselected /> : (
      <RecordResults
        {...filterProps}
        search={{ value: query.get("q") ?? "", onChange: value => updateList("q", value || null) }}
        records={rows}
        status={row => row.build ? buildStatusLabels[row.build.filter] : row.status}
        actions={
          <>
            {buildFilter === "Completed" && rows.some(row => row.build?.filter === "completed") && <InternalLink href={withSelections(toolHref("improvement"),selections)}>Compare completed orders</InternalLink>}
            {add}
          </>
        }
        searchText={search}
      >
        {matches =>
          <RecordList {...recordView} label={id === "configuration" ? "Components" : label} rows={matches} />}
      </RecordResults>
    )}
  </RecordDialogs>;
  return id === "configuration" ? (
    <Tabs
      className="min-w-0 flex-col"
      value={designView}
      onValueChange={(view) => {
        clearLinked();
        setListLocation("configuration", "part", view === "interfaces" ? view : null);
      }}
    >
      <TabsList variant="line" className={`${sectionTabs} mb-2`} aria-label="Design views" activateOnFocus>
        {designViews.map((view) => <TabsTrigger className={sectionTab} key={view.id} value={view.id}>{view.label}</TabsTrigger>)}
      </TabsList>
      <TabsContent key={designView} value={designView} className="data-ending-style:hidden">
        {listContent}
      </TabsContent>
    </Tabs>
  ) : (
    <SectionSubview section={board} parent={id} active={id} selections={selections}>
      {listContent}
    </SectionSubview>
  );
}
