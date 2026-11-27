import { acceptanceHref, acceptanceReviewConnection, acceptanceState, acceptanceTask, findAcceptance, type AcceptanceCheck } from "@/components/verification/acceptance";
import type { AssemblyOverviewRow } from "@/components/records/layout";
import { assemblyActions, assemblyStatusTone, sameUnit, type RecordUnit, recordDecision, isRemovedRecord, recordActivity, recordedBuildProgress, type RecordEntry, visibleRecordNotes, workflowHistory } from "@/lib/records/journal";
import { compareWork, findingConnection, linkedWork, recordConnection, recordField, recordHref, recordUnitLabel, substantiveValue, type RecordConnection } from "@/lib/records/links";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import { connectionToRecord, primaryValues, recordValues } from "@/components/records/schema";
import type { AssemblyRecord, WorkspaceRecords, AssemblyWorkspace, readProduction } from "@/db/records/assembly";
import { formatUtcDateTime } from "@/lib/utc-time";
import { toolHref } from "@/lib/workspace-routes";
import type { PlanningExecution as Execution } from "@/lib/planning";

// Documents and movements belong to one build on one recorded edition. A serial alone is insufficient.
export function executionForBuild(id: string, unit: RecordUnit | undefined, data?: Execution) {
  const matches = (row: { buildId: string; unit: RecordUnit }) => row.buildId === id && sameUnit(row.unit, unit);
  return {
    travelers: data?.travelers.filter(matches) ?? [],
    materials: data?.materials.filter(matches) ?? [],
    holds: data?.holds.filter(matches) ?? [],
    studies: data?.studies?.filter(matches) ?? [],
  };
}

type ProductionWorkRow = AssemblyOverviewRow & { record: AssemblyRecord; build?: ProductionBuild };

