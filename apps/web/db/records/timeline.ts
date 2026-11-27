import { asc, inArray, or, sql } from "drizzle-orm";
import { combinedItemDetails, itemChipLabel, revisionCoverage, unitSelection, type ItemSelection } from "@/components/workspace/selection";
import { acceptanceState } from "@/components/verification/acceptance";
import { reviewActor, reviewEvidenceLinks, reviewRecord, reviewTest, methods } from "@/components/verification/model";
import { sectionLabels, tools, toolHref, withSelections } from "@/lib/workspace-routes";
import { assemblyActions, sameUnit, type UnitEdition } from "@/lib/records/journal";
import { bracketRecords } from "@/lib/records/journal";
import { recordKinds, latestRecordEdit } from "@/lib/records/journal";
import { connectionToRecord } from "@/components/records/schema";
import { eventFindingConnection, recordConnection, type RecordConnection } from "@/lib/records/links";
import { loadCatalog } from "../catalog";
import type { Reader } from "../connection";
import { assemblyRecords, type AssemblyRecord, type RecordEvent } from "../schema";
import { readDecisionHistory } from "../operations/tools";
import { readRecordHistory, readReviews } from "./history";
import { readEvidenceIndex } from "../verification/evidence";

type Event = Pick<RecordEvent, "at" | "actor" | "title" | "note"> & { links: readonly RecordConnection[] };
type Coverage = { groupId: string; title: string; serials: string[]; total: number };
type Entry = Event & { key: string; coverage: Coverage[]; label?: string };

