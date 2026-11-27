"use client";

import { ArrowLeft, Calculator, ChevronRight, CloudSun, Compass, ExternalLink, Orbit, Ruler, Telescope, Wind } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

import { categories, type AeroViaTool } from "./tool-directory";

const categoryIcons = { Aerodynamics: Wind, "Atmospheric & Flight": CloudSun, Navigation: Compass, "Orbital Mechanics": Orbit,
  Structures: Ruler, Astronomy: Telescope, "General Utilities": Calculator };

export function ToolsPanel({ tool, onSelect }: { tool: AeroViaTool | null; onSelect: (tool: AeroViaTool | null) => void }) {
  const { resolvedTheme } = useTheme();
  const directory = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const previous = useRef(tool);

  useEffect(() => {
    if (tool !== previous.current) {
      if (tool) back.current?.focus();
      else directory.current?.querySelector<HTMLButtonElement>(`[data-tool="${previous.current?.slug}"]`)?.focus();
      previous.current = tool;
    }
  }, [tool]);

  if (!tool) return (
    <div ref={directory} className="min-h-0 overflow-y-auto overscroll-contain px-[15px] py-3">
      {categories.map(({ name, tools }) => {
        const Icon = categoryIcons[name];
        return <section key={name} aria-label={name} className="mb-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Icon size={15} aria-hidden="true" />{name}</h3>
        {tools.map(entry => <Button key={entry.slug} data-tool={entry.slug} variant="ghost" onClick={() => onSelect(entry)}
          className="flex h-auto min-h-8 w-full justify-between px-2 py-1 text-start font-normal whitespace-normal">
          {entry.name}<ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>)}
      </section>; })}
      <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
        <a className="underline underline-offset-2" href="https://www.eliotgevers.com/" target="_blank" rel="noreferrer">Eliot Gevers</a>
        {" also built "}<a className="underline underline-offset-2" href="https://www.aerovia.org/" target="_blank" rel="noreferrer">AeroVia</a>.
        These demo embeds show how external tools can complement internal workflows.
      </p>
    </div>
  );

  const url = `https://www.aerovia.org/tools/${tool.slug}`;
  return <>
    <div className="grid shrink-0 grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-1 border-b px-2 py-2">
      <Button ref={back} size="sm" variant="ghost" className="justify-self-start px-1.5" aria-label="Back to tools" title="Back to tools" onClick={() => onSelect(null)}>
        <ArrowLeft data-icon="inline-start" aria-hidden="true" />Back
      </Button>
      <h3 className="min-w-0 text-center text-sm leading-snug font-semibold">{tool.name}</h3>
      <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${tool.name} in AeroVia (opens in a new tab)`}
        title="Open in AeroVia" className="inline-flex size-7 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-ring">
        <ExternalLink aria-hidden="true" size={15} />
      </a>
    </div>
    {(resolvedTheme === "light" || resolvedTheme === "dark") && <iframe key={resolvedTheme}
      src={`${url}?embed&theme=${resolvedTheme}`} title={`AeroVia · ${tool.name}`} referrerPolicy="no-referrer"
      className="min-h-0 w-full flex-1 border-0" />}
  </>;
}
