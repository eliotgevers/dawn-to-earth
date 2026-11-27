import { downloadJson } from "@/lib/workspace";
import { TableColumns } from "@/components/records/table";
import { GrafanaLinks } from "./grafana-links";
import { analysisTraceWindows } from "@/lib/evidence/traces";
import { Button } from "@/components/ui/button";
import {
  runLabels,
  alignmentSensitivity,
  meanPairedChange,
  type RunEdition,
  type AnalysisSetup,
  type AlignedSample,
} from "@/lib/evidence/images";
import type { AnalysisLibrary } from "@/db/verification/inspection";
type SavedAnalysis = AnalysisLibrary["saved"][number];
const number = (value: number) => value.toFixed(1);
function exportMeasurements(reading: SavedAnalysis, runs: RunEdition[], origin: string) {
  const exportData = {
    finding: reading,
    sourceCheck: origin,
    frameBasis: runs.map((run) => ({
      id: run.id,
      serial: run.serial,
      revisionId: run.revisionId,
      archiveId: run.archiveId,
      marker: run.marker,
      layout: run.frameLayout,
      digest: run.digest,
      frames: run.frames.map(({ image, sha256, caption }) => ({ image, sha256, caption })),
    })),
    units: "8-bit luma levels",
    algorithm:
      "Rounded BT.709 luma code values; population standard deviation over the selected caption tiles.",
  };
  downloadJson(JSON.stringify(exportData, null, 2), "caption-analysis-" + reading.id + ".json");
}

export function AnalysisReport({
  origin, editions, setup, samples, reading,
}: {
  origin: string;
  editions: (RunEdition | undefined)[];
  setup: AnalysisSetup;
  samples: AlignedSample[];
  reading?: SavedAnalysis;
}) {
  const [source, comparison, control] = editions;
  const runs = editions.filter((run) => run !== undefined);
  const complete = runs.length === editions.length;
  const metric = setup.channel;
  const delta = meanPairedChange(samples, metric);
  const sensitivity = complete && source && comparison && samples.length
    ? alignmentSensitivity(source, comparison, control, setup) : [];
  return (
    <>
      <p className="text-sm">
        <strong>
          {delta > 0 ? "+" : ""}
          {number(delta)} Y′ levels
        </strong>{" "}
        · Mean paired change in {metric === "mean" ? "brightness" : "contrast"} across {samples.length}{" "}
        matched {samples.length === 1 ? "frame" : "frames"}.
        {control &&
          " The control sets the common frame coverage and is plotted separately from this difference."}
      </p>
      {sensitivity.length > 0 && <AlignmentSensitivityTable rows={sensitivity} shift={setup.shift} frameCount={samples.length} />}
      {complete && <GrafanaLinks windows={analysisTraceWindows(runs, samples)} />}
      <details>
        <summary className="cursor-pointer font-medium">Measurements and provenance</summary>
        <p className="my-2 text-sm text-muted-foreground">
          Y′ is rounded 8-bit luma. Contrast is its population standard deviation across pixels in the
          selected caption region. Frame number is ordinal. Neither measure establishes identifier legibility.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <TableColumns
              caption={`Paired frame numbers and measured ${metric} in Y prime levels`}
              labels={[...runLabels.slice(0, samples.some(row => row.control) ? 3 : 2), "Change"]}
              className="[&_th]:py-1"
            />
            <tbody className="divide-y">
              {samples.map((row) => (
                <tr key={row.source.frame}>
                  {[row.source, row.comparison, row.control].map((val, i) => val && (
                    <td key={runLabels[i]} className="py-1">
                      F{val.frame} · {number(val[metric])}
                    </td>
                  ))}
                  <td>{number(row.comparison[metric] - row.source[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reading && (
          <Button
            size="sm"
            variant="outline"
            className="my-2"
            onClick={() => exportMeasurements(reading, runs, origin)}
          >
            Export measurements
          </Button>
        )}
        {(reading?.basis.editions ?? runs).map((edition, index) => {
          const run = editions[index];
          return (
            <p key={edition.id} className="mt-2 break-all text-xs text-muted-foreground">
              {run ? `${run.title} · ${run.serial} / ${run.revisionId} · marker F${run.marker}` : edition.id}{" "}
              · SHA-256 {edition.digest}
            </p>
          );
        })}
      </details>
    </>
  );
}

function AlignmentSensitivityTable({rows: sensitivity, shift, frameCount}: {
  rows: ReturnType<typeof alignmentSensitivity>;
  shift: number;
  frameCount: number;
}) {
  const signs = new Set(sensitivity.flatMap(row => row.change === null ? [] : [Math.sign(row.change)]));
  return (
    <details>
      <summary className="cursor-pointer font-medium">Check alignment sensitivity</summary>
      <p className="my-2 text-sm">
        {signs.size > 1
          ? "The direction of the measured change depends on frame alignment."
          : sensitivity.some((s) => s.change === null)
            ? "Some offsets lack full coverage of this interval."
            : "The direction is unchanged across these three offsets."}{" "}
        The source interval and control stay fixed.
      </p>
      <table className="w-full max-w-lg text-left text-sm">
        <TableColumns
          caption="Mean change at neighboring comparison offsets"
          labels={["Offset", "Coverage", "Change in Y′"]}
        />
        <tbody className="divide-y">
          {sensitivity.map((s) => (
            <tr key={s.offset}>
              <td className="py-1">
                {shift + s.offset} frames{s.offset === 0 ? " · selected" : ""}
              </td>
              <td>
                {s.count}/{frameCount}
              </td>
              <td>{s.change === null ? "Incomplete" : number(s.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
