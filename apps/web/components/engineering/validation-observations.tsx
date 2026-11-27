"use client";

import { Button } from "@/components/ui/button";
import { ConnectionLink } from "@/components/records/links";
import { recordHref } from "@/lib/records/links";
import { EvidenceChart } from "@/components/verification/evidence-chart";
import { numberLabel, residual, type assessReadings, type ValidationRow, type ValidationStudy } from "@/lib/evidence/validation";

const measurements = { Predicted: "predicted", Observed: "observed", Residual: "residual" } as const;

function ResidualPlot({
  rows,
  unit,
  historical,
}: {
  rows: ValidationRow[];
  unit: string;
  historical: boolean;
}) {
  if (!rows.length) return null;
  const extent = Math.max(1, ...rows.map(row => Math.abs(residual(row))));
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold">
        {historical ? "Reviewed" : "Independent"} residuals{" "}
        <span className="font-normal text-muted-foreground">· observed minus predicted ({unit})</span>
      </figcaption>
      <EvidenceChart
        config={{ residual: { label: "Residual", color: "#25677d" } }}
        className="mt-2 h-40 min-w-0 w-full" height={160}>
        {charts => (
          <charts.LineChart
            accessibilityLayer
            data={rows}
            margin={{ left: 3, right: 7, top: 5, bottom: 3 }}
          >
            <charts.CartesianGrid vertical={false} strokeDasharray="2 4" />
            <charts.XAxis dataKey="runId" axisLine={false} tickLine={false} minTickGap={10} />
            <charts.YAxis width={28} domain={[-extent, extent]} axisLine={false} tickLine={false} />
            <charts.ReferenceLine y={0} stroke="currentColor" />
            <charts.Line
              dataKey={residual}
              name="Residual"
              stroke="none"
              dot={{ r: 4, fill: "#25677d" }}
              isAnimationActive={false}
            />
            <charts.Tooltip />
          </charts.LineChart>
        )}
      </EvidenceChart>
    </figure>
  );
}

function sourceHref(study: ValidationStudy, row: ValidationRow, judgment?: string) {
  if (study.evidenceIds.length !== 1) return;
  return recordHref("verification", encodeURIComponent(study.evidenceIds[0]), study, {
    modelStudy: study.id, validationRow: row.id, ...(judgment && { validation: judgment }),
  });
}

export function ValidationObservations({
  study,
  rows,
  basisFor,
  selected,
  toggle,
  judgment,
}: {
  study: ValidationStudy;
  rows: ValidationRow[];
  basisFor?: ReturnType<typeof assessReadings>["basisFor"];
  selected?: ReadonlySet<string>;
  toggle?: (id: string) => void;
  judgment?: string;
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        {judgment
          ? "This judgment cites no independent readings."
          : "No archived observations for this condition."}
      </p>
    );
  return (
    <div className="grid min-w-0 gap-3">
      <ResidualPlot rows={judgment ? rows : rows.filter(row => basisFor?.(row) === "Independent")} unit={study.unit} historical={Boolean(judgment)} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs max-sm:block">
          <caption className="sr-only">
            {study.quantity} in {study.unit}, with source provenance and selection
          </caption>
          <thead className="max-sm:sr-only">
            <tr className="text-muted-foreground">
              <th scope="col" className="min-w-36 p-1.5">
                Archived reading
              </th>
              {Object.keys(measurements).map(label => (
                <th key={label} scope="col" className="p-1.5">{label}</th>
              ))}
              <th scope="col" className="min-w-24 p-1.5">
                Review basis
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.map((row) => {
              const included = Boolean(judgment || selected?.has(row.id));
              const href = sourceHref(study, row, judgment);
              return (
                <tr key={row.id} className="border-t align-top max-sm:grid max-sm:grid-cols-3 max-sm:py-1">
                  <th scope="row" className="p-1.5 font-normal max-sm:col-span-2">
                    <strong>{row.runId}</strong>
                    <span className="block text-muted-foreground">
                      Origin · {row.originId ?? "Unavailable"}
                    </span>
                    {href ? (
                      <ConnectionLink connection={{ href, label: row.source, location: "Verification", identity: `${row.runId} · ${study.serial} · ${study.modelEditionId}` }}
                        sourceId={study.recordId} returnParams={{ modelStudy: study.id, modelCondition: row.conditionId }} />
                    ) : (
                      <span className="block">{row.source}</span>
                    )}
                    {row.copiedFrom && (
                      <span className="block text-muted-foreground">Copy of {row.copiedFrom}</span>
                    )}
                  </th>
                  {Object.entries(measurements).map(([label, key]) => (
                    <td key={label} className="p-1.5 tabular-nums">
                      <span aria-hidden="true" className="block text-muted-foreground sm:hidden">
                        {label}
                      </span>
                      {numberLabel(key === "residual" ? residual(row) : row[key], key === "residual")}
                    </td>
                  ))}
                  <td className="p-1.5 max-sm:col-start-3 max-sm:row-start-1 max-sm:text-right">
                    {basisFor?.(row) === "Independent" && toggle ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={included ? "secondary" : "outline"}
                        aria-pressed={included}
                        aria-label={`Include ${row.runId}`}
                        onClick={() => toggle(row.id)}
                      >
                        {included ? "Included" : "Include"}
                      </Button>
                    ) : included ? (
                      "Reviewed"
                    ) : (
                      basisFor?.(row)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