export function productionRegister(workspace: BuildWorkspace, item: SelectedItem | undefined, view: string, target?: AssemblyRecord) {
  const { records: seed, local, actors, execution } = workspace;
  if (view !== "overview" && view !== "build" && view !== "issue") return;
  const builds = view === "issue" ? [] : productionBuilds(seed, local, execution);
  // A link to a dated history entry opens its owner, even outside the current selection.
  const linkedBuild = target && builds.find(build => build.record.id === target.id || build.history.some(entry => entry.id === target.id));

  function describe(record: AssemblyRecord, build?: ProductionBuild): ProductionWorkRow | undefined {
    const owner = record.unit ?? seed.verification.article;
    if (!includesUnit(item, owner)) return;
    const activity = recordActivity(local, record.id, owner);
    const fields = new Map(record.fields);
    const base = {
      record, build, id: record.id, title: record.title, status: record.status, tone: record.tone,
      href: `#${record.id}`, scope: recordUnitLabel(owner),
      activity: activity[0]?.recordedAt ?? record.history?.at(-1)?.at ?? record.recordedAt,
    };
    if (!build) {
      if (isRemovedRecord(record.id, local, owner)) return;
      if (record.status === "Resolved") {
        return { ...base, kind: "Issue", next: "No open action", priority: 7,
          decision: activity.find(({action}) => action?.type === "dispose")?.description ?? fields.get("Disposition") };
      }
      const check = findAcceptance(seed.verification.acceptanceChecks, record.id, owner, "issueId");
      const state = check && acceptanceState(check);
      return { ...base, kind: "Issue", priority: record.status === "On hold" ? 0 : 4, owner: check?.owner ?? fields.get("Decision owner"),
        next: state ? state.accepted ? "Record the issue disposition." : state.nextAction : fields.get("Next decision") ?? fields.get("Next action"),
        blocker: fields.get("Finding") };
    }
    const { history, filter, work } = build;
    if (filter === "archived") {
      return view === "build" ? { ...base, status: "Archived", priority: 8 } : undefined;
    }
    const { status, acceptance, travelerHold } = work;
    if (travelerHold) {
      return { ...base, status, tone: "amber", kind: "Traveler discrepancy", priority: 0,
        activity: undefined, owner: actors.find(actor => actor.id === travelerHold.owner)?.name ?? travelerHold.owner,
        next: "Resolve the traveler discrepancy.", blocker: travelerHold.reason };
    }
    if (acceptance && !acceptance.accepted) {
      return { ...base, status, tone: "amber", kind: "Acceptance", priority: 0,
        owner: acceptance.check.owner, next: acceptance.nextAction, blocker: acceptance.blocker,
        activity: acceptance.review?.recordedAt ?? acceptance.current?.recordedAt };
    }

    if (record.kind === "build") {
      const pending = fields.get("Evidence pending");
      return { ...base, kind: "Build record", status: pending ? "Evidence pending" : status,
        tone: pending ? "amber" : base.tone, next: pending ?? fields.get("Record closeout"), priority: pending ? 2 : 6 };
    }

    const recipient = fields.get("Handoff recipient");
    const row: ProductionWorkRow = { ...base, status,
      tone: status === record.status ? record.tone : assemblyStatusTone(status),
      kind: recipient ? "Handoff" : undefined, owner: fields.get("Decision owner") ?? recipient,
      next: substantiveValue(fields.get("Next action"), record.title),
      priority: recipient ? 2 : 1 };
    if (status === "Complete") {
      Object.assign(row, { kind: "Build", owner: undefined, next: "No open action", tone: "green", priority: 6 });
    } else if (status === "Ready to resume" || status === "In progress") {
      row.tone = "blue";
      row.priority = status === "Ready to resume" ? 1 : 3;
      if (status === "In progress" && work.closeoutLink) row.next = work.closeoutLink.label;
    } else {
      row.blocker = work.open?.description ?? fields.get("Hold reason") ?? fields.get("Blocked by");
      if (status === "On hold") row.priority = 0;
    }
    for (const entry of history) {
      const pending = recordField(entry, "Evidence pending");
      if (!pending || row.priority === 0) continue;
      if (row.priority === 6) {
        row.href = `#${entry.id}`;
        row.status = "Evidence pending";
      }
      row.kind = "Evidence handoff";
      row.next ??= pending;
      row.priority = 2;
      break;
    }
    return row;
  }
  const rows = builds.flatMap(build => describe(build.record, build) ?? []);
  if (view !== "build") {
    for (const record of seed.production) {
      if (record.kind !== "issue") continue;
      const issue = describe(record);
      if (issue) rows.push(issue);
    }
  }
  rows.sort((a, b) => {
    // Archived builds follow open and completed work in their original register order.
    if (a.build?.filter === "archived" && b.build?.filter === "archived") return 0;
    return compareWork(a, b);
  });
  return { rows, linkedBuild };
}

export type BuildFilter = "active" | "completed" | "archived";
export type ProductionBuild = {
  record: AssemblyRecord;
  history: AssemblyRecord[];
  filter: BuildFilter;
  work: ReturnType<typeof buildWorkState>;
};

export const unresolvedIssueMessage = "This issue is linked to build work or an acceptance check. Record its disposition before removing it from active work.";

export function linkedBuildIssueIds(links: AssemblyRecord["overviewLinks"], checks: readonly AcceptanceCheck[]) {
  const ids = new Set<string>();
  for (const check of checks) if (check.issueId) ids.add(check.issueId);
  for (const link of links ?? []) if (link.section === "production") ids.add(link.id);
  return ids;
}

