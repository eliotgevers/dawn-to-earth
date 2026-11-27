import { badgeTones } from "@/components/records/presentation";
import { RecordTable, TableColumns } from "@/components/records/table";
import type { RecordedSeries } from "./numeric-series";
import { EvidenceChart } from "./evidence-chart";
import { RecordFacts } from "@/components/records/layout";
import { Badge } from "@/components/ui/badge";
import type { TimedTracePoint, FixtureExchange, VerificationRecords, VerificationTest } from "./model";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChartConfig } from "@/components/ui/chart";

const traceConfig = {
  value: { label: "Reading", color: "var(--color-primary)" },
} satisfies ChartConfig;

const comparisonConfig = {
  value: { label: "Observed", color: "var(--color-primary)" },
  reference: { label: "Reference", color: "var(--color-muted-foreground)" },
} satisfies ChartConfig;

type TraceProps = {
  label: string;
  quantity: string;
  scale?: "index" | "unit";
} & (
  | { values: readonly number[]; sampleAxis: string; reference?: readonly number[]; points?: never; target?: never }
  | { points: readonly TimedTracePoint[]; target: number; values?: never; reference?: never; sampleAxis?: never }
);

function EvidenceTrace({ label, quantity, values, points, reference, sampleAxis, scale, target }: TraceProps) {
  const labelId = useId();
  const data: readonly { value: number }[] = points ?? values.map((value, i) => ({
    sample: i + 1, value, reference: reference?.[i],
  }));
  return (
    <figure className="min-w-0 border-t pt-2" aria-labelledby={labelId}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <strong id={labelId} className="text-[13px] font-semibold">{label}</strong>
        <span className="text-[11px] text-muted-foreground">{quantity}</span>
      </figcaption>
      <EvidenceChart config={reference ? comparisonConfig : traceConfig} className={cn("aspect-auto w-full min-w-0", points || reference ? "h-[166px]" : "h-[140px]")} height={200} unavailable={<p>Unavailable</p>}>
        {charts => (
          <charts.LineChart
            accessibilityLayer
            aria-label={`${label}, ${quantity} by ${points ? "elapsed time in seconds" : sampleAxis.toLowerCase()}`}
            data={data}
            margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
          >
            <charts.CartesianGrid vertical={false} stroke="var(--color-border)" />
            <charts.YAxis
              width={points ? 42 : 32}
              domain={scale === "unit" ? [0, 1] : [98, 102]}
              ticks={scale === "unit" ? [0, 0.5, 1] : [98, 100, 102]}
              tickFormatter={points ? (value) => `${value}%` : undefined}
              axisLine={false}
              tickLine={false}
            />
            <charts.XAxis
              type={points ? "number" : "category"}
              dataKey={points ? "elapsedSeconds" : "sample"}
              ticks={points?.map((point) => point.elapsedSeconds)}
              domain={points ? [0, "dataMax"] : undefined}
              height={points ? 42 : 36}
              label={{ value: points ? "Elapsed time (s)" : sampleAxis, position: "insideBottom", offset: 2 }}
              axisLine={false}
              tickLine={false}
              minTickGap={10}
            />
            {target !== undefined && (
              <charts.ReferenceLine y={target} stroke="#90602e" strokeDasharray="4 3" />
            )}
            <charts.Tooltip
              content={
                <charts.ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    points
                      ? `${payload[0]?.payload?.elapsedSeconds} s elapsed`
                      : `${sampleAxis} ${payload[0]?.payload?.sample}`
                  }
                  formatter={points ? (value) => `${value}% of reference` : undefined}
                />
              }
            />
            {reference && <charts.Legend content={<charts.ChartLegendContent />} />}
            {reference && (
              <charts.Line
                dataKey="reference"
                type="linear"
                stroke="var(--color-reference)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <charts.Line
              dataKey="value"
              type="linear"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              isAnimationActive={false}
            />
          </charts.LineChart>
        )}
      </EvidenceChart>
    </figure>
  );
}

function assessExchange({ request, reply, deadlineMs, expected }: FixtureExchange) {
  const responseTime = reply ? reply.atMs - request.atMs : undefined;
  if (!reply || reply.atMs > deadlineMs) {
    return { status: "Timeout", responseTime } as const;
  }
  return { status: reply.message === expected ? "Matched" : "Mismatch", responseTime } as const;
}

type CaptureFields = {
  traces: TraceProps[];
  facts?: readonly (readonly [string, ReactNode])[];
  annotation?: string;
};

function captureFields(
  data: VerificationRecords,
  test: Exclude<VerificationTest, "communication">,
  retest: boolean,
): CaptureFields {
  switch (test) {
    case "leak": {
      const fixture = data.leakFixture;
      return {
        traces: [
          {
            label: "Pressure trace",
            quantity: "Pressure index (unitless)",
            sampleAxis: "Capture point",
            values: fixture.pressure,
          },
          {
            label: "Temperature trace",
            quantity: "Temperature index (unitless)",
            sampleAxis: "Capture point",
            values: fixture.temperature,
          },
        ],
        facts: [
          ["Temperature-adjusted leak estimate", `${fixture.adjustedEstimate} (unitless leak index)`],
          ["Leak rate limit", `${fixture.fictionalLimit} (unitless leak index)`],
          [
            "Evidence assessment",
            fixture.adjustedEstimate < fixture.fictionalLimit
              ? "Below the leak rate limit."
              : "At or above the leak rate limit.",
          ],
        ],
      };
    }
    case "pressure": {
      const fixture = retest ? data.proofPressureRetestFixture : data.proofPressureFixture;
      const peak = fixture.points.reduce((highest, point) => point.value > highest.value ? point : highest);
      return {
        traces: [
          {
            label: "Proof pressure trace",
            quantity: "Pressure (% of reference)",
            points: fixture.points,
            target: fixture.target,
          },
        ],
        facts: [
          ["Target pressure", `${fixture.target}% of reference`],
          ["Peak pressure", `${peak.value}% of reference at ${peak.elapsedSeconds} s`],
          ["Trace result", peak.value >= fixture.target ? "Target reached." : "Target not reached."],
          ["Inspection result", fixture.inspection.notes ? <>
            {fixture.inspection.result}
            <span className="block mt-0.5 text-xs text-muted-foreground">{fixture.inspection.notes}</span>
          </> : fixture.inspection.result],
        ],
      };
    }
    case "vibration":
    case "thermal": {
      const fixture = test === "vibration" ? data.vibrationFixture : data.thermalFixture;
      const trace: TraceProps =
        "observed" in fixture
          ? {
              label: "Vibration trace",
              quantity: "Response amplitude (unitless)",
              sampleAxis: "Comparison point",
              values: fixture.observed,
              reference: fixture.reference,
              scale: "unit",
            }
          : {
              label: "Cycle trace",
              quantity: "Temperature index (unitless)",
              sampleAxis: "Cycle capture point",
              values: fixture.cycle,
              scale: "unit",
            };
      return {
        traces: [trace],
        facts: [
          ["Inspection result", fixture.inspection],
          ["Functional result", fixture.functionalResult],
        ],
      };
    }
    case "ground-firing":
      return {
        traces: [
          {
            label: "Recorded trace",
            quantity: "Response amplitude (unitless)",
            sampleAxis: "Archive sample",
            values: data.groundFiringFixture.trace,
            scale: "unit",
          },
        ],
        annotation: data.groundFiringFixture.annotation,
      };
  }
}

export function EvidenceCapture({
  data,
  test,
  retest,
}: {
  data: VerificationRecords;
  test: VerificationTest;
  retest: boolean;
}) {
  if (test === "communication") {
    const exchanges = data.communicationExchanges;
    return (
      <>
        <RecordTable className="mt-1 table-fixed wrap-anywhere [&_tbody_tr]:border-t max-[430px]:[&_:is(th,td)]:px-1.5 max-[430px]:[&_[data-slot=badge]]:text-[11px]" aria-label="Message exchange results">
          <TableColumns labels={["Expected", "Observed", "Result"]} />
          <tbody>
            {exchanges.map((exchange) => {
              const { status, responseTime } = assessExchange(exchange);
              return (
                <tr key={exchange.label}>
                  <td>
                    <code>{exchange.expected}</code>
                    <span className="block mt-0.5 text-xs text-muted-foreground">{exchange.label}</span>
                  </td>
                  <td>
                    {exchange.reply ? <code>{exchange.reply.message}</code> : "No reply"}
                    <span className="block mt-0.5 text-xs text-muted-foreground">
                      {responseTime !== undefined
                        ? `${responseTime} ms response`
                        : `${exchange.deadlineMs - exchange.request.atMs} ms window`}
                    </span>
                  </td>
                  <td>
                    <Badge variant="outline" className={`h-6 max-sm:h-[22px] max-sm:px-[5px] ${status === "Matched" ? badgeTones.green : badgeTones.amber}`}>
                      {status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </RecordTable>
        <details className="my-3">
          <summary className="w-fit cursor-pointer font-semibold text-primary">Raw message log</summary>
          <ol className="mt-2 max-w-[520px] divide-y">
            {exchanges.map(({ label, request, reply }) =>
              ([["Sent", request], ["Received", reply]] as const).map(([direction, event]) => event && (
                <li key={`${label}-${direction}`} className="grid grid-cols-[minmax(48px,auto)_minmax(75px,auto)_minmax(0,1fr)] gap-2 py-1.5 text-xs text-muted-foreground tabular-nums">
                  <span>{event.atMs} ms</span>
                  <span>{direction}</span>
                  <code>{event.message}</code>
                </li>
              )),
            )}
          </ol>
        </details>
      </>
    );
  }
  const { traces, facts, annotation } = captureFields(data, test, retest);
  return (
    <>
      <div className={cn("mt-3 grid min-w-0 gap-4 max-[550px]:gap-2.5", test === "leak" && "min-[551px]:grid-cols-2")}>
        {traces.map(trace => <EvidenceTrace key={trace.label} {...trace} />)}
      </div>
      {facts && <RecordFacts layout="paired" entries={facts} />}
      {annotation && (
        <details className="my-3">
          <summary className="w-fit cursor-pointer font-semibold text-primary">Archive note</summary>
          <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{annotation}</p>
        </details>
      )}
    </>
  );
}

export function RecordedReadings({ series }: { series: RecordedSeries[] }) {
  return series.map(trace => (
    <div key={trace.editionId} className="mb-3 max-h-80 overflow-auto" role="region" tabIndex={0}
      aria-label={trace.quantity + " readings from " + trace.source}>
      <RecordTable className="table-fixed wrap-anywhere">
        <caption className="py-1 text-left text-sm font-medium">{trace.quantity} · {trace.source}</caption>
        <TableColumns labels={["Elapsed (ms)", "Reading (" + trace.unit + ")", "Source row"]} />
        <tbody>{trace.points.map(point => (
          <tr key={point.id}><td>{point.elapsedMs}</td><td>{point.value}</td><td>{point.locator}</td></tr>
        ))}</tbody>
      </RecordTable>
    </div>
  ));
}
