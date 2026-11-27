import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AcceptanceCheck } from "./acceptance";

export type Comparison = NonNullable<AcceptanceCheck["comparison"]>;
export type FrameRange = { first: number; last: number };

export function FrameComparison({
  comparison, first, last, onChange, initialFrame = first,
}: FrameRange & {
  comparison: Comparison;
  initialFrame?: number;
  onChange?: (range: FrameRange) => void;
}) {
  const [position, setPosition] = useState(initialFrame);
  const [playing, setPlaying] = useState(false);
  const anchor = useRef<number | null>(null);
  const frame = comparison.frames[position - 1];
  const min = onChange ? 1 : first;
  const max = onChange ? comparison.frames.length : last;
  const advancing = playing && position < last;

  useEffect(() => {
    if (!advancing) return;
    const timer = window.setTimeout(() => setPosition(p => Math.min(last, p + 1)), 650);
    return () => window.clearTimeout(timer);
  }, [advancing, last, position]);

  function inspect(index: number) {
    setPlaying(false);
    setPosition(index);
  }

  function chooseRange(index: number, range: FrameRange) {
    inspect(index);
    onChange?.(range);
  }

  if (!frame) return <p>Frame unavailable.</p>;

  return <div className="grid min-w-0 gap-3">
    <div className="grid grid-cols-2 gap-2">
      {([
        ["Original", comparison.run, frame.originalImage, frame.original],
        ["Rerun", comparison.rerun, frame.repeatImage, frame.repeat],
      ] as const).map(([label, run, src, visible]) => (
        <figure key={label} className="min-w-0">
          <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
            <strong className="text-sm">{label}</strong>
            <span className="text-xs text-muted-foreground">Label {visible ? "visible" : "missing"}</span>
          </figcaption>
          {src ? <Image unoptimized src={src} width={576} height={336}
            className="aspect-[12/7] max-h-64 w-full rounded-md border bg-muted/30 object-contain"
            alt={`${run}, frame ${position}. Source label ${visible ? "visible" : "missing"}.`} />
            : <p>Image unavailable</p>}
        </figure>
      ))}
    </div>
    <div className="flex min-w-0 items-center gap-2">
      {last > first && <Button type="button" size="icon-sm" variant="outline" className="bg-popover"
        aria-label={advancing ? "Pause playback" : "Play both runs"}
        onClick={() => {
          anchor.current = null;
          if (position < first || position >= last) setPosition(first);
          setPlaying(!advancing);
        }}>
        {advancing ? <Pause /> : <Play />}
      </Button>}
      {max > min && <input type="range" aria-label="Comparison frame" min={min} max={max} value={position}
        className="h-8 min-w-0 flex-1 accent-foreground"
        aria-valuetext={`Frame ${position} of ${comparison.frames.length}`}
        onChange={event => { anchor.current = null; inspect(Number(event.target.value)); }}
        onKeyDown={event => {
          if (!onChange || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
          event.preventDefault();
          anchor.current ??= position;
          const next = Math.max(min, Math.min(max, position + (event.key === "ArrowRight" ? 1 : -1)));
          chooseRange(next, { first: Math.min(next, anchor.current), last: Math.max(next, anchor.current) });
        }} />}
      <span className="text-xs tabular-nums">Frame {position} of {comparison.frames.length}</span>
    </div>
    {onChange && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
      {(["first", "last"] as const).map(edge => <label key={edge} className="flex items-center gap-1">
        {edge === "first" ? "First frame" : "Last frame"}
        <select aria-label={edge === "first" ? "First frame" : "Last frame"} className="min-h-8 rounded-md border bg-popover px-1.5 text-sm" value={edge === "first" ? first : last}
          onChange={event => {
            const value = Number(event.target.value);
            anchor.current = null;
            chooseRange(value, edge === "first"
              ? { first: value, last: Math.max(value, last) }
              : { first: Math.min(first, value), last: value });
          }}>
          {comparison.frames.map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>)}
    </div>}
  </div>;
}
