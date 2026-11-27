import { parseSelection, requirementApplies, unitSelection } from "@/components/workspace/selection";
import { isRecordUnit, sameUnit, type RecordUnit } from "@/lib/records/journal";
import { recordField } from "@/lib/records/links";
import { entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkWrite } from "./cases";

type Sample = { locator: string; value: number | null; finding: "Demonstrated" | "Exception" | "Unrecorded" };
export type ClaimStudy = {
  valueRole?: "observed-result";
  quantity: string;
  unit: string;
  proposedValue: number | null;
  testedConfiguration: string;
  proposedConfiguration: string | null;
  dependency: string;
  targetSource: string;
  samples: Sample[];
};
export const outcomes = {
  applies: "Applies", "does-not-support": "No longer supports", undetermined: "Undetermined", "new-evidence": "Request new evidence",
} as const;
export const assumptions = {
  recorded: "As documented", changed: "Dependency changed", unknown: "Dependency unconfirmed",
} as const;
type Assumption = keyof typeof assumptions;
export type Judgment = {
  rowId: string;
  outcome: keyof typeof outcomes;
  reason: string;
  assumption: Assumption;
  citations?: string[];
};

export function compareStudy(study: ClaimStudy, assumption: Assumption = "recorded") {
  let applicable = 0;
  let confirmed = 0;
  let missing = 0;

  for (const sample of study.samples) {
    if (sample.value === null || sample.finding === "Unrecorded") {
      missing++;
      continue;
    }
    // Inspection values report what was observed. Older worksheets record the condition tested.
    if (study.valueRole !== "observed-result" && sample.value !== study.proposedValue) continue;
    applicable++;
    if (sample.finding === "Demonstrated" && sample.value === study.proposedValue) confirmed++;
  }

  const exception = applicable - confirmed;
  const dependency = assumption === "unknown" || study.proposedConfiguration === null ? "unknown"
    : assumption === "changed" || study.testedConfiguration !== study.proposedConfiguration ? "changed" : "recorded";
  const result = dependency === "unknown" || study.proposedValue === null || missing === study.samples.length ? "No basis"
    : dependency === "changed" || exception > 0 ? "Difference"
    : !applicable || missing > 0 ? "No basis" : "Match";

  return { result, dependency, applicable, confirmed, exception, missing };
}

export type Finding = {
  study?: ClaimStudy;
  id: string;
  title: string;
  expected: string;
  recorded: string | null;
  locator: string | null;
  followUp: string;
};
type SheetView = { label: string; observation: string; crop: [number, number, number, number] | null };
export type ObservationSheet = {
  file: string; width: number; height: number; control: SheetView; views: SheetView[];
};
export type Comparison = {
  sheet?: ObservationSheet;
  evidenceId?: string;
  revisionId: string;
  revision: string;
  requirementId: string;
  requirement: string;
  statement: string;
  baseline: string;
  report: string;
  reportTitle: string;
  previousBaseline: string;
  rows: Finding[];
  sourceId?: string;
  targetCriterion?: string;
};

function comparisonScope(revisionId: string, unit?: RecordUnit | null) {
  return unit ? unitSelection(unit.serial, revisionId) : `revision:${revisionId}` as const;
}

export function reviewedTarget(basis: Comparison, current?: RecordUnit | null, proposal?: WorkEvent) {
  const subject = proposal?.data.subject;
  const unit = isRecordUnit(subject) ? subject : current;
  const currentScope = comparisonScope(basis.revisionId, unit);
  const selection = String(proposal?.data.scope ?? currentScope);
  // Older proposals can retain the exact selection without retaining the unit label.
  return { selection, unit: selection === currentScope && unit?.revisionId === basis.revisionId ? unit : undefined };
}

export function sourceOptions(record: WorkCase, cases: WorkCase[]) {
  return [record, ...cases.filter(row => row.tool === "qualification" && row.data.sourceFor === record.id)];
}

