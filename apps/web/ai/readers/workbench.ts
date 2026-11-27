import { combinedItemDetails, includesUnit, type ItemSelection } from "@/components/workspace/selection";
import { db } from "@/db/connection";
import { readToolContext } from "@/db/operations/tools";
import { agreementData, agreementHistory, changedClauses } from "@/db/workflows/agreements";
import { auditSearchText, isAuditCase } from "@/db/workflows/audit";
import { campaignEditions, campaignSteps } from "@/db/workflows/campaign";
import { lotReview } from "@/db/workflows/containment";
import { caseMatches, type ToolContext, type WorkCase } from "@/db/workflows/cases";
import { receiptsFor, requestFor } from "@/db/workflows/exchange";
import { studyInterventions, type Study } from "@/db/workflows/improvement";
import { availableStock, isRegister, stockRegister } from "@/db/workflows/inventory";
import { comparison, reviewState } from "@/db/workflows/qualification";
import { isRecallCase } from "@/db/workflows/recall";
import { isComparison, stage } from "@/db/workflows/reconciliation";
import { isRecoveryCase, recoveryReview } from "@/db/workflows/recovery";
import { isTraveler, travelerProgress } from "@/db/workflows/traveler";
import { tools, toolHref, withSelections, type ToolId } from "@/lib/workspace-routes";
import type { AskSource, AskContext } from "../sources";

const sectionNames = { engineering: "Engineering", production: "Production", verification: "Verification", operations: "Operations" } as const;

// Cite the filed document and its current disposition. Decision controls stay on its case page.
function caseFacts(row: WorkCase, state: ToolContext) {
  switch (row.tool) {
    case "agreements": {
      const agreement = agreementData(row);
      const { baseline } = agreementHistory(row);
      const differences = changedClauses(agreement, baseline);
      const changedText = differences.map(clause =>
        `${clause.title}: ${baseline.clauses[clause.id] ?? "Absent"} → ${clause.after ?? "Removed"}`);
      return [agreement.reference, `Filed baseline: ${baseline.edition} (${baseline.receipt})`,
        `Requested: ${agreement.documents[1].edition} (${agreement.documents[1].receipt})`,
        `${differences.length} changed clause${differences.length === 1 ? "" : "s"}`, ...changedText];
    }
    case "campaign": {
      const { campaign, current, step } = campaignEditions(row);
      return [campaign.partner, `Revision ${current.submission.number}`, current.submission.question, campaignSteps[step]];
    }
    case "inventory": {
      if (!isRegister(row)) return;
      const { bins } = stockRegister(row);
      const available = [...bins.values()].reduce((sum, bin) => sum + availableStock(bin), 0);
      return [row.data.lotId, row.data.partId, `${available} available`, row.data.receipt.reference];
    }
    case "containment": {
      const { trace, status } = lotReview(row, state.relatedEvents);
      return [trace.lotId, trace.notice, status, trace.reason];
    }
    case "recovery":
      if (isRecoveryCase(row)) return [row.data.receipt, recoveryReview(row, state.workspace).status, row.data.finding];
      break;
    case "reconciliation":
      if (isComparison(row)) return [stage(row.history.at(-1)), row.data.targetId, row.data.observation];
      break;
    case "qualification": {
      const basis = comparison(row);
      return [basis.requirement, basis.report, reviewState(row).status, basis.revision];
    }
    case "audit":
      if (isAuditCase(row)) return [row.data.review.decision, row.data.review.at, row.data.review.reason, row.data.evidence.source];
      break;
    case "exchange": {
      const receipts = receiptsFor(row);
      return [requestFor(row).sender, receipts.length ? `${receipts.length} filed receipt${receipts.length === 1 ? "" : "s"}` : "Awaiting receipt"];
    }
    case "recall":
      if (isRecallCase(row)) return [row.data.instrument, row.data.corrected, row.data.since, row.data.through, row.data.correction];
      break;
    case "traveler":
      if (isTraveler(row)) return [row.data.edition, row.data.buildId, `${travelerProgress(row).completed.size} of ${row.data.steps.length} entries recorded`];
      break;
    case "improvement": {
      const study = row as Study;
      return [study.data.reference, studyInterventions(study).status, study.data.change];
    }
  }
}

export async function workbenchSources(tool: ToolId, scope: readonly ItemSelection[], context?: AskContext): Promise<AskSource[]> {
  if (tool === "audit" && !scope.length) return [];
  if (!db) throw new Error("Workspace unavailable");
  const page = context?.path === toolHref(tool) ? context : undefined;
  const kind = sectionNames[tools[tool].section];
  const caseId = page?.case;
  if (!caseId && tool !== "audit" && (page?.q || page?.status && page.status !== "All")) {
    const query = new URLSearchParams();
    if (page.q) query.set("q", page.q);
    if (page.status) query.set("status", page.status);

    return [{ handoff: true, kind, title: "Open filtered " + tools[tool].name,
      excerpt: "The case list applies its search and status filters in the browser. Open this view to inspect the matching rows.",
      href: withSelections(toolHref(tool) + "?" + query, scope) }];
  }

  const state = await readToolContext(db, tool, caseId);
  const selected = combinedItemDetails(state.workspace.catalog, scope);

  if (scope.length && !selected) return [];
  const auditTerms = !caseId && tool === "audit" ? page?.q?.trim().toLocaleLowerCase().split(/\s+/) ?? [] : [];
  const matchesAudit = (row: Parameters<typeof auditSearchText>[0]) =>
    auditTerms.every(term => auditSearchText(row).toLocaleLowerCase().includes(term));
  const cases = caseId ? (state.dossier ? [state.dossier] : []) : state.cases;
  const sources = cases.flatMap((row): AskSource[] => {
    if (selected && !caseMatches(row, selected)) return [];
    if (tool === "audit" && (!isAuditCase(row) || !matchesAudit(row))) return [];
    const facts = caseFacts(row, state);
    if (!facts) return [];
    const excerpt = [row.unit?.serial, row.unit?.revision, ...facts, row.history.at(-1)?.title].filter(Boolean).join(" · ");
    return [{ id: row.id, kind, title: row.title, excerpt: excerpt.slice(0, 600), href: withSelections(toolHref(tool, row.id), scope) }];
  });

  if (tool === "audit" && selected && !caseId) {
    for (const row of state.workspace.reviewsWithoutSnapshot) {
      if (!includesUnit(selected, row.unit) || !matchesAudit(row)) continue;
      const query = new URLSearchParams({ q: row.id });
      sources.push({ id: row.id, kind, title: row.decision,
        excerpt: [row.unit.serial, row.unit.revision, "No archived snapshot", row.recordedAt, row.reason].join(" · ").slice(0, 600),
        href: withSelections(toolHref("audit") + "?" + query, scope) });
    }
  }

  return sources;
}
