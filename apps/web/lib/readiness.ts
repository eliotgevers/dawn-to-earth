import { sameUnit, type RecordUnit, type UnitEdition, isRemovedRecord } from "./records/journal";
import { filedReference, recordConnection, recordField, recordLabel, type RecordConnection } from "./records/links";
import { acceptanceReviewConnection, acceptanceState } from "@/components/verification/acceptance";
import { isCatalogArchived } from "@/components/catalog/store";
import { recordUnit, unitSelection } from "@/components/workspace/selection";
import { unitProblem } from "@/db/workflows/cases";
import type { readReadinessBasis } from "@/db/verification/release";
import { toolHref, assignmentHref } from "./workspace-routes";
import type { PacketContents } from "@/db/schema";

type ProductionFacts = Awaited<ReturnType<typeof readReadinessBasis>>["records"];

// A packet covers these build titles, agreed editions and immutable QA decisions, regardless of display order.
export function packetBasis(packet: PacketContents) {
  return JSON.stringify([
    packet.serial,
    packet.revisionId,
    packet.builds.map(({ id, title }) => [id, title]).sort(([a], [b]) => a.localeCompare(b)),
    (packet.scopes ?? []).map(({ caseId, versionId }) => [caseId, versionId]).sort(([a], [b]) => a.localeCompare(b)),
    packet.inspections.map(({ decisionId }) => decisionId).sort(),
  ]);
}

export function unavailableUnitLink(catalog: Pick<ProductionFacts["catalog"], "units" | "archivedRows">, unit: RecordUnit) {
  if (!unitProblem(catalog, unit)) return;

  const query = new URLSearchParams({ view: "units" });
  if (isCatalogArchived(catalog, "unit", unit.serial)) query.set("units.archived", "1");

  return "/catalog?" + query + "#catalog-units-" + encodeURIComponent(unit.serial);
}