export function buildWorkState(
  record: Pick<AssemblyRecord, "id" | "status" | "overviewLinks">,
  unit: RecordUnit | undefined,
  checks: readonly AcceptanceCheck[] | undefined,
  local: readonly RecordEntry[],
  holds: Execution["holds"] = [],
  travelers: Execution["travelers"] = [],
  issues: readonly (Pick<AssemblyRecord, "id" | "status" | "unit"> & Partial<Pick<AssemblyRecord, "title" | "fields">>)[] = [],
) {
  const travelerHold = holds.find(hold => hold.buildId === record.id && sameUnit(hold.unit, unit));
  const buildChecks = (checks ?? []).filter(check => check.buildId === record.id && sameUnit(check.unit, unit));
  const relevant = buildChecks.map(check => ({ check, ...acceptanceState(check) }));
  const acceptance = relevant.find(state => !state.accepted) ?? relevant[0];
  const issueIds = linkedBuildIssueIds(record.overviewLinks, buildChecks);
  const issue = issues.find(issue => issueIds.has(issue.id) && (!issue.unit || sameUnit(issue.unit, unit)) &&
    issue.status !== "Resolved");
  const traveler = travelers.find(t => t.buildId === record.id && sameUnit(t.unit, unit) &&
    (!t.handoffEvidenceId || !relevant.some(a => a.check.id === t.checkId && a.current?.id === t.handoffEvidenceId)));
  const closeoutLink: RecordConnection | undefined = issue && unit
    ? recordConnection("production", issue.id, unit, { label: "Resolve linked issue before closeout", view: "Issues", identity: issue.title })
    : traveler ? {href: toolHref("traveler", traveler.caseId), label: "Complete the traveler handoff", location: "Production · Traveler"} : undefined;
  const activity = recordActivity(local, record.id, unit);
  const flags = activity.filter(entry => entry.action?.type === "flag");
  const flag = flags.find(entry => recordDecision(local, entry.id, unit)?.status !== "Resolved");
  // A flag keeps the original observation in history; the blocker shows the issue as currently edited.
  const blocker = flag && issues.find(row => row.id === flag.id && sameUnit(row.unit, unit));
  const open = flag && { id: flag.id, title: blocker?.title ?? flag.title,
    description: blocker?.fields?.find(([label]) => label === "Finding")?.[1] ?? flag.description };
  const progress = recordedBuildProgress(record.status, activity);
  const { startedAt } = progress;
  const issueInterrupted = flags.length > 0 && (!startedAt || startedAt <= flags[0].recordedAt);
  const evidenceReplaced = startedAt && relevant.some(({ current }) => current && current.recordedAt > startedAt);

  let status = progress.status;
  if (travelerHold || open || (acceptance && !acceptance.accepted)) status = "On hold";
  else if (issueInterrupted || evidenceReplaced) status = "Ready to resume";
  else if (acceptance?.accepted && (status === "Blocked" || status === "On hold")) {
    status = issue ? "On hold" : "Ready";
  }
  return { status, open, acceptance, travelerHold, closeoutLink };
}

type ImpactTarget = { changeId: string; serial: string; revisionId: string };

export function productionFollowUp({ changeId, serial, revisionId }: ImpactTarget, workspace: AssemblyWorkspace): RecordConnection[] {
  const { records, local } = workspace;
  const holds = "execution" in workspace ? workspace.execution.holds : workspace.holds;
  const checks = records.verification.acceptanceChecks.filter(check =>
    check.changeId === changeId && check.unit.serial === serial && check.unit.revisionId === revisionId);
  const issues = records.production.filter(row => row.kind === "issue");
  const links: RecordConnection[] = [];
  for (const check of checks) {
    if (isRemovedRecord(check.buildId, local, check.unit)) continue;
    const hold = holds.find(h =>
      h.buildId === check.buildId && sameUnit(h.unit, check.unit));
    const review = acceptanceTask(check, acceptanceState(check));
    if (hold) links.push({href: toolHref("traveler", hold.caseId), label: "Resolve traveler discrepancy", location: "Production · Traveler"});
    else if (review) links.push(review);
    else {
      const issue = issues.find(record => record.id === check.issueId && sameUnit(record.unit, check.unit));
      if (issue && issue.status !== "Resolved" && !isRemovedRecord(issue.id, local, check.unit))
        links.push(connectionToRecord("production", issue));
      else links.push(recordConnection("production", check.buildId, check.unit, { label: "Reviewed build", view: "Builds" }));
    }
  }
  if (links.length || checks.length) return links;

  // A change may link directly to production without an acceptance case. Show only recorded open work.
  const change = records.engineering.find(row => row.id === changeId);
  if (!change) return [];
  const assigned = {serial, revisionId};
  const affected = new Set(change.impacts?.filter(impact => impact.section === "production" && sameUnit(impact.target?.unit, assigned))
    .map(impact => impact.id));
  const destinations = new Set(change.links.map(link => link.href));
  for (const row of records.production) {
    const unit = row.unit ?? records.verification.article;
    if (!sameUnit(unit, assigned) || isRemovedRecord(row.id, local, unit)) continue;
    const related = affected.has(row.id) || destinations.has(recordHref("production", row.id, row.unit));
    if (!related) continue;
    if (row.kind === "issue" && row.status !== "Resolved") links.push(connectionToRecord("production", { ...row, unit }));
    if (row.kind === "queue") {
      const work = buildWorkState(row, unit, records.verification.acceptanceChecks, local, holds, [], issues);
      if (work.status !== "Complete") links.push(connectionToRecord("production", { ...row, unit }));
    }
    if (row.kind === "build" && recordField(row, "Evidence pending"))
      links.push(connectionToRecord("production", { ...row, unit }));
  }
  return links;
}