export async function readTimeline(db: Reader, selections: readonly ItemSelection[]) {
  const catalog = await loadCatalog(db);
  const item = combinedItemDetails(catalog, selections);
  const entries = new Map<string, Entry>();
  if (!item) return { catalog, groups: undefined, events: [] as Entry[] };

  const [data, records, reviews, assembly, history] = await Promise.all([
    readEvidenceIndex(db), readRecordHistory(db), readReviews(db),
    db.select({
      section: assemblyRecords.section,
      id: assemblyRecords.id,
      record: sql<Omit<AssemblyRecord, "fields" | "overviewLinks">>`${assemblyRecords.data} - 'fields' - 'overviewLinks'`,
    }).from(assemblyRecords).where(or(
      sql`jsonb_array_length(${assemblyRecords.data}->'history') > 0`,
      inArray(assemblyRecords.id, Object.values(bracketRecords).map(target => target.id)),
    ))
      .orderBy(asc(assemblyRecords.position)),
    readDecisionHistory(db),
  ]);
  const selected = new Set(selections);
  const add = ({ units, unit, engineeringId, selections: scopes, reviewId, ...event }: Event & {
    units?: UnitEdition[]; unit?: UnitEdition; engineeringId?: string; selections?: ItemSelection[]; reviewId?: string;
  }) => {
    const coverage = item.revisions.flatMap(revision => {
      const matches = engineeringId ? revisionCoverage(revision, engineeringId).units
        : revision.units.filter(u => (units ?? [unit]).some(owner => sameUnit(owner, u)));
      if (!matches.length && (!engineeringId || item.unit || !revision.recordIds.includes(engineeringId))) return [];

      return [{ groupId: revision.id, title: revision.title, serials: matches.map(u => u.serial), total: revision.units.length }];
    });
    const label = scopes?.filter(scope => selected.has(scope)).map(scope => itemChipLabel(catalog, scope)).join(" · ");
    if (!coverage.length && !(engineeringId && item.recordIds.includes(engineeringId)) && !label) return;
    const key = reviewId ?? JSON.stringify([event.at, event.actor, event.title, event.note, event.links.map(link => link.href)]);
    entries.set(key, { ...event, key, coverage, label: label || undefined });
  };
  const baseline = data.article;
  for (const { section, id, record } of assembly) {
    const owner = section === "production" ? record.unit ?? baseline : undefined;
    const edit = record.kind === "issue" ? latestRecordEdit(records, id, owner) : undefined;
    const link = connectionToRecord(section, {
      ...record,
      id,
      title: edit?.title ?? record.title,
      unit: record.unit ?? owner,
    });

    for (const event of record.history ?? []) {
      add({ ...event, unit: owner, engineeringId: section === "engineering" ? id : undefined, links: [link] });
    }
  }

  for (const event of data.bracketEvents) {
    const target = event.record && bracketRecords[event.record];
    let link: RecordConnection | undefined;
    if (target) {
      const source = target.section === "verification" ? reviewRecord(data, target.id) : assembly.find(row =>
        row.section === target.section && row.id === target.id);
      link = source?.record ? connectionToRecord(target.section, {
        ...source.record,
        id: target.id,
        title: source.record.title,
        unit: baseline,
        test: "test" in source ? source.test : undefined,
      })
        : recordConnection(target.section, target.id, baseline, { label: "Unavailable record · " + target.id, view: "" });
    }
    add({ ...event, unit: baseline, links: link ? [link] : [] });
  }

  for (const check of data.acceptanceChecks) {
    const { submissions } = acceptanceState(check);
    const captureLink = (id: string) => [recordConnection("verification", id, check.unit, {
      label: "Evidence submission · " + check.unit.serial, view: "Acceptance Review", identity: id,
    })];
    for (const capture of submissions) add({
      unit: check.unit, at: capture.recordedAt, actor: "Technician", title: "Acceptance follow-up captured",
      note: capture.observation, links: captureLink(capture.id),
    });
    for (const { review: decision } of submissions) if (decision) add({
      unit: check.unit, at: decision.recordedAt, actor: decision.reviewer, title: `Acceptance · ${decision.decision}`,
      reviewId: decision.id, note: decision.reason, links: captureLink(decision.evidenceId),
    });
  }
  for (const record of records) {
    if (record.eventFinding && record.action) {
      const { parentId, unit } = record.action;
      add({ unit, at: record.recordedAt, actor: record.context, title: "Exchange finding recorded",
        note: record.description, links: [eventFindingConnection(record.id, parentId, unit, record.eventFinding.basis.correlation)] });
      continue;
    }
    const labels = recordKinds[record.kind];
    const owner = record.action?.unit ?? record.unit ?? baseline;
    const action = record.action;
    const target = action && action.type !== "flag" ? action.parentId : record.id;
    add({
      unit: owner, at: record.recordedAt, actor: sectionLabels["/" + labels.section],
      title: action ? assemblyActions[action.type].event : labels.event, note: record.description,
      links: [connectionToRecord(labels.section, { ...record, id: target, unit: owner })],
    });
  }

  for (const record of data.catalogEvidence) {
    const links = [connectionToRecord("verification", record)];
    if (record.recordedAt) add({
      unit: record.unit, at: record.recordedAt, actor: "Verification", title: "Evidence recorded", note: record.observation ?? record.title, links,
    });
    const review = record.review;
    if (review) add({
      unit: record.unit, reviewId: review.id, at: review.recordedAt, actor: "Verification reviewer", title: review.decision, note: review.reason, links,
    });
  }
  const archive = data.review;
  const archivedRecord = data.records["ground-firing"].find(({ capture }) => capture?.reviewId === archive.evidenceId);
  if (archivedRecord) add({
    unit: archivedRecord.unit, at: archive.recordedAt, actor: "Archived review", title: "Archived record reviewed", note: archive.reason,
    links: [connectionToRecord("verification", {
      ...archivedRecord, test: "ground-firing", unit: archivedRecord.unit ?? baseline,
    })],
  });

  const notes = records.filter(({ kind, action }) => kind === "evidence" && !action);
  for (const review of reviews) {
    const test = reviewTest(data, review);
    if (!test) continue;
    const actor = review.reviewer ?? { reviewer: "Verification reviewer", technician: "Technician", quality: "Quality lead" }[reviewActor(review.decision)];
    const method = methods[test].label;
    const title = !review.evidenceIds.length && method ? `${method} · ${review.decision}` : review.decision;
    const unit = review.scope?.selection.startsWith("unit:") && review.scope.revision
      ? { serial: review.scope.selection.slice(5), revisionId: review.scope.revision }
      : review.scope ? undefined : baseline;
    add({
      unit, selections: review.scope && !unit ? [review.scope.selection] : undefined,
      reviewId: review.id, at: review.recordedAt, actor, title, note: review.reason,
      links: reviewEvidenceLinks(data, review, notes).map(source => connectionToRecord("verification", {
        ...source, test, unit: source.unit ?? baseline,
      })),
    });
  }

  for (const { units, selections, at, actor, title, tool, caseId, caseUnit, id } of history) {
    const anchor = tool === "exchange" ? "receipt-" + id : tool === "containment" ? "review-" + id : id;
    const subjects = caseUnit ? [caseUnit] : units;
    const href = withSelections(toolHref(tool, caseId, anchor), subjects.map(unit => unitSelection(unit.serial, unit.revisionId)));
    add({ units, selections, at, actor, title, note: tools[tool].name,
      links: [{ href, label: "Recorded decision", location: tools[tool].name, identity: title }], reviewId: id });
  }
  const events = [...entries.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Use the events that survived ID deduplication, including revision records without a serial.
  const covered = Map.groupBy(events.flatMap(event => event.coverage), row => row.groupId);
  const groups = item.unit ? null : item.revisions.filter(group => group.units.length).map(group => {
    const present = new Set(covered.get(group.id)?.flatMap(row => row.serials));

    return { id: group.id, title: group.title, covered: present.size, total: group.units.length,
      missing: group.units.filter(unit => !present.has(unit.serial)).map(unit => unit.serial) };
  });

  return { catalog, groups, events };
}

export type Timeline = Awaited<ReturnType<typeof readTimeline>>;
