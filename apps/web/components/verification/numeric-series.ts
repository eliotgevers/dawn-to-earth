import { dashboardUrl, hex, matchesTrace, traceEdition } from "@/lib/evidence/traces";
import type { RecordUnit } from "@/lib/records/journal";
import type { VerificationRecords, VerificationTest } from "./model";

export type RecordedSeries = {
  editionId: string;
  source: string;
  quantity: string;
  unit: string;
  points: { id: string; elapsedMs: number; value: number; locator: string }[];
};
export type IndexedSeries = {
  edition: string;
  points: [id: string, position: number, elapsedMs: number, value: number][];
};

export async function measurementEdition(
  method: VerificationTest,
  recordId: string,
  unit: RecordUnit,
  series: RecordedSeries,
) {
  const bytes = new DataView(new ArrayBuffer(8));
  const rows = series.points.map((point) => {
    bytes.setFloat64(0, point.value);
    return [point.id, point.elapsedMs, hex(bytes.buffer), point.locator];
  });
  return traceEdition(series.editionId, [
    method,
    recordId,
    unit.serial,
    unit.revisionId,
    series.editionId,
    series.source,
    series.quantity,
    series.unit,
    rows,
  ]);
}

export function measurementUrl(
  series: RecordedSeries,
  edition: string,
  result: IndexedSeries | undefined,
  grafanaBase: string,
  first: number,
  last: number,
) {
  if (result?.edition !== edition || !matchesTrace(
    series.points.map((point, i) => [point.id, i + 1, point.elapsedMs, point.value]), result.points,
  )) return;
  if (first > last || !series.points.some(p => p.elapsedMs === first) || !series.points.some(p => p.elapsedMs === last)) return;
  return dashboardUrl(grafanaBase, "dte-recorded-series/recorded-bench-readings", edition, first, last + 1);
}


// PP14-A and PP14-D predate per-record series. Each archive's identity selects
// its own stored clock and normalized readings; the review and its source stay unchanged.
export function proofArchiveRecords(verification: VerificationRecords): VerificationRecords["records"] {
  const records = verification.records;
  if (verification.article.serial !== "LK-014" || verification.article.revisionId !== "bench-a") return records;
  const pressure = records.pressure.map(record => {
    if (
      record.numericSeries?.length || record.unit?.serial !== "LK-014" || record.unit.revisionId !== "bench-a" ||
      record.content !== "capture" || !record.source
    ) return record;
    let archive;
    if (
      record.id === "proof-pressure-original" && record.source === "Original trace archive · PP14-A" &&
      record.capture?.reviewId === "EVD-PP-01" && !record.capture.replaces
    ) {
      archive = { id: "pp14-a", readings: verification.proofPressureFixture?.points };
    } else if (
      record.id === "proof-pressure-retest" && record.source === "Replacement trace archive · PP14-D" &&
      record.capture?.reviewId === "EVD-PP-02" && record.capture.replaces === "proof-pressure-original"
    ) {
      archive = { id: "pp14-d", readings: verification.proofPressureRetestFixture?.points };
    }
    if (!archive?.readings?.length) return record;
    const points: RecordedSeries["points"] = [];
    for (const [index, reading] of archive.readings.entries()) {
      const elapsedMs = reading?.elapsedSeconds * 1000;
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || !Number.isFinite(reading?.value) ||
          (index > 0 && elapsedMs <= points[index - 1].elapsedMs)) return record;
      points.push({
        id: `row-${index + 1}`, elapsedMs, value: reading.value,
        locator: `${record.source} / row ${index + 1} at ${reading.elapsedSeconds} s`,
      });
    }
    const series = { editionId: archive.id + "-normalized-readback",
      quantity: "Archived normalized readout", unit: "% of reference", source: record.source, points };
    return { ...record, numericSeries: [series] };
  });
  return { ...records, pressure };
}