export function productionBuilds(seed: WorkspaceRecords, local: readonly RecordEntry[], execution?: Execution): ProductionBuild[] {
  const groups = Map.groupBy(seed.production, record => record.kind);
  const builds = new Map<string, Pick<ProductionBuild, "record" | "history">>();
  for (const record of groups.get("queue") ?? []) builds.set(record.id, { record, history: [] });
  for (const record of groups.get("build") ?? []) {
    const parent = record.buildId ? builds.get(record.buildId) : undefined;
    if (parent) parent.history.push(record);
    else builds.set(record.id, { record, history: [] });
  }
  return Array.from(builds.values(), build => {
    const owner = build.record.unit ?? seed.verification.article;
    const work = buildWorkState(build.record, owner, seed.verification.acceptanceChecks, local,
      execution?.holds, execution?.travelers, groups.get("issue"));
    const filter = isRemovedRecord(build.record.id, local, owner) ? "archived"
      : work.status === "On hold" || work.status === "Blocked" ? "active"
      : build.record.kind === "build" || work.status === "Complete" ? "completed" : "active";
    return { ...build, work, filter };
  });
}

type WorkEvent = {
  key: string;
  title: string;
  at?: string;
  actor?: string;
  note?: string;
  followUp?: string;
  anchor?: AssemblyRecord;
  facts?: readonly DetailFact[];
  notes?: readonly RecordEntry[];
};

function buildHistory({ record, history }: ProductionBuild,
  activityFor: (id: string) => readonly RecordEntry[]) {
  const entries = [record, ...history];
  const internalLinks = new Set(entries.map(({ id, unit }) => recordHref("production", id, unit)));
  const links = new Map<string, RecordConnection>();
  const events: WorkEvent[] = [];

  for (const entry of entries) {
    const activity = activityFor(entry.id);
    const isCapture = record.kind === "build" || entry !== record;
    const recordedEvents = entry.history ?? [];
    const workPerformed = recordField(entry, "Work performed");
    const captureEvent = isCapture ? recordedEvents.find(({ title, note }) =>
      title === entry.title || (workPerformed && note === workPerformed)) : undefined;
    for (const link of entry.links) {
      if (!internalLinks.has(link.href)) links.set(link.href, link);
    }
    if (isCapture || entry.recordedAt) {
      events.push({
        key: entry.id, title: captureEvent?.title ?? (entry === record && isCapture ? "Build recorded" : entry.title),
        anchor: entry !== record ? entry : undefined,
        facts: isCapture ? buildCaptureFacts(entry, entry === record) : undefined,
        notes: entry !== record ? visibleRecordNotes(activity) : undefined,
        at: entry.recordedAt ?? captureEvent?.at,
        actor: captureEvent?.actor,
        note: captureEvent?.note !== workPerformed ? captureEvent?.note : undefined,
      });
    }
    for (const [index, event] of recordedEvents.entries()) {
      if (event !== captureEvent) events.push({ ...event, key: `${entry.id}-event-${index}` });
    }
    const firstWorkEvent = activity.findLast(entry => entry.action?.type === "start" || entry.action?.type === "flag");
    for (const saved of workflowHistory(activity)) {
      const type = saved.action.type;
      if (type === "flag") {
        const issue = recordConnection("production", saved.id, saved.action.unit, { view: "Issues", label: "Reported discrepancy", identity: saved.title });
        links.set(issue.href, issue);
      }
      const title = type === "start" && firstWorkEvent && firstWorkEvent.recordedAt < saved.recordedAt
        ? "Work resumed" : type === "remove" ? "Build archived" : assemblyActions[type].event;
      events.push({ key: saved.id, at: saved.recordedAt, title,
        note: saved.description, followUp: type === "rework" ? saved.context : undefined });
    }
  }
  events.sort((left, right) => {
    const leftTime = left.at ? Date.parse(left.at) : Number.MAX_VALUE;
    const rightTime = right.at ? Date.parse(right.at) : Number.MAX_VALUE;
    return leftTime - rightTime;
  });

  return { events, links: [...links.values()] };
}

