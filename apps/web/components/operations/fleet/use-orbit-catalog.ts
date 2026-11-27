"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogEvent, Scope } from "./orbit-worker";
import type { CatalogIndex } from "@/lib/orbital-catalog";
import { previewWindow, viewTime, type FleetClock, type OrbitFrame } from "@/lib/orbital-estimates";

function newClock(): FleetClock {
  const now = Date.now();
  return { at: now, started: now, playing: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    speed: 1, end: null };
}

export function useOrbitCatalog(owners: string, selected: number | null) {
  const worker = useRef<Worker | null>(null);
  const [snapshot, setSnapshot] = useState<CatalogIndex | null>(null);
  const [result, setResult] = useState<({ frame: OrbitFrame } & Scope) | null>(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<FleetClock | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const instance = new Worker(new URL("./orbit-worker.ts", import.meta.url), { type: "module" });
    worker.current = instance;
    instance.onmessage = ({ data }: MessageEvent<CatalogEvent>) => {
      if ("frame" in data) setResult(data);
      else if ("index" in data) { setSnapshot(data.index); setClock(current => current ?? newClock()); setError(""); }
      else setError(data.error);
    };
    instance.onerror = () => setError("Fleet position estimates unavailable.");
    instance.postMessage({ load: true });
    return () => { worker.current = null; instance.terminate(); };
  }, [reload]);

  useEffect(() => {
    if (!clock) return;
    const update = () => {
      if (document.hidden) return;
      const now = Date.now(), at = viewTime(clock, now);
      worker.current?.postMessage({ at, owners, selected });
      if (clock.playing && at === clock.end) setClock(current => current === clock ? { ...current, at, started: now, playing: false } : current);
    };
    update();
    if (!clock.playing) return;
    const interval = setInterval(update, clock.speed === 1 ? 1000 : 250);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [clock, owners, selected]);

  function adjust(speed: number, playing: boolean) {
    if (!clock) return;
    const now = Date.now(), at = viewTime(clock, now);
    setClock({ at, started: now, speed, playing, end: clock.end ?? (speed > 1 ? at + previewWindow : null) });
  }
  const frame = result?.owners === owners && result.selected === selected ? result.frame : null;
  return { snapshot, frame, clock, error,
    retry: () => setReload(count => count + 1),
    toggle: () => { if (clock) adjust(clock.speed, !clock.playing); },
    speed: (value: number) => { if (clock && [1, 10, 60].includes(value)) adjust(value, clock.playing); },
    reset: () => setClock(newClock()) };
}
