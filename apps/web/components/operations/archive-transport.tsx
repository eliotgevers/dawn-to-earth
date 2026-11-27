"use client";

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type FrameState = "match" | "difference" | "unavailable";
const segmentColor: Record<FrameState, string> = {
  match: "bg-teal-600 dark:bg-teal-400",
  difference: "bg-amber-500 dark:bg-amber-400",
  unavailable: "border-y border-dashed border-muted-foreground bg-muted",
};

// Both tracks advance by archived frame, independent of either instrument's actual sampling rate.
export function useFramePlayer(first: number, last: number, initial: number, onSeek: (frame: number) => void) {
  const [frame, setFrame] = useState(() => Math.min(last, Math.max(first, initial)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rememberPosition = useEffectEvent(onSeek);
  const pauseHidden = useEffectEvent(() => {
    if (document.hidden && playing) {
      setPlaying(false);
      rememberPosition(frame);
    }
  });
  useEffect(() => {
    document.addEventListener("visibilitychange", pauseHidden);
    return () => document.removeEventListener("visibilitychange", pauseHidden);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(last, frame + 1);
      setFrame(next);
      if (next === last) {
        setPlaying(false);
        rememberPosition(next);
      }
    }, 650 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, frame, last, speed]);

  function seek(position: number) {
    const clamped = Math.min(last, Math.max(first, position));
    setPlaying(false);
    setFrame(clamped);
    onSeek(clamped);
  }
  function toggle() {
    if (first === last) return;
    if (playing) seek(frame);
    else {
      if (frame === last) setFrame(first);
      setPlaying(true);
    }
  }
  return { first, last, frame, playing, speed, setSpeed, seek, toggle, pause: () => seek(frame) };
}

type Player = ReturnType<typeof useFramePlayer>;

export function ArchiveTransport({ player, timeline, rangeLabel, playbackLabel, description, action, interval }: {
  player: Player;
  timeline: FrameState[];
  rangeLabel: string;
  playbackLabel: string;
  description: string;
  action?: ReactNode;
  interval?: {first: number; last: number};
}) {
  const {frame, first, last, playing, speed, seek, toggle} = player;
  const fixed = first === last;
  const buttonClass = "size-10 shrink-0 sm:size-8";
  const playLabel = playing ? "Pause " + playbackLabel : "Play " + playbackLabel;
  return <div role="group" aria-label="Replay controls" className="min-w-0 border-y border-border bg-muted/25 px-2.5 pb-1.5 sm:px-4">
    <div className="relative flex h-10 items-center sm:h-8">
      <div aria-hidden className="pointer-events-none absolute inset-x-2 flex h-1 gap-px overflow-hidden rounded-xs">
        {timeline.slice(first - 1, last).map((state, index) => <span key={index} className={segmentColor[state]}
          style={{ flex: index === 0 || index === last - first ? .5 : 1 }}/>)}
      </div>
      <input type="range" min={first} max={last} value={frame} disabled={fixed}
        aria-label={rangeLabel} aria-valuetext={`Frame ${frame} of ${timeline.length}. ${description}`}
        onChange={e => seek(e.currentTarget.valueAsNumber)}
        onPointerDown={player.pause}
        onKeyDown={e => {
          if (e.key === " ") { e.preventDefault(); toggle(); }
        }}
        className="relative h-10 w-full cursor-pointer appearance-none rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground"/>
    </div>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
      <div className="flex min-w-0 flex-wrap items-center">
        <Button type="button" size="icon-sm" variant="ghost" className={buttonClass} aria-label="Previous frame" title="Previous frame" disabled={frame <= first} onClick={() => seek(frame - 1)}>
          <ChevronLeft aria-hidden/>
        </Button>
        <Button type="button" size="icon-sm" variant="secondary" className={buttonClass} aria-label={playLabel}
          title={frame === last && !fixed ? "Replay from start" : playLabel} disabled={fixed} onClick={toggle}>
          {playing ? <Pause aria-hidden/> : frame === last && !fixed ? <RotateCcw aria-hidden/> : <Play aria-hidden/>}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" className={buttonClass} aria-label="Next frame" title="Next frame" disabled={frame >= last} onClick={() => seek(frame + 1)}>
          <ChevronRight aria-hidden/>
        </Button>
        <span className="ml-1 whitespace-nowrap font-mono text-xs text-muted-foreground">
          <span className="text-foreground">{frame}</span> / {timeline.length}
        </span>
        {!fixed && <select aria-label="Playback speed" title="Playback speed" value={speed}
          onChange={e => player.setSpeed(Number(e.target.value))}
          className="ml-1.5 h-9 cursor-pointer rounded-sm bg-transparent pl-1 font-mono text-xs focus-visible:outline-ring">
          {[.5,1,2].map(rate => <option value={rate} key={rate}>{rate}×</option>)}
        </select>}
      </div>
      {action}
    </div>
    {interval && (interval.first !== interval.last || fixed) && <p className="mt-1 text-xs text-muted-foreground">
      Marked {interval.first === interval.last ? `frame ${interval.first}` : `frames ${interval.first}–${interval.last}`}
    </p>}
  </div>;
}