// Join the selected edition's observations. Other editions supply identities and labels only.
export function comparison(record: WorkCase, source?: WorkCase): Comparison {
  const target = record.data as Comparison;
  if (!source) return target;
  if (source.id === record.id) return { ...target, sourceId: record.id };

  const { report, previousBaseline, targetCriterion, evidenceId, sheet, excerpts } = source.data as Pick<Comparison, "report" | "previousBaseline" | "targetCriterion" | "evidenceId" | "sheet"> & {
    excerpts: Record<string, Pick<Finding, "recorded" | "locator" | "study">>;
  };

  return {
    ...target, sourceId: source.id, report, previousBaseline, targetCriterion, reportTitle: source.title, evidenceId, sheet,
    rows: target.rows.map(row => {
      const excerpt = excerpts[row.id];

      return { ...row, recorded: excerpt?.recorded ?? null, locator: excerpt?.locator ?? null, study: excerpt?.study };
    }),
  };
}

// A report-only historical reference must identify just one source edition.
export function proposalSource(options: WorkCase[], subject?: Record<string, unknown>) {
  if (!subject) return options.find(row => row.data.targetCriterion) ?? options[0];
  const report = subject.report ?? options[0].data.report;
  const matches = options.filter(row => row.data.report === report && (!subject.sourceId || row.id === subject.sourceId));

  return matches.length === 1 ? matches[0] : undefined;
}

export function proposedBasis(current: Comparison, proposal?: WorkEvent): Comparison {
  // Early proposals stored the clause snapshot before including the report display names.
  if (!proposal) return current;
  const archived = proposal.data as Partial<Comparison>;

  return { ...current, ...archived, evidenceId: archived.evidenceId, sheet: archived.sheet };
}

function sameBasis(current: Comparison, proposed: Comparison) {
  const identity = (value: Comparison) =>
    JSON.stringify([
      value.requirementId,
      value.revisionId,
      value.statement,
      value.baseline,
      value.report,
      value.previousBaseline,
      value.targetCriterion ?? null,
      value.evidenceId ?? null,
      value.sheet ? [value.sheet.file, value.sheet.width, value.sheet.height,
        [value.sheet.control, ...value.sheet.views].map(view => [view.label, view.observation, view.crop])] : null,
      value.rows.map(({ id, expected, recorded, locator, followUp, study }) => [
        id,
        expected,
        recorded,
        locator,
        followUp,
        study ? [study.valueRole ?? null, study.quantity,study.unit,study.proposedValue,study.testedConfiguration,study.proposedConfiguration,
          study.dependency,study.targetSource,study.samples.map(s=>[s.locator,s.value,s.finding])] : null,
      ]),
    ]);

  return identity(current) === identity(proposed);
}

export function clauseCoverage(row: Finding) {
  if (row.recorded === null || row.locator === null) return "No basis";

  return row.recorded === row.expected ? "Match" : "Difference";
}

// Early clause proposals only recorded the matching rows and their reasons.
function judgmentsOf(data: Record<string, unknown>) {
  if (Array.isArray(data.judgments)) return data.judgments;

  return Array.isArray(data.reuse) ? data.reuse.map(row => ({
    ...row, outcome: "applies", assumption: "recorded",
  })) : undefined;
}

export function proposalJudgments(event?: WorkEvent): Judgment[] {
  return event ? judgmentsOf(event.data) ?? [] : [];
}

export const findingOutcomes = ["Source located", "Difference remains", "Source unavailable"] as const;

function currentEdition(editions: WorkEvent[], previous: string) {
  const replaced = new Set(editions.map(event => event.data[previous]));

  return editions.find(event => !replaced.has(event.id));
}

export function lastFinding(history: WorkEvent[], taskId: string) {
  return currentEdition(history.filter(e => e.kind === "gap-documented" && e.data.taskId === taskId), "previousFindingId");
}

