import { revisionLabel, revisionOptions, type CatalogRevision } from "@/components/catalog/store";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { CompareDialog, CompareFields } from "@/components/records/compare-dialog";
import type { AssemblyRecord } from "@/db/records/assembly";
import { ConnectionList, ConnectionLink } from "@/components/records/links";
import { PersonField, FormDialog, LabeledSelect, NoteField } from "@/components/records/forms";
import { acceptanceReviewConnection, acceptanceState } from "@/components/verification/acceptance";
import { changeImpact } from "@/lib/readiness";
import { recordHref, substantiveValue, type RecordConnection } from "@/lib/records/links";
import { saveWorkspace, useAssembly } from "@/lib/workspace";
import { formatUtcDateTime } from "@/lib/utc-time";
import { sameUnit, type RecordUnit, isRemovedRecord } from "@/lib/records/journal";
import { unitSelection } from "@/components/workspace/selection";
import { productionFollowUp } from "@/components/production/builds";
import { connectionToRecord, recordValues, type LinkableRecord } from "@/components/records/schema";


function comparisonLinks(units: readonly RecordUnit[], { records, local }: ReturnType<typeof useAssembly>) {
  const links = new Map(units.map((u) => [unitSelection(u.serial, u.revisionId), [] as RecordConnection[]]));
  if (!links.size) return links;
  const { verification, production } = records;
  const append = (row: LinkableRecord, section: "production" | "verification") => {
    const unit = row.unit ?? verification.article;
    const group = links.get(unitSelection(unit.serial, unit.revisionId));
    if (group && !isRemovedRecord(row.id, local, unit)) {
      group.push(connectionToRecord(section, { ...row, unit }));
    }
  };

  for (const row of production) if (row.kind === "queue" || row.kind === "build") {
    append(row, "production");
  }
  for (const row of records.evidence) append(row, "verification");

  for (const check of verification.acceptanceChecks) {
    links.get(unitSelection(check.unit.serial, check.unit.revisionId))?.push({
      ...acceptanceReviewConnection(check),
      detail: acceptanceState(check).stage,
    });
  }
  return links;
}

function CompletedImpact({ assignment }: { assignment: ReturnType<typeof useAssembly>["assignments"][number] }) {
  const workspace = useAssembly();
  const links = productionFollowUp(assignment, workspace);
  return <>
    <p>{assignment.conclusion} · {formatUtcDateTime(assignment.completedAt!)}</p>
    {links.length > 0 && <ConnectionList sourceId={assignment.changeId} links={links} title="Production follow-up" />}
  </>;
}


function comparisonForChange(record: AssemblyRecord, workspace: ReturnType<typeof useAssembly>, params: Pick<URLSearchParams, "get">) {
  const { records, assignments } = workspace;
  const pair = params.get("compareChange") === record.id
    ? { fromId: params.get("from"), toId: params.get("to") }
    : assignments.find(a => a.id === params.get("impact") && a.changeId === record.id);
  const owners = records.verification.acceptanceChecks.filter(check => check.changeId === record.id).map(check => check.unit);
  if (record.origin === "local" && record.unit) owners.push(record.unit);
  const { baselines, unitsFor } = changeImpact(records.catalog, record.id, owners);
  const from = baselines.find(r => r.id === pair?.fromId) ?? (baselines.length === 1 ? baselines[0] : undefined);
  const comparisons = records.catalog.revisions.filter(r => r.systemId === from?.systemId && r.id !== from?.id);
  const to = comparisons.find(r => r.id === pair?.toId);
  const canCompareRevisions = baselines.some(r => records.catalog.revisions.some(v => v.systemId === r.systemId && v.id !== r.id));
  return { baselines, comparisons, from, to, canCompareRevisions, unitsFor };
}

