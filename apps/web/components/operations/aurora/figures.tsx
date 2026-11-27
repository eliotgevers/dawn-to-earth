import Image from "next/image";
import { events, type AlignedFrame, visibleCount, type EventId, type PayloadPair } from "@/lib/archives/aurora";

const series = {
  returned: "text-teal-700 dark:text-teal-300",
  reference: "text-indigo-600 dark:text-indigo-300",
};

export function FramePlate({ pair, sample, title, source, frame }: {
  pair: PayloadPair; sample: string | null | undefined; title: "Returned" | "Reference"; source: string; frame: number;
}) {
  const corners = pair.glyphs.length === 4;
  const marks = sample?.replaceAll(".", "");
  const status = sample === null ? "Frame missing" : sample === undefined ? "Outside archive"
    : marks ? marks.split("").join(" · ") : "No marks legible";
  return <figure className="@container min-w-0">
    <figcaption className="mb-1.5 grid gap-y-0.5 text-sm @xs:flex @xs:items-baseline @xs:justify-between @xs:gap-x-2">
      <strong className="inline-flex items-center gap-2">
        <span aria-hidden className={`size-2 rounded-full bg-current ${series[title === "Returned" ? "returned" : "reference"]}`}/>
        {title}
      </strong>
      <span className="font-mono text-[11px] text-muted-foreground">{source}</span>
    </figcaption>
    <div role="img" aria-label={`${title} ${source}. ${sample === undefined ? "No aligned frame" : "Frame " + frame}. ${status}.`}
      className="relative isolate aspect-[2/1] overflow-hidden rounded-md bg-muted">
      {sample == null
        ? <div className="absolute inset-0 grid place-items-center border border-dashed border-border text-center text-xs text-muted-foreground">{status}</div>
        : <>
          <Image src="/study-media/camera-card.webp" alt="" aria-hidden fill unoptimized sizes="(max-width: 600px) 45vw, 500px"
            className="object-cover" />
          <div aria-hidden className={corners
            ? "absolute inset-x-[15%] inset-y-[18%] grid grid-cols-2 content-between justify-between"
            : "absolute inset-x-[12%] top-1/2 flex -translate-y-1/2 items-center justify-between"}>
            {Array.from(pair.glyphs, (glyph, index) => <span key={glyph} className={corners
              ? "font-mono text-[clamp(0.85rem,4cqw,1.75rem)] font-extrabold text-stone-800 even:justify-self-end"
              : "font-mono text-[clamp(0.85rem,6cqw,2rem)] font-bold text-stone-800"}>
              {sample[index] === "." ? "" : sample[index]}
            </span>)}
          </div>
        </>}
    </div>
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs tabular-nums text-muted-foreground">
      <span>{sample === undefined ? "No aligned frame" : `Frame ${frame}`}</span>
      {sample != null && <span>{visibleCount(sample)} / {pair.glyphs.length} {corners ? "marks" : "letters"}</span>}
    </div>
  </figure>;
}

export function ComparisonTrace({ pair, rows, event, frame, first, last, lower, upper, valueText, onInspect }: {
  pair: PayloadPair; rows: AlignedFrame[]; event: EventId; frame: number; first: number; last: number; lower: number; upper: number; valueText: string; onInspect: (frame: number) => void;
}) {
  const step = 92 / Math.max(1,rows.length-1);
  const x = (n: number) => `${4 + step * (n-1)}%`;
  const hasMissing = rows.some(row => row.returned === null || row.reference === null);
  const hasOutside = rows.some(row => row.reference === undefined);
  const y = (sample: string) => `${71 - 42 * visibleCount(sample)/pair.glyphs.length}%`;
  return <figure aria-label="Aligned observations" className="grid min-w-0 gap-1.5">
    <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
      <strong className="font-medium">{pair.metric}</strong>
      <span className="flex flex-wrap gap-x-3 text-muted-foreground">
        {hasMissing && <span>× Missing image</span>}
        {hasOutside && <span>– Outside recording</span>}
      </span>
    </figcaption>
    <div className="relative rounded-sm border-y bg-muted/30 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <svg role="img" aria-label="Mark counts by returned frame number. Crosses mark missing images. Dashes fall outside the recording." className="block h-22 w-full">
        <rect x={x(first - .32)} width={`${step*(last-first+.64)}%`} y="5%" height="77%" className="fill-primary/8"/>
        {[0, .5, 1].map(fraction => <g key={fraction}>
          <line x1="4%" x2="96%" y1={`${71-fraction*42}%`} y2={`${71-fraction*42}%`} className="stroke-border" strokeDasharray="2 4"/>
          <text x="2%" y={`${71-fraction*42}%`} dy=".32em" fontSize="10" textAnchor="middle" className="fill-muted-foreground">{pair.glyphs.length*fraction}</text>
        </g>)}
        <line x1={x(pair.reviewed.events[event])} x2={x(pair.reviewed.events[event])} y1="7%" y2="80%" className="stroke-muted-foreground" strokeDasharray="3 4"/>
        {(["reference","returned"] as const).map(side => <g key={side} className={series[side]} stroke="currentColor">
          {rows.map((row, i) => {
            const sample = row[side];
            const previous = rows[i-1]?.[side];
            if (sample == null) return <text key={row.frame} x={x(row.frame)} y={side === "returned" ? "19%" : "34%"} fill="currentColor" stroke="none" fontSize="13" textAnchor="middle">{sample === null ? "×" : "–"}</text>;
            return <g key={row.frame}>
              {previous != null && <line x1={x(row.frame-1)} y1={y(previous)} x2={x(row.frame)} y2={y(sample)} strokeWidth={side === "returned" ? 1.8 : 2.5} strokeDasharray={side === "reference" ? "4 3" : undefined}/>}
              <circle cx={x(row.frame)} cy={y(sample)} r={side === "reference" ? 4.5 : 2} fill={side === "reference" ? "none" : "currentColor"}/>
            </g>;
          })}
        </g>)}
        <line x1={x(frame)} x2={x(frame)} y1="5%" y2="80%" className="stroke-foreground" strokeWidth="1.25"/>
        {rows.filter(row => row.frame === 1 || row.frame === rows.length || row.frame%3===0 && row.frame<rows.length-1).map(row =>
          <text key={row.frame} x={x(row.frame)} y="94%" textAnchor="middle" fontSize="10" className="fill-muted-foreground">{row.frame}</text>)}
      </svg>
      {lower<upper && <input type="range" min={lower} max={upper} value={frame} aria-label="Inspect trace frame" aria-valuetext={valueText}
        onChange={e=>onInspect(Number(e.target.value))} className="absolute inset-y-0 h-full cursor-crosshair touch-pan-y opacity-0"
        style={{left:x(lower),width:`${step*(upper-lower)}%`}}/>}
    </div>
    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
      {(Object.keys(events) as EventId[]).map(key => {
        const target = pair.reviewed.events[key];
        const label = `${events[key]} · ${target}`;
        return target >= lower && target <= upper
          ? <button key={key} type="button" onClick={() => onInspect(target)} aria-label={`Inspect ${events[key].toLowerCase()} at frame ${target}`}
              className="rounded-sm py-0.5 hover:text-foreground hover:underline">{label}</button>
          : <span key={key}>{label}</span>;
      })}
    </div>
  </figure>;
}
