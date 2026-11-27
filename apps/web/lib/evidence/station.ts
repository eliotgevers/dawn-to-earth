import type { RecordedSeries } from "@/components/verification/numeric-series";

export const stationRecordings = {
  communication: {
    description: "Read the display counter as four numbered markers appear.",
    names: ["Four-marker replay A", "Four-marker replay B"],
    readings: [[1, 2, 3, 4], [1, 2, 2, 4]],
  },
  leak: {
    description: "Compare the marked spots on a fictional leak indicator card with a blank card in the same four frames.",
    names: ["Paired card replay A", "Paired card replay B"],
    readings: [[1, 1, 2, 1], [1, 2, 3, 1]],
  },
} as const;

export type StationMethod = keyof typeof stationRecordings;
export const stationEdition = 1;

export function captureStation(method: StationMethod, take: 0 | 1) {
  const recording = stationRecordings[method];
  const name = recording.names[take];
  const source = name + " · edition " + stationEdition;
  const observed = recording.readings[take];
  const leak = method === "leak";
  const reference = leak ? [1, 1, 2, 1] : [1, 2, 3, 4];
  const differences = observed.filter((value, i) => leak ? value > reference[i] : value !== reference[i]).length;
  const outcome = differences ? "Fail" : "Pass";
  const observation = leak
    ? (differences ? `Extra indicator marks in ${differences} of 4 frames.` : "Indicator and blank card match in all 4 frames.")
    : (differences ? `The display differs from its numbered marker in ${differences} of 4 frames.` : "The display matches all 4 numbered markers.");

  function trace(editionId: string, quantity: string, values: readonly number[]): RecordedSeries {
    return { editionId, quantity, unit: "count", source, points: values.map((value, i) => ({
      id: "row-" + (i + 1), elapsedMs: i * 100, value, locator: source + " / frame " + (i + 1),
    })) };
  }

  return {
    title: name + " · " + outcome,
    observation: "Simulated " + outcome.toLowerCase() + ". " + observation,
    series: leak ? trace("indicator-marks", "Indicator card marks", observed) : trace("bench-run", "Display count", observed),
    companion: leak ? trace("blank-marks", "Blank card marks", reference) : undefined,
  };
}