export function ChangeImpact({ record, controls, children }: { record: AssemblyRecord; controls: ReactNode; children: ReactNode }) {
  const changeId = record.id;
  const workspace = useAssembly();
  const { records } = workspace;
  const params = useSearchParams();
  const pair = comparisonForChange(record, workspace, params);
  const { from, to, canCompareRevisions, unitsFor } = pair;

  const values = recordValues(record);
  const before = substantiveValue(values.currentState, record.title);
  const after = substantiveValue(values.description, record.title);
  return <>
    <div className="flex flex-wrap gap-1.5 pt-2 pb-0.5 empty:hidden">
      {(before || after || canCompareRevisions) && <CompareDialog title={record.title}>
        <div className="grid gap-5">
          {(before || after) && <CompareFields referenceLabel="Current state" proposedLabel="Proposed change"
            fields={[{ id: "proposal", label: "Change proposal", before, after }]} />}
          {canCompareRevisions && <RevisionPicker changeId={changeId} pair={pair} />}
          {from && to && <RevisionDefinitions from={from} to={to} records={records.engineering} />}
        </div>
      </CompareDialog>}
      {controls}
    </div>
    {children}
    {from && to && <section aria-label="Change impact" className="grid gap-2.5 pt-2 wrap-anywhere">
      <RevisionImpact key={JSON.stringify([from.id, to.id])} changeId={changeId} units={unitsFor(from.id, to.id)} from={from} to={to} />
    </section>}
  </>;
}

function RevisionPicker({ changeId, pair }: { changeId: string; pair: ReturnType<typeof comparisonForChange> }) {
  const { records } = useAssembly();
  const { baselines, comparisons, from, to } = pair;
  function chooseComparison(sourceId: string, comparisonId?: string) {
    const url = new URL(window.location.href);
    url.hash = changeId;
    url.searchParams.delete("impact");
    url.searchParams.set("compareChange", changeId);
    url.searchParams.set("from", sourceId);
    if (comparisonId) url.searchParams.set("to", comparisonId);
    else url.searchParams.delete("to");
    window.history.replaceState(null, "", url);
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {baselines.length === 1 && from ? (
        <dl>
          <dt className="text-xs text-muted-foreground">Recorded revision</dt>
          <dd>{revisionLabel(records.catalog, from)}</dd>
        </dl>
      ) : (
        <LabeledSelect
          label="Recorded revision"
          value={from?.id ?? null}
          options={revisionOptions(records.catalog, baselines)}
          onChange={(id) => { if (id) chooseComparison(id); }}
        />
      )}
      {from && <LabeledSelect
        label="Compare with revision"
        value={to?.id ?? null}
        options={revisionOptions(records.catalog, comparisons)}
        onChange={(id) => chooseComparison(from.id, id ?? undefined)}
      />}
    </div>
  );
}

function RevisionDefinitions({ from, to, records }: { from: CatalogRevision; to: CatalogRevision; records: readonly AssemblyRecord[] }) {
  const before = new Set(from.recordIds);
  const after = new Set(to.recordIds);
  const fields = records.filter(row => row.kind !== "change" && (before.has(row.id) || after.has(row.id))).map(row => {
    const edition = before.has(row.id) ? from : to;
    const href = recordHref("engineering", row.id, undefined, { item: "revision:" + edition.id });
    return {
      id: row.id,
      label: <ConnectionLink connection={{ ...connectionToRecord("engineering", row), href }} />,
      before: before.has(row.id) ? "Listed" : "Unlisted",
      after: after.has(row.id) ? "Listed" : "Unlisted",
    };
  });
  if (!fields.length) return <p className="text-sm text-muted-foreground">Neither revision lists an engineering definition.</p>;
  return <section className="grid gap-2" aria-label="Revision definitions">
    <h3 className="text-sm font-semibold">Revision definitions</h3>
    <CompareFields referenceLabel={from.version} proposedLabel={to.version} fields={fields} />
  </section>;
}