type DetailFact = readonly [label: string, value: string | undefined];

function buildSummary({ build: {record, work}, status, execution }: BuildDetails) {
  const fields = new Map(record.fields);
  const queued = record.kind === "queue";
  const saved = recordValues(record);
  const next = queued ? saved.description : fields.get("Evidence pending");
  const blocker = status === "On hold" ? work.open?.description ?? fields.get("Hold reason") ?? fields.get("Blocked by") : undefined;
  const primary: DetailFact[] = [];
  const metadata: DetailFact[] = [];
  if (fields.has("Work instruction")) primary.push(["Work instruction", fields.get("Work instruction")]);
  if (work.acceptance) {
    const {check, accepted, blocker, nextAction} = work.acceptance;
    primary.push(["Acceptance", accepted ? "Artifact accepted" : "Acceptance hold"]);
    if (blocker) primary.push(["Acceptance blocker", blocker]);
    primary.push(["Acceptance owner", check.owner], ["Acceptance next action", nextAction]);
  }
  if (status !== "Complete" && (queued || next)) primary.push(["Next action", substantiveValue(next, record.title)]);
  if (queued) {
    primary.push(["Expected output", saved.context]);
    metadata.push(["Assembly", saved.assembly]);
  }
  if (blocker || status === "On hold" && !work.acceptance && !execution.holds.length) primary.push(["Blocker", blocker]);
  for (const label of ["Decision owner", "Handoff recipient"]) {
    if (fields.has(label)) metadata.push([label, fields.get(label)]);
  }
  return { primary, metadata };
}

function buildCaptureFacts(capture: AssemblyRecord, root: boolean) {
  const fields = new Map(capture.fields);
  const values = recordValues(capture);
  const facts: DetailFact[] = [...primaryValues("build", values)];
  for (const label of ["Authorized change", "Record closeout", "Evidence pending"]) {
    if (fields.has(label) && !(root && label === "Evidence pending")) facts.push([label, fields.get(label)]);
  }
  return facts;
}

type BuildWorkspace = Awaited<ReturnType<typeof readProduction>>;

export type IssueDetails = {
  record: AssemblyRecord;
  seed: WorkspaceRecords;
  owner?: RecordUnit;
  activity: readonly RecordEntry[];
};

export type BuildDetails = {
  build: ProductionBuild;
  local: readonly RecordEntry[];
  owner?: RecordUnit;
  editable?: RecordUnit;
  status: string;
  execution: ReturnType<typeof executionForBuild>;
};

