import type { RecordedSeries } from "@/components/verification/numeric-series";
import { isObject } from "@/db/workflows/cases";

const channels = new Map([
  ["indicator_percent", { quantity: "Indicator brightness", unit: "%", max: 100 }],
  ["display_count", { quantity: "Display count", unit: "count", max: 9999 }],
]);
const printable = /^[^\p{Cc}\p{Cf}]{1,120}$/u;
const headerError = "Include a title, serial, revisionId and an indicator_percent or display_count channel.";

type Run = { title: string; serial: string; revisionId: string; series: RecordedSeries };

export function parseRun({ fileName, file }: Record<string, unknown>): Run | { error: string; status: 400 } {
  if (
    typeof fileName !== "string" || !printable.test(fileName) || /[/\\]/.test(fileName) ||
    !fileName.endsWith(".json") || typeof file !== "string" || new TextEncoder().encode(file).byteLength > 32_768
  ) {
    return { error: "Choose a JSON file of 32 KB or less.", status: 400 };
  }

  let data: unknown;
  try {
    data = JSON.parse(file);
  } catch {
    return { error: "The file is not valid JSON.", status: 400 };
  }
  if (!isObject(data)) return { error: headerError, status: 400 };

  const { title, serial, revisionId, samples } = data;
  const channel = typeof data.channel === "string" ? channels.get(data.channel) : undefined;
  if (
    typeof title !== "string" || !title.trim() || !printable.test(title) ||
    typeof serial !== "string" || typeof revisionId !== "string" || !channel
  ) {
    return { error: headerError, status: 400 };
  }
  if (Object.keys(data).some(key => !["title", "serial", "revisionId", "channel", "samples"].includes(key))) {
    return { error: "The file has an unsupported field. Use the same fields as the example.", status: 400 };
  }
  if (!Array.isArray(samples) || !samples.length || samples.length > 256) {
    return { error: "Include between 1 and 256 elapsed-time and reading pairs.", status: 400 };
  }

  const points: RecordedSeries["points"] = [];
  for (const [index, pair] of samples.entries()) {
    const row = index + 1;
    if (!Array.isArray(pair) || pair.length !== 2) {
      return { error: `Sample ${row} must contain elapsed milliseconds and a reading.`, status: 400 };
    }
    const [elapsedMs, value] = pair;
    // The archived dashboard displays one day of elapsed time.
    const previousMs = points.at(-1)?.elapsedMs ?? -1;
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= previousMs || elapsedMs >= 86_400_000) {
      return { error: `Sample ${row} needs a strictly increasing whole-millisecond time within one day.`, status: 400 };
    }
    if (!Number.isFinite(value) || value < 0 || value > channel.max || (data.channel === "display_count" && !Number.isInteger(value))) {
      return { error: `Sample ${row} needs a valid ${channel.quantity.toLowerCase()} reading between 0 and ${channel.max}.`, status: 400 };
    }
    points.push({ id: `row-${row}`, elapsedMs, value, locator: `${fileName} / sample ${row}` });
  }

  const series: RecordedSeries = {
    editionId: "bench-run",
    source: fileName,
    quantity: channel.quantity,
    unit: channel.unit,
    points,
  };

  return { series, title: title.trim(), serial, revisionId };
}