export function reviewState(record: WorkCase) {
  const history = record.history;
  const proposal = currentEdition(history.filter(e => e.kind === "reuse-proposed"), "previousProposalId");
  const decision = proposal && history.find(event => event.data.proposalId === proposal.id &&
    (event.kind === "reuse-endorsed" || event.kind === "reuse-returned"));
  const status = !proposal
    ? "Ready to compare"
    : !decision
      ? "Awaiting review"
      : decision.kind === "reuse-endorsed"
        ? "Reviewed"
        : "Returned";

  return { history, proposal, decision, status, canPropose: status === "Ready to compare" || status === "Returned" };
}

export function decide(context: ToolContext, command: ToolCommand): WorkWrite | string {
  const record = command.dossier;
  if (record.data.sourceFor) return "Qualification comparison not found.";
  const { history, proposal, decision, canPropose } = reviewState(record);
  const data = command.data;
  if (command.action === "document-gap") {
    const task = openAssignments(decision, context.tasks).find(t => t.id === data.taskId);
    if (!task || decision?.kind !== "reuse-endorsed")
      return "Choose an open verification assignment for this review.";
    const previous = lastFinding(history, task.id);
    if ((previous?.id ?? null) !== data.previousFindingId)
      return "A newer finding exists. Reopen the assignment before recording another.";
    const archived = proposedBasis(comparison(record), proposal);
    const row = archived.rows.find((entry) => entry.id === task.sourceId);
    const { selection } = reviewedTarget(archived, record.unit, proposal);
    if (!row || (task.selection && task.selection !== selection))
      return "The assignment does not match the reviewed clause and revision.";
    const outcome = findingOutcomes.find((value) => value === data.outcome);
    if (!outcome) return "Choose what the archive check found.";
    const source = entryText(data.source, 160);
    const observation = entryText(data.observation, 1000);
    if (!source || !observation) return "Enter an archive reference and the observation it supports.";
    return {
      kind: "gap-documented",
      title: `Verification evidence recorded · ${row.title}`,
      data: {
        proposalId: proposal?.id,
        taskId: task.id,
        rowId: task.sourceId,
        previousFindingId: previous?.id ?? null,
        outcome,
        source,
        observation,
      },
      completeTaskIds: outcome === "Source located" ? [task.id] : [],
    };
  }
  if (command.action !== "propose" && command.action !== "review") return "Unknown qualification action.";
  const review = command.action === "review" ? proposal : undefined;
  if (command.action === "review" && (!review || decision || data.proposalId !== review.id))
    return "This proposal is no longer awaiting this review.";
  const reason = entryText(data.reason, 1000);
  if (review) {
    if (!reason) return "Record the reason for the decision.";
    if (data.outcome === "return") {
      const archived = proposedBasis(comparison(record), review);
      const target = reviewedTarget(archived, record.unit, review);
      const selection = parseSelection(target.selection);
      if (!selection) return "The archived proposal does not identify a valid review scope.";
      return {
        kind: "reuse-returned", title: `Qualification proposal returned · ${archived.requirement}`,
        data: { proposalId: review.id, reason },
        tasks: [{ sourceId: "qualification-proposal", section: "engineering", selection, unit: target.unit, owner: review.actor,
          title: `Revise ${archived.requirement} qualification proposal · ${reason}` }],
      };
    }
    if (data.outcome !== "endorse") return "Choose a review decision.";
  }
  const staleBasis = "The proposal basis changed. Return it for a new comparison.";
  const source = proposalSource(sourceOptions(record, context.cases), review?.data ?? data);
  if (!source) return review ? staleBasis : "Choose a qualification report available for this requirement.";
  const basis = comparison(record, source);
  const { workspace } = context;
  const owner = record.unit;
  const scope = comparisonScope(basis.revisionId, owner);
  const technical = basis.rows.some(row => row.study);
  const requirementListed = requirementApplies(workspace.catalog, basis.requirementId, basis.revisionId, owner);
  const currentCriterion = () => {
    const target = workspace.assembly.find(row => row.kind === "requirement" && row.id === basis.requirementId);
    const activity = workspace.local.filter(({ action }) => action?.parentId === basis.requirementId && (!action.unit || sameUnit(action.unit, owner)));
    const edit = activity.find(({ action }) => action?.type === "revise" || action?.type === "edit");
    const statement = edit?.description ?? (target && recordField(target, "Requirement"));
    const criterion = edit?.requirementRevision?.criterion ?? (target && recordField(target, "Acceptance criterion"));

    return !activity.some(({ action }) => action?.type === "remove") && statement === basis.statement && criterion === basis.targetCriterion;
  };
  if (review) {
    const submitted = proposedBasis(basis, review);
    if (!requirementListed || (review.data.scope && review.data.scope !== scope) || (technical && !currentCriterion()) || !sameBasis(basis, submitted))
      return staleBasis;
    const retained = new Set(proposalJudgments(review).filter(row => row.outcome === "applies").map(row => row.rowId));
    const gaps = submitted.rows.filter((row) => !retained.has(row.id));
    const assignee = entryText(data.owner, 100);
    if (gaps.length && !context.workspace.actors.some(user => user.id === assignee)) return "Choose an owner for verification work.";
    return {
      kind: "reuse-endorsed",
      title: `Qualification coverage reviewed · ${basis.requirement}`,
      data: { proposalId: review.id, reason },
      tasks: gaps.map((row) => ({
        sourceId: row.id,
        section: "verification",
        selection: scope,
        ...(owner ? {unit:owner} : {}),
        owner: assignee,
        title: `${basis.requirement} · ${row.followUp}`,
      })),
    };
  }

  if (!canPropose || data.previousProposalId !== (proposal?.id ?? null))
    return "This comparison has changed. Reopen it before proposing reuse.";
  if (technical && !currentCriterion()) return "The Engineering requirement or criterion differs from the cited target. Review its current edition before proposing reuse.";
  const entries = technical ? data.judgments : judgmentsOf(data);
  if (!Array.isArray(entries) || (technical && entries.length !== basis.rows.length))
    return technical ? "Record a judgement and reason for every claim." : "Select comparison rows from this requirement.";
  const judgments: Judgment[] = [];
  const remaining = new Map(basis.rows.map((row, index) => [row.id, index]));
  for (const entry of entries) {
    const index = remaining.get(entry?.rowId);
    if (index === undefined) return "Choose distinct comparison rows from this requirement.";
    const row = basis.rows[index];
    remaining.delete(row.id);
    const reason = entryText(entry.reason, 1000);
    const { outcome, assumption } = entry;
    if (!reason || !Object.hasOwn(outcomes, outcome) || !Object.hasOwn(assumptions, assumption))
      return "Record a judgement, dependency basis and reason for every claim.";
    if (!row.study && (technical || outcome !== "applies" || assumption !== "recorded" || clauseCoverage(row) !== "Match"))
      return "Only distinct matching rows from this comparison can be reused.";
    if (row.study && outcome === "applies" && compareStudy(row.study, assumption).result !== "Match")
      return "The selected dependency and original observations do not support reuse for this claim.";
    const citations: unknown = entry.citations ?? [];
    const locators = new Set(row.study?.samples.map(sample => sample.locator));
    if (!Array.isArray(citations) || new Set(citations).size !== citations.length || citations.some(locator => !locators.has(locator)))
      return "Cite observations from this claim and report edition.";
    const judgment = { rowId: row.id, outcome, assumption, reason, ...(citations.length ? { citations } : {}) };
    if (technical) judgments[index] = judgment;
    else judgments.push(judgment);
  }
  if (!requirementListed) return "The target requirement is no longer listed on this design revision.";

  return {
    kind: "reuse-proposed",
    title: `Qualification proposal · ${basis.requirement}`,
    data: { ...basis, scope, ...(owner ? { subject:owner } : {}), previousProposalId: proposal?.id ?? null, judgments },
    completeTaskIds: openAssignments(decision, context.tasks).filter(t => t.section === "engineering").map(t => t.id),
  };
}
