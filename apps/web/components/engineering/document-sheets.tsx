"use client";

import { TableColumns } from "@/components/records/table";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LabeledSelect } from "@/components/records/forms";
import type { DesignEdition } from "@/db/engineering/design";

import { sameRegistration, type DocumentField as Field } from "./document-differences";

function fieldValue(field: Field, side: "before" | "after") {
  const value = field[side];
  if (value === undefined) return side === "before" ? "Field added in compared edition" : "Field removed in compared edition";
  return value || "Unavailable";
}

type View = "Paired sheets" | "Overlay";

function sheetImage(edition: DesignEdition) {
  const figure = edition.figure;
  return figure && figure.src.startsWith("/") && !figure.src.startsWith("//") ? figure : null;
}

function MarkedSheet({ edition, overlay, opacity, layer = "compared", fields, selected, choose }: {
  edition: DesignEdition; overlay?: DesignEdition; opacity?: number; layer?: "earlier" | "compared";
  fields: Field[]; selected: string; choose?: (key: string) => void;
}) {
  const base = sheetImage(edition);
  if (!base) return null;
  const top = overlay && sheetImage(overlay);
  const marked = (layer === "compared" && top) || base;
  const markedLabel = marked === top ? overlay?.label : edition.label;
  const outline = (r: (typeof base.regions)[number], source = marked) => ({
    left: `${100*r.x/source.width}%`, top: `${100*r.y/source.height}%`,
    width: `${100*r.width/source.width}%`, height: `${100*r.height/source.height}%`,
  });
  const other = top && (marked === base ? top : base);
  const otherRegion = other?.regions.find(r => r.fieldKey === selected);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm">
        <strong>{edition.label}</strong>{top && <> / <strong>{overlay?.label}</strong></>}
        <span className="mt-0.5 block wrap-anywhere text-xs text-muted-foreground">{edition.source}</span>
        {top && <span className="block wrap-anywhere text-xs text-muted-foreground">{overlay?.source}</span>}
      </figcaption>
      <div className="relative isolate overflow-hidden rounded-md border bg-white" style={{aspectRatio: `${base.width} / ${base.height}`}}>
        <Image unoptimized src={base.src} width={base.width} height={base.height} alt={base.alt} className="block h-full w-full" />
        {top && <Image unoptimized src={top.src} width={top.width} height={top.height} alt={top.alt}
          className="absolute inset-0 h-full w-full" style={{ opacity: (opacity ?? 50)/100 }} />}
        {otherRegion && <span aria-hidden="true" className="pointer-events-none absolute z-10 rounded-xs border-2 border-dashed border-sky-800" style={outline(otherRegion, other!)} />}
        {marked.regions.map(region => {
          const field = fields.find(f => f.key === region.fieldKey);
          if (!field) return null;
          const active = selected === field.key;
          const border = active ? "ring-2 ring-inset ring-sky-800 bg-sky-700/10" : field.changed ? "border border-dashed border-amber-800" : "";
          const shape = `absolute rounded-xs ${border}`;
          return choose ? <button type="button" aria-pressed={active} key={region.fieldKey}
            aria-label={`Review ${field.label} on ${markedLabel}${top ? " overlay" : ""}`}
            aria-description={field.difference} title={`${field.label} · ${field.difference}`} className={`${shape} cursor-pointer hover:bg-sky-700/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-800`}
            onClick={() => choose(field.key)} style={outline(region)} />
            : <span aria-hidden="true" key={region.fieldKey} className={shape} style={outline(region)} />;
        })}
      </div>
    </figure>
  );
}

