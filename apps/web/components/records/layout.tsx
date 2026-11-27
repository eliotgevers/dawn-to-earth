import { EmptyRecords } from "@/components/records/empty";
import { sameUnit, type RecordEntry } from "@/lib/records/journal";
import { badgeTones, recordLink } from "@/components/records/presentation";
import { ModelValidation } from "@/components/engineering/model-workbench";
import { RevisionFileLink } from "@/components/catalog/revision-files";
import { DocumentReview } from "@/components/engineering/document-review";
import { cn } from "cn";
import { Fragment, Suspense, type ComponentProps, type ReactNode } from "react";
import { RecordResults } from "./results";
import { Badge } from "@/components/ui/badge";
import { connectionToRecord, engineeringScope, groupByApplicability, type RecordApplicability } from "@/components/records/schema";
import { engineeringDetails, type EngineeringDetails } from "@/components/engineering/records";
import { buildDetails, issueFacts, type BuildDetails, type IssueDetails } from "@/components/production/builds";
import type { VerificationTest } from "@/components/verification/model";
import { formatUtcDateTime } from "@/lib/utc-time";
import { AssemblyRecordActions, RecordNotes } from "@/components/records/actions";
import { ConnectionLink, ConnectionList } from "@/components/records/links";
import { compareWork, linkedWork, recordConnection, recordHref, recordUnitLabel } from "@/lib/records/links";
import { useAssembly } from "@/lib/workspace";
import { type SelectedItem } from "@/components/workspace/selection";
import type { AssemblyRecord, WorkspaceRecords } from "@/db/records/assembly";

