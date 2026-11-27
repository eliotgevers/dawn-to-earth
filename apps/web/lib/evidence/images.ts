// All coordinates refer to the archived caption, divided into eight columns and four rows.
export type Box = [x: number, y: number, width: number, height: number];
export type ImageFrame = {
  image: string;
  sha256: string;
  width: number;
  height: number;
  caption: Box;
  tiles: [pixels: number, sum: number, sumSquares: number][];
};
export type InspectionRun = {
  id: string;
  checkId: string;
  archiveId: string;
  serial: string;
  revisionId: string;
  title: string;
  marker: number;
  frameLayout: string;
  frames: ImageFrame[];
};
export const runLabels = ["Source", "Comparison", "Control"] as const;
export type RunEdition = InspectionRun & { digest: string };
export type Alignment = "marker" | "start";
export type AnalysisSetup = {
  channel: ImageChannel;
  alignment: Alignment;
  shift: number;
  region: Box;
  first: number;
  last: number;
};
export type FrameMeasure = { frame: number; mean: number; contrast: number };

export function validRegion(value: unknown): value is Box {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isInteger)) return false;
  const [x, y, w, h] = value;

  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 8 && y + h <= 4;
}

// Combine pixel moments, not the standard deviations of individual tiles.
export function measureFrame(run: InspectionRun, index: number, region: Box): FrameMeasure | undefined {
  const frame = run.frames[index - 1];
  if (!frame) return;
  const [x, y, w, h] = region;
  let n = 0,
    sum = 0,
    squares = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const tile = frame.tiles[row * 8 + col];
      n += tile[0];
      sum += tile[1];
      squares += tile[2];
    }
  }

  const mean = sum / n;

  return { frame: index, mean, contrast: Math.sqrt(Math.max(0, squares / n - mean * mean)) };
}

export function alignedSamples(
  source: InspectionRun,
  comparison: InspectionRun,
  control: InspectionRun | undefined,
  setup: Pick<AnalysisSetup, "alignment" | "shift" | "region">,
  range?: Pick<AnalysisSetup, "first" | "last">,
) {
  const offset = (run: InspectionRun) => (setup.alignment === "marker" ? run.marker - source.marker : 0);

  return source.frames.flatMap((_, index) => {
    const first = index + 1;
    if (range && (first < range.first || first > range.last)) return [];
    const other = measureFrame(comparison, first + offset(comparison) + setup.shift, setup.region);
    const third = control && measureFrame(control, first + offset(control), setup.region);
    if (!other || (control && !third)) return [];

    return [
      { source: measureFrame(source, first, setup.region)!, comparison: other, control: third ?? null },
    ];
  });
}
export type AlignedSample = ReturnType<typeof alignedSamples>[number];

export function pixelBox(frame: ImageFrame, [x, y, w, h]: Box): Box {
  const [left, top, width, height] = frame.caption;
  const l = Math.floor((x * width) / 8),
    t = Math.floor((y * height) / 4);

  return [left + l, top + t, Math.floor(((x + w) * width) / 8) - l, Math.floor(((y + h) * height) / 4) - t];
}

export type ImageChannel = "contrast" | "mean";
export function meanPairedChange(samples: AlignedSample[], metric: ImageChannel) {
  return (
    samples.reduce((total, row) => total + row.comparison[metric] - row.source[metric], 0) / samples.length
  );
}

// Keep the source window and control fixed so neighboring offsets are comparable.
export function alignmentSensitivity(
  source: InspectionRun,
  comparison: InspectionRun,
  control: InspectionRun | undefined,
  setup: AnalysisSetup,
) {
  const count = setup.last - setup.first + 1;

  return [-1, 0, 1].map((offset) => {
    const paired = alignedSamples(source, comparison, control, {
      ...setup,
      shift: setup.shift + offset,
    }, setup);

    return {
      offset,
      count: paired.length,
      change: paired.length === count ? meanPairedChange(paired, setup.channel) : null,
    };
  });
}