export function issueFacts({ record, seed, owner, activity }: IssueDetails, findings: BuildWorkspace["findings"]) {
  const fields = new Map(record.fields);
  const links = [...record.links];
  const check = findAcceptance(seed.verification.acceptanceChecks, record.id, owner, "issueId");
  const acceptance = check && acceptanceState(check);
  if (check) links.push(acceptanceReviewConnection(check));
  if (check?.comparison && acceptance) for (const capture of acceptance.submissions) {
    if (capture.interval) links.push({href: acceptanceHref(check, capture.id), location: "Verification · Acceptance review",
      label: `${capture.id === acceptance.current?.id ? "Current" : "Earlier"} finding · frames ${capture.interval.start}–${capture.interval.end}`,
      identity: capture.observation,
    });
  }
  if (record.flaggedBuildId) {
    links.push(recordConnection("production", record.flaggedBuildId, owner, { label: "Flagged build", view: "Builds" }));
  }
  for (const finding of findings) if (finding.issueId === record.id && sameUnit(finding, owner)) {
    links.push(findingConnection(finding));
  }
  const activityAt = activity[0]?.recordedAt ?? record.recordedAt ?? record.history?.at(-1)?.at;
  const decision = activity.find(({ action }) => action?.type === "dispose");
  const title = record.title;
  const primary = recordValues(record);
  primary.description = substantiveValue(primary.description, title);
  return { next: check && acceptance && acceptanceTask(check, acceptance), primary: primaryValues("issue", primary), links, metadata: [
    ["Unit revision", recordUnitLabel(owner)],
    ["Next decision", acceptance
      ? acceptance.accepted ? (decision?.action?.outcome === "Resolved" ? "Disposition recorded." : "Record the issue disposition.") : acceptance.nextAction
      : fields.get("Next decision")],
    ...(acceptance ? [["Acceptance", acceptance.accepted ? "Artifact accepted" : "Acceptance hold"] as const] : []),
    ["Decision owner", fields.get("Decision owner") ?? check?.owner],
    ["Disposition", decision?.description ?? fields.get("Disposition") ?? fields.get("Resolution")],
    ["Last activity", activityAt && formatUtcDateTime(activityAt)],
  ] as const };
}

export function buildMaterialLink(movement: Execution["materials"][number]): RecordConnection {
  return {
    href: toolHref("inventory", movement.caseId) + "&" + new URLSearchParams({ build: movement.buildId, serial: movement.unit.serial, revision: movement.unit.revisionId }),
    label: `Material lot · ${movement.lotId}`, location: "Production · Materials", identity: movement.partId,
    detail: `Reserved ${movement.reserved} · Issued ${movement.issued} · Installed ${movement.installed}`,
  };
}

export function buildDetails(props: BuildDetails, { actors, workItems }: Pick<BuildWorkspace, "actors" | "workItems">) {
  const { build, owner, local, execution, status } = props;
  const { record, work } = build;
  const { acceptance, open } = work;
  const { events, links } = buildHistory(build, id => recordActivity(local, id, owner));
  const { primary, metadata } = buildSummary(props);
  if (acceptance) links.unshift(acceptanceReviewConnection(acceptance.check));

  const travelers: RecordConnection[] = execution.travelers.map(t => ({
    href: toolHref("traveler", t.caseId), label: `Released traveler · ${t.edition}`, location: "Production · Traveler",
  }));
  const hold = execution.holds[0];
  let next: RecordConnection | undefined;
  if (hold) {
    primary.unshift(["Traveler discrepancy", hold.reason], ["Assigned to", actors.find(a => a.id === hold.owner)?.name ?? hold.owner]);
    next = {href: toolHref("traveler", hold.caseId), label: "Resolve traveler discrepancy", location: "Production · Traveler"};
  } else if (open && owner) {
    next = recordConnection("production", open.id, owner, { view: "Issues", label: "Resolve build issue", identity: open.title });
  } else {
    if (status === "In progress" || status === "On hold" && acceptance?.accepted) next = work.closeoutLink;
    next ??= acceptance && acceptanceTask(acceptance.check, acceptance);
    if (!next && travelers.length === 1 && ["Ready", "Queued", "In progress", "Ready to resume"].includes(status)) next = travelers[0];
    next ??= linkedWork(links, workItems);
  }
  links.push(...travelers, ...execution.materials.map(buildMaterialLink));
  if (status === "Complete") for (const study of execution.studies) links.push({
    href: toolHref("improvement", study.caseId) + "&" + new URLSearchParams({ order: study.buildId }) + "#ledger-" + encodeURIComponent(study.buildId),
    label: "Completed order study", location: "Production · Improvement", identity: study.title,
  });
  return { events, primary, metadata, links, next: status === "Archived" ? undefined : next,
    article: record.kind === "build" || build.history.length ? "integration-records" : undefined } as const;
}
