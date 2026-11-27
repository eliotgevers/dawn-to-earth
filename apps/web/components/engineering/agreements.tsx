"use client";
import { DecisionDialog, useDraftRows } from "@/components/records/case-form";
import { useRef, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { LabeledSelect, NoteField, TextField } from "@/components/records/forms";
import { sameUnit, latestRecordEdit, recordKinds } from "@/lib/records/journal";
import { connectionToRecord } from "@/components/records/schema";
import { acceptanceReviewConnection } from "@/components/verification/acceptance";
import { ConnectionList } from "@/components/records/links";
import { recordHref, type RecordConnection } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import { CaseList, DecisionHistory } from "@/components/records/case-list";
import { CompareDialog, CompareFields } from "@/components/records/compare-dialog";
import { unitSelection } from "@/components/workspace/selection";
import { WorkspaceLink } from "@/components/workspace/section-tabs";
import { toolHref, withSelections } from "@/lib/workspace-routes";
import type { ToolProps } from "@/components/workspace/workbench";
import type { WorkCase } from "@/db/workflows/cases";
import {
  agreementData,
  agreementHistory,
  assignment,
  changedClauses,
  obligationKinds,
  receiptOutcome,
  type Agreement,
  type Notice,
  type Obligation,
} from "@/db/workflows/agreements";

type History = ReturnType<typeof agreementHistory>;
type Edition = Agreement["documents"][0];
function stageLabel(record: WorkCase, { current, baseline }: History) {
  if (!current) return baseline.acknowledgement ? `Agreed scope · ${baseline.edition}` : "Compare clauses";
  if (!current.outcome) return "Awaiting acknowledgement";
  if (current.outcome.kind === "withdrawal") return "Notice withdrawn";
  if (receiptOutcome(current.outcome).decision === "Retain baseline") return "Baseline retained";
  const remaining = changedClauses(agreementData(record), baseline).length;
  return remaining
    ? `Agreed · ${remaining} open ${remaining === 1 ? "difference" : "differences"}`
    : "Agreed";
}

export default function Agreements(props: ToolProps) {
  if (props.dossier) return <AgreementCase {...props} record={props.dossier} />;
  return (
    <CaseList
      label="Agreements"
      rows={props.cases.map((record) => ({
        record,
        detail: ["Demo agreement", agreementData(record).reference, record.unit?.serial, record.unit?.revision]
          .filter(Boolean)
          .join(" · "),
        status: stageLabel(record, agreementHistory(record)),
      }))}
    />
  );
}

function ClauseWording({ clauses, edition }: { clauses: Agreement["clauses"]; edition: Edition | Notice }) {
  const notice = "obligations" in edition ? edition : undefined;
  return <dl className="divide-y">
    {clauses.map(({ id, title }) => {
      const obligation = notice?.obligations.find(item => item.clauseId === id);
      return <div key={id} className="py-2">
        <dt className="font-semibold">{title}</dt>
        <dd>{edition.clauses[id] ?? (notice && "Clause omitted from notice edition")}</dd>
        {obligation && <dd className="mt-0.5 text-xs text-muted-foreground">{obligation.kind} · {obligation.instruction}</dd>}
      </div>;
    })}
  </dl>;
}

function DocumentSource({
  document: doc,
  title,
  clauses,
}: {
  document: Edition;
  title: string;
  clauses: Agreement["clauses"];
}) {
  return (
    <div
      className="min-w-0"
      id={doc.acknowledgement && `scope-${doc.acknowledgement.versionId}`}
      tabIndex={doc.acknowledgement && -1}
    >
      <p className="mt-0.5 text-xs text-muted-foreground">{title}</p>
      <strong>{doc.edition}</strong>
      <p className="text-sm">
        {doc.receipt} · <time dateTime={doc.received}>{doc.received}</time>
      </p>
      {doc.acknowledgement && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Acknowledged by {doc.acknowledgement.by || "Unavailable"} · {doc.acknowledgement.source}
        </p>
      )}
      {(doc.acknowledgement || title === "Original baseline") && (
        <details className="mt-1 text-sm">
          <summary>Scope wording</summary>
          <ClauseWording clauses={clauses.filter(clause => clause.id in doc.clauses)} edition={doc} />
        </details>
      )}
    </div>
  );
}