function RevisionImpact({ changeId, from, to, units }: { changeId: string; from: CatalogRevision; to: CatalogRevision; units: readonly RecordUnit[] }) {
  const workspace = useAssembly();
  const { users, assignments } = workspace;
  const [open, setOpen] = useState(false);
  const unitLinks = comparisonLinks(units, workspace);
  const history = assignments.filter((a) => a.changeId === changeId && a.fromId === from.id && a.toId === to.id);
  const eligible = units.filter(
    (u) => !history.some((a) => sameUnit(a, u) && !a.completedAt),
  );
  return (
    <>
      {[from, to].map((revision) => {
        const members = units.filter((unit) => unit.revisionId === revision.id);
        if (!members.length) return null;
        return <section key={revision.id} aria-label={revision.version + " units"}>
          <h4 className="font-semibold">{revision.version} · {members.length} {members.length === 1 ? "unit" : "units"}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{revision.id === from.id
            ? "Recorded baseline. Each review stays with its unit and revision."
            : "Comparison baseline. Check applicability before reusing evidence."}</p>
          <ul className="divide-y">
            {members.map((unit) => {
              const links = unitLinks.get(unitSelection(unit.serial, unit.revisionId))!;
              return <li key={unit.serial} className="py-2">
                {links.length ? <details>
                  <summary className="cursor-pointer text-sm"><strong>{unit.serial}</strong> · Unit records ({links.length})</summary>
                  <ConnectionList sourceId={changeId} links={links} />
                </details> : <p><strong>{unit.serial}</strong> · No linked build or inspection records</p>}
              </li>;
            })}
          </ul>
        </section>;
      })}
      <Dialog.Root<"assign" | (typeof history)[number]> open={open} onOpenChange={setOpen}>
        {({ payload }) => <>
          {eligible.length > 0 && <Dialog.Trigger payload="assign" render={<Button size="sm" variant="outline" className="w-fit" />}>
            Assign impact review
          </Dialog.Trigger>}
          {history.map((a) => (
            <div key={a.id} className="grid gap-1 py-1" id={a.id}>
              <strong>
                {a.serial} · {a.completedAt ? "Review completed" : "Review assigned"}
              </strong>
              <span className="block mt-0.5 text-xs text-muted-foreground">
                {users.find((u) => u.id === a.owner)?.name} · {formatUtcDateTime(a.createdAt)}
              </span>
              <p>{a.reason}</p>
              {a.completedAt ? (
                <CompletedImpact assignment={a} />
              ) : (
                <Dialog.Trigger payload={a} render={<Button variant="outline" size="sm" className="w-fit" />}>Record impact conclusion</Dialog.Trigger>
              )}
            </div>
          ))}
          {open && payload && <FormDialog
            heading={payload === "assign" ? "Assign impact review" : "Record impact conclusion"}
            description={payload === "assign" ? from.version + " → " + to.version : payload.serial + " · " + payload.reason}
            submit={payload === "assign" ? "Assign" : "Save"}
            onSubmit={async form => {
              const result = await saveWorkspace(payload === "assign" ? {
                operation: "assign-impact", changeId, fromId: from.id, toId: to.id,
                targets: form.getAll("units"), owner: form.get("owner"), reason: form.get("reason"),
              } : { operation: "complete-impact", id: payload.id, conclusion: form.get("conclusion") });
              return result.error || (() => setOpen(false));
            }}
          >
            {payload === "assign" ? <>
              <LabeledSelect<string, true> multiple name="units" label="Units to review"
                options={eligible.map(u => ({value: unitSelection(u.serial, u.revisionId), label: u.serial + " · " + u.revision}))} />
              <PersonField label="Reviewer" placeholder="Choose reviewer" name="owner" people={users} />
              <NoteField label="Review question" name="reason" required maxLength={1000} />
            </> : <NoteField label="Conclusion" name="conclusion" required maxLength={1000} />}
          </FormDialog>}
        </>}
      </Dialog.Root>
    </>
  );
}
