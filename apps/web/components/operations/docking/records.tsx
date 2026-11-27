"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RecordResults } from "@/components/records/results";
import { EmptyRecords } from "@/components/records/empty";
import { CompareDialog } from "@/components/records/compare-dialog";
import type { Catalog } from "@/components/catalog/store";
import type { ItemSelection } from "@/components/workspace/selection";
import { studyScope, interfaceCompareHref } from "@/lib/archives/study";
import { withSelections } from "@/lib/workspace-routes";
import { selectInterface } from "@/lib/archives/docking";

export type InterfaceStudy = { subject?: string; unavailable: boolean; content: ReactNode };

export function FiledInterfaces<T extends { id: string; status: string }>({ catalog, selections, study, rows, search, actions, render }: {
  catalog: Catalog; selections: readonly ItemSelection[]; study?: InterfaceStudy;
  rows: T[]; search: (row: T) => string; actions: ReactNode; render: (rows: T[]) => ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("compare");
  const scope = studyScope(catalog, selections, "docking");
  const subjects = selections.length ? scope.targets.flatMap(t => t.subjects)
    : requested ? scope.availableArchives.flatMap(a => a.subjects) : [];
  const selected = selectInterface(subjects, params, study?.subject);
  const unavailable = selected.unavailable || study?.unavailable;

  function recordListQuery() {
    const query = new URLSearchParams(params);
    for (const key of ["compare", "feature", "rev", "finding"]) query.delete(key);
    query.set("view", "configuration");
    query.set("part", "interfaces");
    return query;
  }
  const close = () => router.replace(withSelections("/engineering?" + recordListQuery(), selections), { scroll: false });
  const index = [
    ...selected.records.map(archive => ({ id: "interface-" + archive.key, archive })),
    ...rows.map(record => ({ id: record.id, record })),
  ];
  if (!index.length && !unavailable && !selections.length) return <EmptyRecords unselected />;
  return <>
    {unavailable && <div className="mb-3 flex items-baseline gap-3 text-sm" role="status">
      <span>The requested interface comparison is unavailable in this selection.</span>
      <button type="button" className="text-primary underline" onClick={close}>Back to Interfaces</button>
    </div>}
    <RecordResults records={index} actions={actions} statusLabel="Interface status" status={row =>
      "archive" in row ? "Filed" : row.record.status} searchText={row => "record" in row ? search(row.record) :
        [row.archive.name, row.archive.connection, ...row.archive.editions, row.archive.filing.serial].filter(Boolean).join(" ")}>
    {matches => <>
      {matches.some(row => "archive" in row) && <ul aria-label="Filed interface revisions" className="divide-y border-y">
      {matches.flatMap(row => "archive" in row ? [row.archive] : []).map(record => {
        const open = selected.record?.key === record.key && !unavailable;
        return <li key={record.key} id={"interface-" + record.key} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="font-medium">{record.name}</p>
            <p className="text-sm text-muted-foreground">{record.connection} · {record.editions.join(" → ")}</p></div>
          <CompareDialog title={record.name} open={Boolean(open)}
            onOpen={() => {
              const q = recordListQuery();
              q.set("feature", record.features[0]);
              router.push(withSelections(interfaceCompareHref(q, record.key), selections), { scroll: false });
            }} onClose={close}>{open && (study?.content ?? <p role="status">Opening comparison…</p>)}</CompareDialog>
        </li>;
      })}
      </ul>}
      {matches.some(row => "record" in row) && render(matches.flatMap(row => "record" in row ? [row.record] : []))}
    </>}
    </RecordResults>
  </>;
}