export function RecordFacts({
  entries,
  layout = "metadata",
  divided = false,
}: {
  entries: readonly (readonly [string, ReactNode])[];
  layout?: "metadata" | "primary" | "paired";
  divided?: boolean;
}) {
  if (!entries.length) return null;
  const primary = layout === "primary";
  return (
    <dl className={cn(primary && "grid gap-2", divided && "my-4 divide-y")}>
      {entries.map(([label, value]) => (
        <div key={label} className={cn("grid min-w-0 gap-x-2 gap-y-0.5", divided ? "py-2" : "py-0.5",
          layout === "metadata" && "min-[551px]:grid-cols-[135px_minmax(0,1fr)]", layout === "paired" && "grid-cols-2")}>
          <dt className={primary ? "text-xs font-semibold" : "text-xs text-muted-foreground"}>{label}</dt>
          <dd className={cn("min-w-0 wrap-anywhere text-[13px]", primary && "whitespace-pre-wrap")}>{typeof value === "string" && !value.trim() ? "Unavailable" : (value ?? "Unavailable")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GroupedRecordRows<T>({
  records,
  scope,
  label,
  children,
}: {
  records: readonly T[];
  scope: (record: T) => RecordApplicability | undefined;
  label: string;
  children: (record: T) => ReactNode;
}) {
  if (!records.length) return <EmptyRecords />;
  return (
    <ul className="[&>:not([data-applicability],[hidden])+:not([data-applicability],[hidden])]:border-t grid grid-cols-[fit-content(36%)_minmax(0,1fr)_max-content] gap-x-2 *:col-span-full *:grid *:grid-cols-subgrid" aria-label={label}>
      {groupByApplicability(records, scope).map(([key, group]) => (
        <Fragment key={key}>
          {group.scope && (
            <li data-applicability className="px-1 pt-2.5 pb-1 text-muted-foreground">
              <h3 className="col-span-full wrap-anywhere text-xs font-semibold">{group.scope.label}</h3>
            </li>
          )}
          {group.records.map(children)}
        </Fragment>
      ))}
    </ul>
  );
}

// Assembly rows are native details; Verification tracks its open evidence or acceptance case in the URL.
export function RecordRow({ id, status, tone, title, reference, build, expanded, toggle, rowAnchor, actions, mobileTitleFirst, children }: {
  id: string; status: string; tone: string; title: string; reference: string;
  build?: boolean; expanded?: boolean; toggle?: () => void; rowAnchor?: boolean;
  actions?: ReactNode; mobileTitleFirst?: boolean; children: ReactNode;
}) {
  const header = cn("col-span-full row-start-1 grid cursor-pointer grid-cols-subgrid items-center px-1 py-2.5 text-start hover:bg-muted focus-visible:bg-muted",
    mobileTitleFirst && "max-sm:flex max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-1");
  const heading = (
    <>
      <Badge variant="outline" className={cn(`col-start-1 h-auto min-h-[22px] w-auto justify-self-stretch px-2 text-center leading-tight wrap-anywhere whitespace-normal max-sm:px-1 ${badgeTones[tone] ?? ""}`, mobileTitleFirst && "max-sm:order-1 max-sm:whitespace-nowrap max-sm:px-2")}>
        {status}
      </Badge>
      <span className={cn("col-start-2 min-w-0 wrap-anywhere", mobileTitleFirst && "max-sm:contents")}>
        <strong className="text-sm font-semibold">{title}</strong>
        <small className={cn("block mt-0.5 text-xs text-muted-foreground", mobileTitleFirst && "max-sm:order-2 max-sm:basis-full")}>{reference}</small>
      </span>
    </>
  );
  const body = <div className="min-w-0 px-1 pb-3">{children}</div>;
  return (
    <li id={rowAnchor ? id : undefined} tabIndex={rowAnchor ? -1 : undefined}
      className={cn("has-[>details[open]]:bg-muted", expanded && "bg-muted", rowAnchor && "scroll-mt-[calc(var(--header)+12px)]")}>
      {toggle ? <>
        <button type="button" id={rowAnchor ? undefined : id} className={cn(header, !rowAnchor && "scroll-mt-[calc(var(--header)+12px)]")}
          aria-expanded={expanded} aria-controls={id + "-body"} onClick={toggle}>{heading}</button>
        <div id={id + "-body"} className="col-span-full row-start-2 min-w-0" hidden={!expanded}>{expanded && body}</div>
      </> : (
        <details id={id} tabIndex={-1} data-production-build={build ? "" : undefined}
          className="scroll-mt-[calc(var(--header)+12px)] col-span-full row-[1/3] grid grid-cols-subgrid grid-rows-subgrid details-content:col-span-full details-content:row-start-2 details-content:min-w-0">
          <summary className={cn(header, "list-none [&::-webkit-details-marker]:hidden")}>{heading}</summary>
          {body}
        </details>
      )}
      {actions && <div className="z-1 col-start-3 row-start-1 flex items-center justify-self-end self-center gap-0.5 pe-1 max-[550px]:[&_button]:w-[27px] max-[550px]:[&_button]:px-0">{actions}</div>}
    </li>
  );
}

function documentReviewScope(props: EngineeringDetails | IssueDetails) {
  if (!("kind" in props)) return props.owner && { mode: "target" as const, members: [props.owner] };
  if (!props.item || props.kind === "requirement") return;
  return { mode: props.kind === "configuration" ? "design" as const : "target" as const, members: props.item.members };
}

export function RecordDetails(props: (EngineeringDetails | IssueDetails) & {
  linked: boolean;
  workflow: Pick<ComponentProps<typeof AssemblyRecordActions>, "status" | "unit" | "activity" | "displayedActivity">;
}) {
  const workspace = useAssembly();
  const { workItems } = workspace;
  const engineering = "kind" in props;
  const document = documentReviewScope(props);
  const detail = engineering ? engineeringDetails(props) : issueFacts(props, "findings" in workspace ? workspace.findings : []);
  const next = detail.next ?? (engineering && props.kind === "requirement" ? linkedWork(detail.links, workItems) : undefined);
  return (
    <AssemblyRecordActions record={props.record} {...props.workflow}
      nextAction={next && <ConnectionLink primary connection={next} sourceId={props.record.id} />}>
      <div className="grid gap-2.5 pt-2 wrap-anywhere">
        <RecordFacts layout="primary" entries={detail.primary} />
        <RecordFacts entries={detail.metadata} />
        {document && <Suspense fallback={null}>
          {document.mode === "design" && <ModelValidation linked={props.linked} key={`model-${props.record.id}`} recordId={props.record.id} members={document.members}/>}
          <DocumentReview linked={props.linked} key={props.record.id} recordId={props.record.id} title={props.record.title} {...document} />
        </Suspense>}
        <ConnectionList sourceId={props.record.id} links={detail.links} primary={next}
          title={"label" in detail ? detail.label : undefined} article={"article" in detail ? detail.article : undefined} />
      </div>
    </AssemblyRecordActions>
  );
}

function UnitChangeReviews({ owner, sourceId }: { owner: NonNullable<BuildDetails["owner"]>; sourceId: string }) {
  const { assignments, users } = useAssembly();
  const impact = assignments.filter(review => sameUnit(review, owner));
  if (!impact.length) return null;
  return (
    <section aria-label="Unit change reviews" className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Unit change reviews</h3>
        <ul className="divide-y">
          {impact.map(a => {
            const href = recordHref("engineering", a.changeId, a, { impact: a.id });
            const name = users.find(u => u.id === a.owner)?.name ?? "Unavailable";
            return <li key={a.id} className="py-2">
              <p><strong>{a.completedAt ? "Reviewed" : "Assigned"} · {name}</strong></p>
              <p>{a.reason}</p>
              {a.completedAt && <p>Conclusion · {a.conclusion ?? "Unavailable"}</p>}
              <ConnectionLink sourceId={sourceId} connection={{
                href, label: a.completedAt ? "Impact conclusion" : "Review change impact", location: "Engineering · Changes",
              }} />
            </li>;
          })}
        </ul>
    </section>
  );
}

export function BuildRecordDetails(props: BuildDetails & { sourceId: string }) {
  const workspace = useAssembly();
  const { build, editable, status, owner } = props;
  const record = build.record;
  const { primary, metadata, events, links, next, article } = buildDetails(props, workspace);
  const History = events.length > 3 ? "details" : "section";
  return (
    <div className="grid gap-2.5 pt-2 wrap-anywhere">
      <AssemblyRecordActions
        nextAction={next && <ConnectionLink primary connection={next} sourceId={props.sourceId} />}
        record={record}
        closeoutBlocked={Boolean(build.work.closeoutLink)}
        status={status}
        unit={editable}
      />
      <RecordFacts layout="primary" entries={primary} />
      <RecordFacts entries={[
        ["Unit revision", owner && <ConnectionLink sourceId={props.sourceId}
          connection={recordConnection("operations", `unit-${owner.serial}-${owner.revisionId}`, owner, {
            label: recordUnitLabel(owner), view: "Unit readiness",
          })} />],
        ...metadata,
      ]} />
      {owner && <UnitChangeReviews owner={owner} sourceId={props.sourceId} />}
      <History data-work-history>
        {History === "details" ? (
          <summary className="w-fit cursor-pointer">
            <h3 className="inline text-[13px] font-semibold">Work history</h3>
            <span className="ml-2 text-xs text-muted-foreground">{events.length} entries</span>
          </summary>
        ) : <h3 className="text-[13px] font-semibold">Work history</h3>}
        {events.length === 0 ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Unavailable</p>
        ) : (
          <ol className="mt-2 grid gap-2.5 ps-1">
            {events.map(({ key, title, at, actor, note, followUp, anchor, facts, notes }) => {
              return (
                <li
                  key={key}
                  id={anchor?.id}
                  tabIndex={anchor && -1}
                  className="scroll-mt-[calc(var(--header)+12px)] grid min-w-0 gap-1 border-s ps-3"
                >
                  <strong className="wrap-anywhere text-[13px] font-semibold">{title}</strong>
                  <span className="block mt-0.5 text-xs text-muted-foreground">
                    {actor && `${actor} · `}
                    {at ? <time dateTime={at}>{formatUtcDateTime(at)}</time> : "Unavailable"}
                  </span>
                  {note && <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{note}</p>}
                  {followUp && <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{followUp}</p>}
                  {facts && <RecordFacts entries={facts} />}
                  {anchor && (
                    <div className="pt-1">
                      <AssemblyRecordActions
                        record={anchor}
                        status={anchor.status}
                        unit={editable}
                      />
                      <RecordNotes
                        target={{ id: anchor.id, kind: "build", title: anchor.title }}
                        notes={notes ?? []}
                        unit={editable}
                        compact
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </History>
      {owner && <RevisionFileLink unit={owner} sourceId={props.sourceId} />}
      <ConnectionList sourceId={props.sourceId} links={links} primary={next} article={article} />
    </div>
  );
}

export type AssemblyOverviewRow = Pick<AssemblyRecord, "id" | "title" | "status" | "tone"> & {
  href: string;
  kind?: string;
  scope?: string;
  owner?: string;
  next?: string;
  decision?: string;
  blocker?: string;
  activity?: string;
  priority: number;
};

type MethodRow = {
  id: VerificationTest;
  title: string;
  status: string;
  tone: string;
  evidenceCount: number;
  evidenceNames: string;
  activity?: string;
};

type OverviewContent =
  | { kind: "production"; rows: readonly AssemblyOverviewRow[] }
  | { kind: "engineering"; rows: readonly AssemblyOverviewRow[]; seed: WorkspaceRecords; item: SelectedItem; records: readonly RecordEntry[] }
  | { kind: "verification"; rows: readonly MethodRow[]; openTest: (id: VerificationTest) => void };

const overviewLink = "cursor-pointer text-left text-[13px] font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring";

const overviewHeadings = {
  verification: ["Test queue", "Test", "Evidence"],
  engineering: ["Engineering decisions and evidence gaps", "Engineering work", "Next step"],
  production: ["Production work and handoffs", "Production work", "Next step"],
};

const queueDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const queueTime = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function WorkspaceOverview(props: OverviewContent) {
  const engineering = props.kind === "engineering" ? props : undefined;
  let empty = props.kind === "production" ? "No production records" : "Unavailable";
  if (engineering && !engineering.rows.length) {
    const visible = engineeringScope(engineering.item, engineering.records);
    if (engineering.seed.engineering.some(visible)) {
      empty = "No open engineering work";
    }
  }
  const unit = engineering?.item.unit;
  const byId = new Map(
    engineering?.seed.engineering.map(record => [record.id, record]),
  );
  const [label, recordHeading, nextHeading] = overviewHeadings[props.kind];
  const verification = props.kind === "verification";
  const rows = props.kind === "engineering" ? props.rows.toSorted(compareWork) : props.rows;
  return (
    <>
      <RecordResults<AssemblyOverviewRow | MethodRow>
        records={rows}
        empty={empty}
        status={verification ? undefined : row => row.status}
        statusLabel={props.kind === "engineering" ? "Engineering work status" : "Production work status"}
        searchText={row => ("evidenceCount" in row
          ? [row.title, row.status, row.evidenceCount, row.evidenceNames, row.activity]
          : [row.title, row.status, row.kind, row.scope, row.owner, row.next, row.decision, row.blocker]).join(" ")}
      >
        {records => (
            <table
              aria-label={label}
              className={cn(
                "w-full table-fixed border-collapse text-left text-xs [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-2.25 [&_:is(th,td)]:wrap-anywhere",
                verification
                  ? "mt-2 max-sm:block max-sm:[&_tbody]:block max-sm:[&_:is(th,td)]:p-0"
                  : "[&_:is(th,td)]:align-top max-sm:[&_:is(th,td)]:px-1 max-sm:[&_:is(th,td)]:py-1.75",
              )}
            >
              <thead className={cn("text-muted-foreground", verification && "max-sm:sr-only")}>
                <tr>
                  <th scope="col" className={verification ? "w-[20%]" : "w-[15%] max-sm:w-[24%]"}>Status</th>
                  <th scope="col" className={verification ? "w-[27%]" : "w-[30%] max-sm:w-[36%]"}>{recordHeading}</th>
                  <th scope="col" className={verification ? "w-[30%]" : "w-[38%] max-sm:w-[40%]"}>{nextHeading}</th>
                  <th scope="col" className={verification ? undefined : "max-sm:hidden"}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => {
                  const { id, title, status, tone, activity } = row;
                  const timestamp = activity ? (
                    <time className="tabular-nums [&_span]:inline-block" dateTime={activity}>
                      {verification ? (
                        <>
                          <span>{queueDate.format(new Date(activity))}</span>{" "}
                          <span>{queueTime.format(new Date(activity))} UTC</span>
                        </>
                      ) : (
                        formatUtcDateTime(activity)
                      )}
                    </time>
                  ) : (
                    "Unavailable"
                  );
                  return (
                    <tr key={id} className={cn("relative border-t hover:bg-muted focus-within:bg-muted [&_td]:text-muted-foreground", verification && "max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 max-sm:px-1 max-sm:py-2 max-sm:after:order-2 max-sm:after:my-0.5 max-sm:after:basis-full max-sm:after:content-['']")}>
                      <td className={verification ? "max-sm:order-1" : undefined}>
                        <Badge
                          variant="outline"
                          className={cn(`${badgeTones[tone] ?? ""}`, "h-auto max-w-full whitespace-normal leading-tight", verification ? "max-sm:whitespace-nowrap" : "px-2 max-sm:px-1")}
                        >
                          {status}
                        </Badge>
                      </td>
                      <th scope="row" className="font-normal">
                        {"evidenceCount" in row ? (
                          <button className={overviewLink} type="button" onClick={() => { if (props.kind === "verification") props.openTest(row.id); }}>
                            {title}
                          </button>
                        ) : (
                          <>
                            <ConnectionLink connection={{ href: row.href, label: title }} className={overviewLink} />
                            {row.kind && <span className="block mt-0.5 text-xs text-muted-foreground">{row.kind}</span>}
                            <span className="block mt-0.5 text-xs text-muted-foreground">{row.scope || "Unavailable"}</span>
                            <span className="block mt-0.5 text-xs text-muted-foreground sm:hidden">
                              Last activity {timestamp}
                            </span>
                          </>
                        )}
                      </th>
                      <td className={verification ? "tabular-nums max-sm:order-3" : undefined}>
                        {"evidenceCount" in row ? (
                          <>{row.evidenceCount}<span className="sm:hidden"> evidence</span></>
                        ) : (
                          <>
                            {row.next || row.blocker || (!row.decision ? "Unavailable" : null)}
                            {row.next && row.blocker && row.blocker !== row.next && (
                              <span className="block mt-0.5 text-xs text-muted-foreground">{row.blocker}</span>
                            )}
                            {row.decision && <span className="block mt-0.5 text-xs text-muted-foreground">Decision · {row.decision}</span>}
                            {row.owner && <span className="block mt-0.5 text-xs text-muted-foreground">{row.owner}</span>}
                          </>
                        )}
                      </td>
                      <td className={verification ? "max-sm:order-4" : "max-sm:hidden"}>{verification && <span className="sm:hidden">Last activity </span>}{timestamp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        )}
      </RecordResults>
      {unit && unit.history.length > 0 && (
        <details key={unit.serial} className="mt-3">
          <summary className={`${recordLink} cursor-pointer`}>Configuration history</summary>
          <ol className="mt-2 divide-y">
            {unit.history.map(({ date, title, detail, recordId }) => {
              const record = byId.get(recordId ?? "");
              return (
                <li key={`${date}-${title}`} className="py-2">
                  <time dateTime={date} className="block mt-0.5 text-xs text-muted-foreground">
                    {date}
                  </time>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{detail}</p>
                  {record && (
                    <ConnectionLink connection={connectionToRecord("engineering", record)} />
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </>
  );
}