export function EditionComparison({ earlier, later, fields, fieldKey, choose }: {
  earlier: DesignEdition; later: DesignEdition; fields: Field[]; fieldKey: string; choose?: (key: string) => void;
}) {
  const [view, setView] = useState<View>("Paired sheets");
  const [opacity, setOpacity] = useState(50);
  const [layer, setLayer] = useState<"earlier" | "compared">("compared");
  const first = sheetImage(earlier);
  const second = sheetImage(later);
  const paired = Boolean(first && second);
  const overlay = sameRegistration(first, second);
  const options: View[] = ["Paired sheets", "Overlay"];
  const selected = fields.find(f => f.key === fieldKey);
  const changed = fields.filter(field => field.changed);
  const index = changed.findIndex(field => field.key === fieldKey);
  function jump(direction: -1 | 1) {
    const start = index < 0 && direction === -1 ? 0 : index;
    choose?.(changed[(start + direction + changed.length) % changed.length].key);
  }
  return (
    <section className="grid min-w-0 gap-3" aria-label="Edition comparison">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{changed.length} of {fields.length} document fields changed</span>
          {choose && changed.length > 0 && (index < 0 || changed.length > 1) && <div role="group" aria-label="Document differences" className="flex gap-1">
            {index >= 0 && changed.length > 1 && <Button size="sm" variant="ghost" onClick={() => jump(-1)}>Previous difference</Button>}
            <Button size="sm" variant="outline" onClick={() => jump(1)}>{index < 0 ? "Inspect difference" : "Next difference"}</Button>
          </div>}
        </div>
        {overlay && <div role="group" aria-label="Comparison view" className="flex gap-1">
          {options.map(v => <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"}
            aria-pressed={view === v} onClick={() => setView(v)}>{v}</Button>)}
        </div>}
      </div>
      {view === "Overlay" && overlay ? <>
        <MarkedSheet edition={earlier} overlay={later} layer={layer} opacity={opacity} fields={fields} selected={fieldKey} choose={choose} />
        <div className="grid gap-3 sm:grid-cols-2">
        <LabeledSelect label="Inspect regions on" value={layer} onChange={value => value && setLayer(value)}
          options={[{value:"earlier", label:earlier.label}, {value:"compared", label:later.label}]} />
        <label className="grid content-center gap-1 text-xs font-medium">
          Compared edition opacity · {opacity}%
          <input aria-label="Compared edition opacity" type="range" min="0" max="100" step="5" value={opacity}
            onChange={event => setOpacity(Number(event.target.value))} className="w-full accent-foreground" />
        </label>
        </div>
        {selected && <p className="text-xs text-muted-foreground">The solid outline marks the inspected edition. The dashed outline locates the same field in the other edition when present.</p>}
      </> : <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {[earlier, later].map(edition => sheetImage(edition)
          ? <MarkedSheet key={edition.id} edition={edition} fields={fields} selected={fieldKey} choose={choose} />
          : <p key={edition.id} className="text-sm"><strong>{edition.label}</strong><br />{edition.source}</p>)}
      </div>}
      {selected && <FieldComparison field={selected} />}
      <details open={!paired || undefined}>
        <summary className="w-fit cursor-pointer text-sm font-medium">Field comparison</summary>
        <table className="mt-2 w-full table-fixed text-left text-xs">
          <TableColumns
            caption="Earlier and compared document fields"
            labels={["Field", earlier.label, later.label]}
          />
          <tbody>{fields.map(field => <tr key={field.key} className="border-t align-top">
            <th scope="row" className="wrap-anywhere py-2 pr-2">{field.label}<span className="mt-1 block text-xs font-normal text-muted-foreground">{field.difference}</span></th>
            <td className="wrap-anywhere py-2 pr-2">{fieldValue(field, "before")}</td>
            <td className="wrap-anywhere py-2">{fieldValue(field, "after")}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}


function FieldComparison({ field }: { field: Field }) {
  const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
  const sides = [
    { key: "before", label: "Earlier", box: field.earlierBox },
    { key: "after", label: "Compared", box: field.comparedBox },
  ] as const;
  return (
    <section aria-label={field.label} aria-live="polite" className="grid gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap justify-between gap-x-2"><strong>{field.label}</strong>
        <span className="text-xs text-muted-foreground">{field.difference}</span></div>
      {field.positionNote && <p className="text-xs text-muted-foreground">{field.positionNote}</p>}
      <dl className="grid gap-2 sm:grid-cols-2">
        {sides.map(({ key, label, box }) => <div key={key}><dt className="text-xs text-muted-foreground">{label} edition</dt>
          <dd>{fieldValue(field, key)}</dd>
          {box && <dd className="mt-1 text-xs text-muted-foreground">
            Left {percent(box.x)} · Top {percent(box.y)} · Size {percent(box.width)} × {percent(box.height)}
          </dd>}
        </div>)}
      </dl>
    </section>
  );
}