export function unitReadiness(
  { records, local, agreements, toolTasks, holds }: Awaited<ReturnType<typeof readReadinessBasis>>,
  unit: RecordUnit,
) {
  const { catalog, verification, production } = records;
  const exact = production.filter(row => sameUnit(row.unit, unit));
  const current = exact.filter(row => !isRemovedRecord(row.id, local, unit));
  const builds = current.filter(row => row.kind === "build");
  const checks = verification.acceptanceChecks.filter((check) => sameUnit(check.unit, unit));
  const issues = current.filter(row => row.kind === "issue" && row.status !== "Resolved");
  const blockers: { reason: string; owner?: string; nextOwner?: string; connection: RecordConnection }[] = [];

  const query = new URLSearchParams({ item: unitSelection(unit.serial, unit.revisionId) });
  const unavailable = unavailableUnitLink(catalog, unit);
  if (unavailable) blockers.push({
    reason: "Unit is archived or its current revision has changed",
    connection: { href: unavailable, label: "Unit " + unit.serial, location: "Catalog · Units", identity: unit.serial },
  });
  if (!builds.length) blockers.push({
    reason: "Build record missing",
    connection: { href: "/production?" + query + "&view=build&filter=all", label: "Builds for " + unit.serial, location: "Production · Builds" },
  });
  if (!checks.length) blockers.push({
    reason: "No acceptance check recorded",
    connection: { href: "/verification?" + query, label: "Verification for " + unit.serial, location: "Verification · Overview" },
  });

  const queue = exact.filter(row => row.kind === "queue" && recordField(row, "Decision owner"));
  for (const issue of issues) {
    const next = queue.find(row => issue.overviewLinks?.some(link => link.id === row.id));
    blockers.push({
      reason: issue.title,
      owner:
        recordField(issue, "Decision owner") ??
        checks.find(({ issueId }) => issueId === issue.id)?.owner,
      nextOwner: next && recordField(next, "Decision owner"),
      connection: recordConnection("production", issue.id, unit, { label: recordLabel("issue", issue.reference, issue.title), view: "Issues", identity: issue.title }),
    });
  }
  for (const hold of holds) {
    if (sameUnit(hold.unit, unit)) blockers.push({
      reason: hold.reason, owner: hold.owner,
      connection: { href: toolHref("traveler", hold.caseId) + "#traveler-action", label: "Traveler hold", location: "Production · Builds" },
    });
  }

  const scopes = agreements.filter(agreement => sameUnit(agreement.unit, unit)).map(agreement => agreement.scope);
  for (const task of toolTasks) {
    if (task.tool === "agreements" && !task.completedAt && sameUnit(task.unit,unit) && scopes.some(scope => scope.caseId === task.caseId)) {
      blockers.push({
        reason: task.title, owner: task.owner,
        connection: { href: assignmentHref(task), label: "Scope assignment", location: "Engineering · Agreements" },
      });
    }
  }

  const contents: PacketContents = {
    ...(scopes.length ? {scopes} : {}),
    ...unit,
    builds: builds.map(({ id, title, reference }) => ({ id, title, reference: filedReference(reference) })).sort((a, b) => a.id.localeCompare(b.id)),
    inspections: [],
  };
  const workById = Map.groupBy(exact, row => row.id);
  for (const check of checks) {
    const work = workById.get(check.buildId)?.[0];
    const queued = work?.kind === "queue";
    const archived = isRemovedRecord(check.buildId, local, unit);
    const buildRecorded = builds.some(row => row.id === check.buildId || row.buildId === check.buildId);
    if (archived || (builds.length && !buildRecorded)) {
      const reason = archived
        ? (queued ? "Required queued work is archived." : "Required build is archived.")
        : (queued ? "No build for this unit and revision is linked to the queued work." : "No build for this unit and revision is linked to the acceptance check.");
      blockers.push({
        reason, owner: check.owner,
        connection: recordConnection("production", check.buildId, unit, {
          label: recordLabel(queued ? "queue" : "build", work?.reference, work?.title ?? check.buildId),
          view: "Builds", identity: work?.title ?? check.buildId,
        }),
      });
    }

    const state = acceptanceState(check);
    if (!state.accepted || !state.current || !state.review) {
      blockers.push({
        reason: state.artifact.title + " · " + state.stage,
        owner: check.owner,
        connection: acceptanceReviewConnection(check),
      });
      continue;
    }
    contents.inspections.push({
      checkId: check.id,
      requirementId: check.requirementId,
      evidenceId: state.current.id,
      source: state.current.source,
      capturedAt: state.current.recordedAt,
      decisionId: state.review.id,
      reviewer: state.review.reviewer ?? "Quality assurance",
      decidedAt: state.review.recordedAt,
    });
  }

  return { contents, issues, blockers, checks };
}

// Recorded configurations, an authored change and its acceptance checks identify affected serials.
export function changeImpact(catalog: ProductionFacts["catalog"], changeId: string,
  owners: readonly UnitEdition[]) {
  const assignments = catalog.units.flatMap(({ serial, configurations }) =>
    configurations.filter(c => c.recordIds.includes(changeId)).map(({ revisionId }) => ({ serial, revisionId })),
  );
  const subjects = Map.groupBy([...assignments, ...owners], unit => unit.revisionId);
  const baselines = catalog.revisions.filter(r => r.recordIds.includes(changeId) || subjects.has(r.id));

  return {
    baselines,
    unitsFor(fromId: string, toId: string) {
      const from = baselines.find(r => r.id === fromId);
      const to = catalog.revisions.find(r => r.id === toId);
      if (!from || !to || from.systemId !== to.systemId || from.id === to.id) return [];
      const shared = from.recordIds.includes(changeId);

      return catalog.units.flatMap(unit => {
        if (isCatalogArchived(catalog, "unit", unit.serial)) return [];
        if (unit.revisionId === toId) return [recordUnit(unit, to)];
        if (unit.revisionId === fromId && (shared || subjects.get(fromId)?.some(row => row.serial === unit.serial)))
          return [recordUnit(unit, from)];

        return [];
      });
    },
  };
}
