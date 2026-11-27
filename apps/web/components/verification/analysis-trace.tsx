import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LabeledSelect } from "@/components/records/forms";
import { FrameFigure, CaptionRegion } from "./caption-region";
import type { Box, AnalysisSetup, ImageChannel as Metric, RunEdition, AlignedSample } from "@/lib/evidence/images";
import { EvidenceChart } from "./evidence-chart";
const roles = ["source", "comparison", "control"] as const;
const chart = {
  source: { label: "Source", color: "#3347a7" },
  comparison: { label: "Comparison", color: "#0f766e" },
  control: { label: "Control", color: "#a45313" },
};
function AnalysisTrace({
  runs,
  rows,
  metric,
  start,
  end,
}: {
  runs: RunEdition[];
  rows: AlignedSample[];
  metric: Metric;
  start: number;
  end: number;
}) {
  return (
    <>
      <ul aria-label="Trace legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {runs.map((run, i) => (
          <li key={run.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-5 border-t-2"
              style={{
                borderColor: chart[roles[i]].color,
                borderTopStyle: i === 0 ? "solid" : i === 1 ? "dashed" : "dotted",
              }}
            />
            {chart[roles[i]].label} · {run.serial}
          </li>
        ))}
      </ul>
      <EvidenceChart config={chart} className="h-48 w-full min-w-0" height={192}>
        {charts => (
          <charts.LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
            <charts.CartesianGrid strokeDasharray="2 4" vertical={false} />
            <charts.XAxis
              dataKey="source.frame"
              type="number"
              domain={["dataMin", "dataMax"]}
              allowDecimals={false}
              label={{ value: "Source frame", position: "insideBottom", offset: -10 }}
            />
            <charts.YAxis width={44} label={{ value: "Y′ levels", angle: -90, position: "insideLeft" }} />
            <charts.ReferenceArea x1={start} x2={end} fill="var(--primary)" fillOpacity={0.07} />
            {runs.map((run, i) => (
                <charts.Line
                  key={run.id}
                  dataKey={roles[i] + "." + metric}
                  stroke={chart[roles[i]].color}
                  strokeWidth={2}
                  strokeDasharray={["", "6 3", "2 3"][i]}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
          </charts.LineChart>
        )}
      </EvidenceChart>
    </>
  );
}

export function AlignedFrames({
  runs,
  rows,
  setup,
  setRegion,
  setInterval,
}: {
  runs: RunEdition[];
  rows: AlignedSample[];
  setup: AnalysisSetup;
  setRegion?: (region: Box) => void;
  setInterval?: (window: [number, number]) => void;
}) {
  const { first: start, last: end, region, channel: metric } = setup;
  const [cursor, setCursor] = useState(start);
  const point = rows.find((row) => row.source.frame === cursor) ?? rows[0];
  if (!point)
    return <p role="status">No frames overlap at this alignment. Adjust the offset or choose another run.</p>;
  const [source, comparison, control] = runs;
  return (
    <>
      <p className="text-sm">
        {source.frameLayout === comparison.frameLayout
          ? "Matched sheet layout. Compare corresponding caption regions."
          : "Different sheet layouts. Compare caption texture across units. Individual pixels have no common registration."}
        {control && control.frameLayout !== source.frameLayout && " The control uses another sheet layout."}{" "}
        The marker is the first frame with the complete identifier visible. Frame alignment has no
        elapsed-time basis.
      </p>
      <AnalysisTrace runs={runs} rows={rows} metric={metric} start={start} end={end} />
      <div className="flex flex-wrap items-center gap-2" aria-label="Inspect aligned frames">
        {rows.map((row) => (
          <Button
            key={row.source.frame}
            size="sm"
            variant={point.source.frame === row.source.frame ? "default" : "outline"}
            aria-label={"Inspect source frame " + row.source.frame}
            aria-pressed={point.source.frame === row.source.frame}
            onClick={() => setCursor(row.source.frame)}
          >
            {row.source.frame}
          </Button>
        ))}
        <span className="block mt-0.5 text-xs text-muted-foreground">Source frame</span>
      </div>
      <div className={`grid min-w-0 gap-3 ${control ? "md:grid-cols-3" : "sm:grid-cols-2"}`}>
        {runs.map((run, i) => (
          <FrameFigure
            key={run.id}
            run={run}
            index={point[roles[i]]!.frame}
            region={region}
            label={chart[roles[i]].label}
          />
        ))}
      </div>
      {setRegion && (
        <CaptionRegion
          region={region}
          onChange={setRegion}
          source={source}
          comparison={comparison}
          sample={point}
        />
      )}
      {setInterval && <div className="grid gap-3 sm:grid-cols-2">
        {(["First frame", "Last frame"] as const).map((label, i) => (
          <LabeledSelect
            key={label}
            label={label}
            value={String(i ? end : start)}
            options={rows
              .filter((r) => (i ? r.source.frame >= start : r.source.frame <= end))
              .map((r) => String(r.source.frame))}
            onChange={(v) => {
              const frame = Number(v);
              setInterval(i ? [start, frame] : [frame, end]);
              setCursor(frame);
            }}
          />
        ))}
      </div>}
    </>
  );
}
