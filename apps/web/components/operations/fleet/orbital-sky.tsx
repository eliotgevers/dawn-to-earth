"use client";

import { useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { StudyScene } from "@/components/operations/study-scene";
import { createSky, type SkyState } from "./catalog-layer";
import { mapUrl } from "./globe";

export function OrbitalSky({ state, select }: {state: Omit<SkyState,"dark">; select: (id: number) => void}) {
  const { resolvedTheme } = useTheme();
  const [image, setImage] = useState<"loading" | "ready" | "missing">("loading");
  const create = useCallback((redraw: () => void) => createSky(redraw, () => setImage("ready"), () => setImage("missing")), []);
  return <>
    <StudyScene create={create} state={{...state, dark: resolvedTheme === "dark"}} label="Earth and documented Dawn spacecraft"
      onPick={id => {if (/^\d+$/.test(id)) select(Number(id));}} className="absolute inset-0"
      fallback={<div className="grid h-full w-full place-items-center"><img src={mapUrl} alt="Global geographic reference map"
        className="max-h-full max-w-full object-contain opacity-80" onLoad={() => setImage("ready")}/>
        <p className="absolute inset-x-2 top-16 text-center text-xs">3D is unavailable. Choose a spacecraft from the list to inspect its evidence and dated estimate.</p></div>} />
    {image !== "ready" && <p role="status" className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
      {image === "loading" ? "Loading Earth imagery…" : "Earth imagery unavailable"}</p>}
  </>;
}
