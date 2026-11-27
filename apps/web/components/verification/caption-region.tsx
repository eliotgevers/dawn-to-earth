import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  pixelBox,
  type Box,
  type RunEdition,
  type AlignedSample,
} from "@/lib/evidence/images";
const number = (value: number) => value.toFixed(1);
const whole: Box = [0, 0, 8, 4];
const runName = (run: RunEdition) => run.serial + " · " + run.title;

export function FrameFigure({
  run,
  index,
  region,
  label,
}: {
  run: RunEdition;
  index: number;
  region: Box;
  label: string;
}) {
  const frame = run.frames[index - 1];
  const [x, y, w, h] = pixelBox(frame, region);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm">
        <strong>
          {label} · Frame {index}
        </strong>
        <span className="block text-muted-foreground">{runName(run)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        role="img"
        aria-label={`${label}, frame ${index}. Selected caption area at ${x}, ${y}, ${w} by ${h} pixels.`}
        className="block w-full rounded border bg-muted"
      >
        <image href={frame.image} width={frame.width} height={frame.height} />
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#101820"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#fbec75"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

export function CaptionRegion({
  region,
  onChange,
  source,
  comparison,
  sample,
}: {
  region: Box;
  onChange: (value: Box) => void;
  source: RunEdition;
  comparison: RunEdition;
  sample: AlignedSample;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const registered = source.frameLayout === comparison.frameLayout;
  const [left, top, width, height] = region;
  function select(i: number) {
    setFocus(i);
    if (anchor === null) {
      setAnchor(i);
      return;
    }
    const x1 = anchor % 8,
      x2 = i % 8,
      y1 = Math.floor(anchor / 8),
      y2 = Math.floor(i / 8);
    onChange([Math.min(x1, x2), Math.min(y1, y2), Math.abs(x1 - x2) + 1, Math.abs(y1 - y2) + 1]);
    setAnchor(null);
  }
  const original = source.frames[sample.source.frame - 1].tiles;
  const compared = comparison.frames[sample.comparison.frame - 1].tiles;
  const differences = original.map(([pixels, sum], i) => {
    if (!registered) return null;
    const [otherPixels, otherSum] = compared[i];
    return otherSum / otherPixels - sum / pixels;
  });
  const extent = Math.max(0, ...differences.map((value) => Math.abs(value ?? 0)));
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer font-medium">
        Measurement region · {width} × {height} caption tiles
      </summary>
      <p className="my-2 text-sm text-muted-foreground">
        {anchor === null
          ? "Choose opposite corners to measure a region."
          : "Choose the second corner. Escape cancels."}{" "}
        {registered
          ? "Each cell shows the change in mean luma (comparison minus source)."
          : "Different sheet layouts. The grid selects relative caption area only."}
      </p>
      <div
        ref={grid}
        role="group"
        aria-label="Caption region grid"
        className="grid max-w-md grid-cols-8 gap-px"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setAnchor(null);
            return;
          }
          const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[event.key];
          if (!move) return;
          event.preventDefault();
          const next = Math.max(0, Math.min(31, focus + move));
          setFocus(next);
          grid.current?.querySelectorAll("button")[next]?.focus();
        }}
      >
        {differences.map((delta, i) => {
          const x = i % 8,
            y = Math.floor(i / 8);
          const selected = x >= left && x < left + width && y >= top && y < top + height;
          const tint = delta !== null && extent > 0 ? (Math.abs(delta) / extent) * 33 : 0;
          return (
            <button
              key={x + "," + y}
              type="button"
              tabIndex={focus === i ? 0 : -1}
              aria-pressed={selected}
              onClick={() => select(i)}
              style={
                delta === null
                  ? undefined
                  : {
                      backgroundColor: `color-mix(in srgb, ${delta < 0 ? "#5571ba" : "#d09342"} ${tint}%, var(--background))`,
                    }
              }
              aria-label={`Column ${x + 1}, row ${y + 1}${delta === null ? "" : ", change " + number(delta) + " luma levels"}`}
              className={`min-h-8 rounded-sm border text-xs tabular-nums focus-visible:outline-2 ${anchor === i ? "outline-2" : ""} ${selected ? "border-primary bg-muted" : "border-transparent"}`}
            >
              {delta === null
                ? `${x + 1},${y + 1}`
                : Math.round(delta) > 0
                  ? "+" + Math.round(delta)
                  : Math.round(delta)}
            </button>
          );
        })}
      </div>
      {registered && (
        <p className="mt-1 text-xs text-muted-foreground">
          Signed change in Y′ levels · cooler is darker, warmer is brighter · scale ±{number(extent)}
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="mt-1"
        onClick={() => {
          setAnchor(null);
          onChange(whole);
        }}
      >
        Use full caption
      </Button>
    </details>
  );
}
