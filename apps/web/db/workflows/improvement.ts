import type { RecordUnit } from "@/lib/records/journal";
import { assemblyAtUnit, entryText, openAssignments, type ToolCommand, type ToolContext, type WorkCase, type WorkWrite } from "./cases";

export type Step = "handoff" | "pickup" | "return" | "resubmit" | "close";
type Stamp = { step: Step; at: string | null; note?: string };
export type Edition = "before" | "after";
export type ArchivedOrder = {
  buildId: string;
  reference: string;
  unit: RecordUnit;
  register: string;
  edition: Edition;
  date: string;
  stamps: Stamp[];
  // Event coverage and timestamp coverage are independent in a paper register.
  completeLog: boolean;
};
export type Study = WorkCase & {
  data: {
    change: string;
    effective: string;
    reference: string;
    editions: Record<Edition, string>;
    orders: ArchivedOrder[];
  };
};
export const stepLabels: Record<Step, string> = {
  handoff: "Packet handed to Quality",
  pickup: "Review started",
  return: "Returned to Production",
  resubmit: "Correction handed to Quality",
  close: "Packet indexed",
};
export const measures = {
  wait: {
    label: "Quality pickup wait",
    definition: "Median minutes from Production handoff to first Quality pickup.",
  },
  correction: {
    label: "Correction turnaround",
    definition:
      "Median minutes to resubmit, among orders with a recorded return. Multiple correction intervals are summed within each order.",
  },
  returned: {
    label: "Orders returned",
    definition:
      "Share of orders with at least one return, among those with a complete register or an observed return.",
  },
} as const;
export type Measure = keyof typeof measures;
export const nextActions = {
  retain: "Keep the change",
  revise: "Recommend a revision",
  observe: "Collect more orders",
};