function NoticeWording({
  notice,
  clauses,
  anchor,
  open,
}: {
  notice: Notice;
  clauses: Agreement["clauses"];
  anchor?: string;
  open?: boolean;
}) {
  return (
    <details id={anchor} open={open} tabIndex={-1}>
      <summary>Notice wording and obligations · {notice.edition}</summary>
      <p>{notice.purpose}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {notice.baselineEdition && `${notice.baselineEdition} → `}
        {notice.edition} · {notice.sourceReceipts.join(" · ")}
      </p>
      <ClauseWording clauses={clauses} edition={notice} />
    </details>
  );
}

function AgreementCase({
  record,
  tasks,
  workspace,
  personName,
  submit,
}: ToolProps & { record: WorkCase }) {
  const agreement = agreementData(record);
  const { current, history, baseline, adoptedNotices } = agreementHistory(record);
  const [original, requested] = agreement.documents;
  const sources = agreement.related.map(source => ({
    ...source, link: agreementSource(source, record.unit, workspace),
  }));
  const missing = sources.filter(source => !source.link);

  const pendingNotice = current && !current.outcome ? current : undefined;
  const journal = history.filter((entry) => entry.id !== pendingNotice?.id);
  const person = (id: string) => personName(id, id);
  const heading = useRef<HTMLHeadingElement>(null);
  const [announcement, announce] = useState("");
  const form = {
    submit,
    people: workspace.actors,
    description: `${agreement.reference} · ${record.title}`,
    saved: () => {
      announce("Agreement record updated.");
      requestAnimationFrame(() => heading.current?.focus());
    },
  };
  return (
    <article aria-label={record.title} className="grid gap-2.5 pt-2 wrap-anywhere">
      <WorkspaceLink direction="back" href={toolHref("agreements")}>
        Agreements
      </WorkspaceLink>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold" ref={heading} tabIndex={-1}>
            {record.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Demo agreement · {agreement.reference} · {record.unit?.serial} · {record.unit?.revision}
          </p>
        </div>
        <CompareDialog title={`Compare agreement · ${agreement.reference}`}>
          <AgreementEditions agreement={agreement} baseline={baseline} adoptedNotices={adoptedNotices} />
        </CompareDialog>
      </header>
      <section
        aria-label="Agreement versions"
        className="grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-2"
      >
        <DocumentSource
          document={baseline}
          title={baseline.acknowledgement ? "Agreed scope" : "Original baseline"}
          clauses={agreement.clauses}
        />
        <DocumentSource document={requested} title="Requested edition" clauses={agreement.clauses} />
        {baseline !== original && (
          <DocumentSource document={original} title="Original baseline" clauses={agreement.clauses} />
        )}
      </section>

      {pendingNotice && (
        <section id={pendingNotice.id} tabIndex={-1} aria-label="Current notice" className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Change notice {pendingNotice.data.number} · Awaiting acknowledgement</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {person(pendingNotice.actor)} ·{" "}
            <time dateTime={pendingNotice.at}>{formatUtcDateTime(pendingNotice.at)}</time>
          </p>
          <NoticeWording
            open
            notice={pendingNotice.data}
            clauses={agreement.clauses}
            anchor={`scope-${pendingNotice.id}`}
          />
          <div className="flex flex-wrap gap-2" key={pendingNotice.id}>
            <DecisionDialog {...form} heading="Record agreement" command={{ action: "agreement", data: { noticeId: pendingNotice.id } }}>
              <LabeledSelect
                label="Agreed edition"
                name="decision"
                placeholder="Choose the acknowledged edition"
                required
                options={[
                  { value: "Adopt notice", label: `${pendingNotice.data.edition} · adopt notice` },
                  { value: "Retain baseline", label: `${baseline.edition} · retain baseline` },
                ]}
              />
              <TextField label="Acknowledged by" name="acknowledgedBy" required maxLength={100} />
              <TextField label="Acknowledgement reference" name="evidence" required maxLength={180} />
            </DecisionDialog>
            <DecisionDialog {...form} heading="Withdraw notice" variant="ghost" command={{ action: "withdraw", data: { noticeId: pendingNotice.id } }}>
              <NoteField label="Reason for withdrawal" name="reason" required maxLength={500} rows={2} />
            </DecisionDialog>
          </div>
        </section>
      )}

      <NoticeClauses caseTitle={record.title} agreement={agreement} baseline={baseline} current={current} form={form} person={person} />

      {tasks.length > 0 && (
        <section aria-label="Downstream obligations">
          <h3 className="text-[13px] font-semibold">Agreed obligations</h3>
          <ul className="divide-y">
            {tasks.map((task) => {
              const options = sources.flatMap(source => source.section === task.section && source.link
                ? [{ value: source.id, label: source.link.label }] : []);
              return (
                <li
                  key={task.id}
                  id={task.sourceId}
                  tabIndex={-1}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <strong className="text-sm">{task.title}</strong>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {person(task.owner)} · {task.section} · {task.completedAt ? "Complete" : "Open"}
                    </p>
                  </div>
                  {!task.completedAt && (
                    <DecisionDialog {...form} heading="Record result" variant="outline"
                      aria-label={`Record result for ${task.title}`}
                      command={{ action: "complete", data: { taskId: task.id } }}
                      description={task.title}
                    >
                      <NoteField label="Result" name="result" required maxLength={500} rows={2} />
                      {options.length > 0 && (
                        <LabeledSelect
                          label="Supporting record"
                          name="recordId"
                          placeholder="Choose a record, or enter a reference"
                          options={options}
                        />
                      )}
                      <TextField label="Source reference" name="evidence" maxLength={180} required={!options.length} />
                    </DecisionDialog>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <ConnectionList title="Agreement obligations" links={[
        ...agreementLinks(record, workspace, baseline),
        ...sources.flatMap(source => source.link ?? []),
      ]} />
      {missing.length > 0 && <p className="text-sm text-muted-foreground">
        Sources unavailable for this unit and revision · {missing.map(source => source.id).join(" · ")}
      </p>}
      {journal.length > 0 && (
        <section aria-label="Agreement history">
          <h3 className="text-[13px] font-semibold">History</h3>
          <DecisionHistory events={journal} name={person} rowClass="py-2 text-sm">
            {entry => {
              if (entry.kind === "notice") return <NoticeWording
                notice={entry.data as Notice} clauses={agreement.clauses}
                anchor={entry.id !== baseline.acknowledgement?.versionId ? `scope-${entry.id}` : undefined}
              />;
              if (entry.kind === "agreement") {
                const outcome = receiptOutcome(entry);
                return <p>{outcome.decision} · Acknowledged by {outcome.acknowledgedBy || "Unavailable"} · {outcome.evidence}</p>;
              }
              if (entry.kind === "withdrawal") return <p>{String(entry.data.reason)}</p>;
              if (entry.kind !== "follow-through") return null;
              const task = tasks.find(task => task.id === entry.data.taskId);
              const source = sources.find(row => row.section === task?.section && row.id === entry.data.recordId)?.link;
              return <>
                <p>{[entry.data.outcome, entry.data.evidence].filter(Boolean).join(" · ")}</p>
                {source ? <ConnectionList title="Supporting record" links={[source]} />
                  : entry.data.recordId ? <p>Supporting record unavailable · {String(entry.data.recordId)}</p> : null}
              </>;
            }}
          </DecisionHistory>
        </section>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </article>
  );
}

function AgreementEditions({ agreement, baseline, adoptedNotices }: {
  agreement: Agreement;
  baseline: Edition;
  adoptedNotices: History["adoptedNotices"];
}) {
  const [original, requested] = agreement.documents;
  const left = { label: `Original · ${original.edition}`, source: original.receipt, clauses: original.clauses };
  const right = { label: `Requested · ${requested.edition}`, source: requested.receipt, clauses: requested.clauses };
  const pairs = [{ id: "request", left, right }];
  for (const { id, data, outcome } of adoptedNotices) {
    pairs.push({
      id,
      left,
      right: {
        label: `Adopted · ${data.edition} (notice ${data.number})`,
        source: outcome ? receiptOutcome(outcome).evidence : "",
        clauses: data.clauses,
      },
    });
  }
  const latest = pairs.at(-1)!;
  if (adoptedNotices.length && changedClauses(agreement, baseline).length) {
    pairs.push({ id: "remaining", left: latest.right, right });
  }
  const [pairId, setPairId] = useState(latest.id);
  const pair = pairs.find(pair => pair.id === pairId) ?? latest;
  return <div className="grid min-w-0 gap-4">
    {pairs.length > 1 && <LabeledSelect
      label="Editions"
      value={pair.id}
      options={pairs.map(({ id, left, right }) => ({ value: id, label: `${left.label} → ${right.label}` }))}
      onChange={id => { if (id) setPairId(id); }}
    />}
    <CompareFields key={pair.id}
      referenceLabel={pair.left.label}
      proposedLabel={pair.right.label}
      fields={agreement.clauses.filter(clause => clause.id in pair.left.clauses || clause.id in pair.right.clauses).map(clause => ({
        id: clause.id,
        label: clause.title,
        before: pair.left.clauses[clause.id] ?? "No clause in this edition",
        after: pair.right.clauses[clause.id] ?? "No clause in this edition",
      }))}
    />
    <details className="text-sm">
      <summary className="w-fit cursor-pointer">Edition sources</summary>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
        {[pair.left, pair.right].map(side => <div key={side.label}>
          <dt className="text-muted-foreground">{side.label}</dt>
          <dd>{side.source}</dd>
        </div>)}
      </dl>
    </details>
  </div>;
}

function NoticeClauses({ caseTitle, agreement, baseline, current, form, person }: {
  caseTitle: string;
  agreement: Agreement;
  baseline: Edition;
  current: History["current"];
  form: Pick<ComponentProps<typeof DecisionDialog>, "submit" | "people" | "description" | "saved">;
  person: (id: string) => string;
}) {
  const editable = !current || !!current.outcome;
  const selected = useDraftRows<Obligation>();
  const obligations = [...selected.rows.values()];
  const changed = changedClauses(agreement, baseline);
  if (!editable) return null;
  return (
    <section aria-label="Change notice clauses">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Change notice clauses</h3>
        {changed.length > 0 && (
          <DecisionDialog {...form} heading="Prepare change notice" variant="outline"
            key={current?.id ?? "first-notice"}
            disabled={!obligations.length}
            command={{ action: "assemble", data: { previousNoticeId: current?.id ?? null, obligations } }}
            saved={id => {
              selected.clear();
              form.saved(id);
            }}
          >
            <TextField key="purpose" label="Reason for change" name="purpose" maxLength={500} required />
            {obligations.map((item) => {
              const clause = agreement.clauses.find((row) => row.id === item.clauseId);
              return (
                <fieldset className="grid min-w-0 gap-2" key={item.clauseId}>
                  <legend className="text-sm font-semibold">{clause?.title}</legend>
                  <LabeledSelect
                    label="Obligation type"
                    options={obligationKinds}
                    value={item.kind}
                    onChange={(kind) => {
                      if (kind) selected.update(item.clauseId, { ...item, kind });
                    }}
                  />
                  <NoteField label="Downstream action"
                      rows={2}
                      required
                      value={item.instruction}
                      maxLength={300}
                      onChange={(event) => selected.update(item.clauseId, { ...item, instruction: event.target.value })} />
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {person(assignment[item.kind].owner)} · {assignment[item.kind].section}
                  </p>
                </fieldset>
              );
            })}
          </DecisionDialog>
        )}
      </div>
      {!changed.length && <p className="mt-0.5 text-xs text-muted-foreground">All clauses match the requested edition.</p>}
      <ul className="divide-y">
        {changed.map((row) => {
          const included = selected.rows.has(row.id);
          return (
            <li className="grid gap-2 py-3" key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  {row.title === caseTitle ? row.kind : row.title} <span className="block mt-0.5 text-xs text-muted-foreground">{row.difference}</span>
                </h4>
                <Button
                  size="sm"
                  variant={included ? "secondary" : "outline"}
                  aria-pressed={included}
                  aria-label={`Include ${row.title} in notice`}
                  onClick={() => selected.update(row.id,
                    included ? undefined : { clauseId: row.id, kind: row.kind, instruction: row.instruction })}
                >
                  {included ? "Included" : "Include"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{row.instruction}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function agreementSource(
  source: Agreement["related"][number],
  unit: WorkCase["unit"],
  workspace: ToolProps["workspace"],
): RecordConnection | undefined {
  if (source.section === "verification") {
    const check = workspace.checks.find(row => row.id === source.id && sameUnit(row.unit, unit));
    if (check) return acceptanceReviewConnection(check);

    const evidence = workspace.evidence.find(row => row.id === source.id && sameUnit(row.unit, unit));
    return evidence && connectionToRecord("verification", evidence);
  }
  const record = workspace.assembly.find(row => row.id === source.id &&
    recordKinds[row.kind].section === source.section && (!row.unit || sameUnit(row.unit, unit)));
  if (!record) return;
  const edit = unit && latestRecordEdit(workspace.local, record.id, unit);

  return connectionToRecord(source.section, {
    ...record, unit: unit ?? undefined, title: edit?.title ?? record.title,
  });
}

function agreementLinks(
  record: WorkCase,
  workspace: ToolProps["workspace"],
  baseline: Edition,
): RecordConnection[] {
  const agreement = agreementData(record);
  const unit = record.unit;
  const links: RecordConnection[] = [];
  const project = workspace.catalog.projects.find(project => project.id === agreement.projectId);
  if (project) links.unshift({
    href: `/catalog?view=projects#catalog-projects-${project.id}`,
    location: "Catalog · Projects", label: project.title,
  });
  if (unit && baseline.acknowledgement && workspace.hasUnitAcceptance) links.unshift({
    href: recordHref("operations", `unit-${unit.serial}-${unit.revisionId}`, unit),
    location: "Operations · Readiness", label: `Delivery readiness · ${unit.serial}`,
    identity: `Agreed scope · ${baseline.edition}`,
  });
  for (const comparison of workspace.qualificationCases) {
    links.push({
      href: withSelections(toolHref("qualification", comparison.id), unit ? [unitSelection(unit.serial, unit.revisionId)] : []),
      location: "Engineering · Qualification", label: comparison.requirement ? "Qualification · " + comparison.requirement : comparison.title,
      identity: comparison.title,
    });
  }
  for (const packet of workspace.packets) {
    if (!unit) continue;
    const scope = packet.scopes.find(scope => scope.caseId === record.id && scope.versionId);
    if (scope) links.push({
      href: recordHref("operations", "packet-" + packet.id, unit), location: "Operations · Readiness",
      label: `Packet v${packet.version} · ${scope.edition}`, identity: unit.serial,
    });
  }
  return links;
}