export function elapsed(start?: Stamp, end?: Stamp) {
  if (!start?.at || !end?.at) return null;
  const minutes = (Date.parse(end.at) - Date.parse(start.at)) / 60_000;

  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

function orderMeasure(order: ArchivedOrder, measure: Measure) {
  const { stamps } = order;

  if (measure === "wait")
    return elapsed(
      stamps.find((s) => s.step === "handoff"),
      stamps.find((s) => s.step === "pickup"),
    ) ?? "Register incomplete";
  if (measure === "returned") {
    if (stamps.some(stamp => stamp.step === "return")) return 1;
    return order.completeLog ? 0 : "Register incomplete";
  }

  if (!order.completeLog) return "Register incomplete";
  let total: number | null = null;
  for (const [i, stamp] of stamps.entries()) {
    if (stamp.step !== "return") continue;
    const next = stamps[i + 1];
    const minutes = next?.step === "resubmit" ? elapsed(stamp, next) : null;
    if (minutes === null) return "Register incomplete";
    total = (total ?? 0) + minutes;
  }

  return total ?? "No correction requested";
}

export function orderSources(study: Study, workspace: ToolContext["workspace"]) {
  const cutoff = Date.parse(study.data.effective + "T00:00:00Z");

  return study.data.orders.map((order) => {
    const build = assemblyAtUnit(workspace, order.buildId, order.unit);
    const source = build?.kind === "build" && build.status === "Complete" ? build : undefined;
    const time = (step: Step) => Date.parse(order.stamps.find(stamp => stamp.step === step)?.at ?? "");
    const starts = time("handoff");
    const ends = time("close");
    const eligible = starts <= ends && (order.edition === "before" ? ends < cutoff : starts >= cutoff);
    const exclusion = !source
      ? "Exact completed build unavailable"
      : !eligible
        ? "Order dates do not establish the recorded cohort"
        : !source.history?.some((event) => Date.parse(event.at) === ends)
          ? "Register close is missing from the linked build history"
          : null;

    return { order, source, exclusion };
  });
}

export type Cohort = ReturnType<typeof cohort>;
export function cohort(
  sources: ReturnType<typeof orderSources>,
  edition: Edition,
  measure: Measure,
) {
  const orders = sources
    .filter(({ order }) => order.edition === edition)
    .map(({ order, exclusion }) => {
      const observation = exclusion ?? orderMeasure(order, measure);

      return {
        buildId: order.buildId,
        unit: order.unit,
        register: order.register,
        value: typeof observation === "number" ? observation : null,
        reason: typeof observation === "string" ? observation : null,
      };
    });
  const values = orders.flatMap((row) => (row.value === null ? [] : [row.value])).sort((a, b) => a - b);
  let value: number | null = null;
  if (values.length) {
    const middle = Math.floor(values.length / 2);
    value =
      measure === "returned"
        ? (values.reduce((sum, n) => sum + n, 0) / values.length) * 100
        : (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2;
  }

  return { total: orders.length, measured: values.length, value, orders };
}

export const measureKeys = Object.keys(measures) as Measure[];

export function studyInterventions(study: Study) {
  const history = study.history;
  const assessments = Map.groupBy(history.filter(event => event.kind === "intervention-assessed"),
    event => event.data.interventionId);
  const interventions = history.filter(event => event.kind === "intervention-tracked")
    .map(tracked => ({ tracked, assessment: assessments.get(tracked.id)?.[0] }));
  const remaining = measureKeys.filter(key => !interventions.some(({ tracked }) => tracked.data.measure === key));
  const last = history.at(-1);
  const pending = last?.kind === "intervention-tracked" ? last : undefined;
  const status = pending ? "Awaiting assessment" : last?.kind === "intervention-assessed" ? "Assessed" : "Ready to study";

  return { interventions, remaining, last, pending, status };
}

export function decide(ctx: ToolContext, cmd: ToolCommand): WorkWrite | string {
  const study = cmd.dossier as Study;
  const { last, pending, remaining } = studyInterventions(study);
  if (cmd.data.previousId !== (last?.id ?? null))
    return "The study changed. Review its latest entry before recording.";
  const note = entryText(cmd.data.note, 1000);
  if (!note) return "Enter a statement of up to 1,000 characters.";
  if (cmd.action === "track" && (!last || last.kind === "intervention-assessed")) {
    const key = cmd.data.measure;
    if (typeof key !== "string" || !Object.hasOwn(measures, key)) return "Choose a measure to track.";
    const measure = key as Measure;
    if (!remaining.includes(measure))
      return "This measure already has a saved intervention.";
    const owner = ctx.workspace.actors.find((p) => p.id === cmd.data.owner);
    if (!owner) return "Choose an owner from the directory.";
    const baseline = cohort(orderSources(study, ctx.workspace), "before", measure);
    if (!baseline.measured) return "No eligible baseline observation is available for this measure.";
    return {
      kind: "intervention-tracked",
      title: "Intervention registered",
      data: {
        measure,
        owner: owner.id,
        note,
        baseline,
        instruction: study.data.reference,
        change: study.data.change,
        effective: study.data.effective,
        editions: study.data.editions,
      },
      tasks: [
        {
          title: "Assess " + study.title.toLowerCase(),
          section: "production",
          owner: owner.id,
          sourceId: study.id + "-" + measure,
        },
      ],
    };
  }
  if (cmd.action === "assess" && pending) {
    if (
      typeof cmd.data.disposition !== "string" ||
      !Object.hasOwn(nextActions, cmd.data.disposition)
    )
      return "Choose a next action.";
    const measure = pending.data.measure as Measure;
    const later = cohort(orderSources(study, ctx.workspace), "after", measure);
    if (later.value === null) return "No eligible later observation is available for this measure.";
    const baseline = pending.data.baseline as Cohort;
    if (baseline.value === null) return "The saved baseline has no eligible observations.";
    const assignment = openAssignments(pending, ctx.tasks).find(task => task.owner === pending.data.owner);
    if (!assignment) return "The follow-up assignment is no longer open.";
    return {
      kind: "intervention-assessed",
      title: "Outcome recorded",
      data: {
        interventionId: pending.id,
        measure,
        later,
        delta: later.value - baseline.value,
        note,
        disposition: cmd.data.disposition,
      },
      completeTaskIds: [assignment.id],
    };
  }

  return "This action is unavailable at the current stage.";
}
