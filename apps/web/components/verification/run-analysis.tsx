"use client";
import { recordLink } from "@/components/records/presentation";

import { useState } from "react";
import { useFindingDraft } from "@/components/records/use-record-submission";
import { useOpenRecord } from "@/components/records/watch-open-record";
import { useRouter } from "next/navigation";
import { AlignedFrames } from "./analysis-trace";
import { AnalysisReport } from "./analysis-report";
import { Button } from "@/components/ui/button";
import { formatUtcDateTime } from "@/lib/utc-time";
import { PersonField, LabeledSelect, NoteField } from "@/components/records/forms";
import { useVerification } from "@/lib/workspace";
import {
  alignedSamples, runLabels,
  type AnalysisSetup,
} from "@/lib/evidence/images";
import type { AnalysisLibrary } from "@/db/verification/inspection";

type Edition = AnalysisLibrary["runs"][number];
const runName = (run: Edition) => run.serial + " · " + run.title;

function SavedStudy({ origin, library }: {
  origin: string;
  library: AnalysisLibrary;
}) {
  const [reading] = library.saved;
  if (!reading) return <p role="alert">The requested analysis is unavailable.</p>;
  const basis = reading.basis;
  const editions = basis.editions.map(({ id, digest }) =>
    library.runs.find((run) => run.id === id && run.digest === digest),
  );

  return (
    <div className="grid min-w-0 gap-3">
      <div>
        <strong>{reading.observation}</strong>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {reading.actor} · {formatUtcDateTime(reading.recordedAt)} · Source frames {basis.first}–{basis.last}
        </p>
        <dl className="mt-2 grid gap-1 text-sm">
          {basis.editions.map((edition, i) => (
            <div key={edition.id}>
              <dt className="inline font-medium">{runLabels[i]} </dt>
              <dd className="inline">{editions[i] ? runName(editions[i]) : edition.id}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {basis.alignment === "marker" ? "First complete identifier" : "First stored frame"} ·
          {" "}Offset {basis.shift} frames · {basis.channel === "mean" ? "Mean luma (Y′)" : "Local contrast (σ Y′)"}
        </p>
      </div>
      {editions.length >= 2 && editions.every(run => run !== undefined) ? (
        <AlignedFrames runs={editions} setup={basis}
          rows={alignedSamples(editions[0], editions[1], editions[2], basis)} />
      ) : <p role="alert">An archived edition is unavailable. The original measurements and observation are retained.</p>}
      <AnalysisReport origin={origin} editions={editions} setup={basis} samples={reading.samples} reading={reading} />
    </div>
  );
}

function MeasurementStudy({ origin, runs, onSaved }: {
  origin: string;
  runs: Edition[];
  onSaved: (id: string) => void;
}) {
  const sources = runs.filter(run => run.checkId === origin);
  const [ids, setIds] = useState([sources[0]?.id ?? "", "", ""]);
  const selected = ids.map(id => runs.find(run => run.id === id));
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        {runLabels.map((label, position) => {
          const options = (position && sources.length ? runs : sources)
            .filter(run => !ids.slice(0, position).includes(run.id))
            .map(run => ({value: run.id, label: runName(run)}));
          if (position === 2) options.unshift({value: "none", label: "No control"});
          return <LabeledSelect key={label} label={label + " run"} options={options}
            value={ids[position] || (position === 2 ? "none" : null)}
            onChange={value => setIds(ids.map((id, i) => {
              if (i === position) return position === 2 && value === "none" ? "" : value ?? "";
              return i > position && id === value ? "" : id;
            }))} />;
        })}
      </div>
      {selected[0]?.checkId === origin && selected[1] && <PairedRuns key={ids.join("/")}
        runs={selected.filter(run => run !== undefined)} onSaved={onSaved} />}
    </div>
  );
}

function PairedRuns({ runs, onSaved }: { runs: Edition[]; onSaved: (id: string) => void }) {
  const [source, comparison, control] = runs;
  const [settings, setSettings] = useState<Omit<AnalysisSetup,"first"|"last">>(
    {alignment:"marker",shift:0,region:[0, 0, 8, 4],channel:"contrast"});
  const [interval, setInterval] = useState<[number, number] | null>(null);
  const { alignment, shift, channel: metric } = settings;
  const rows = alignedSamples(source, comparison, control, settings);
  const start = interval?.[0] ?? rows[0]?.source.frame ?? 1,
    end = interval?.[1] ?? rows.at(-1)?.source.frame ?? 1;
  const selected = rows.filter((r) => r.source.frame >= start && r.source.frame <= end);
  const basis = { ...settings, first: start, last: end };
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <LabeledSelect
          label="Align by"
          value={alignment}
          options={[
            { value: "marker", label: "First complete identifier" },
            { value: "start", label: "First stored frame" },
          ]}
          onChange={(value) => {
            if (value) {
              setSettings({...settings,alignment:value});
              setInterval(null);
            }
          }}
        />
        <LabeledSelect
          label="Comparison offset"
          value={String(shift)}
          options={Array.from({ length: source.frames.length + comparison.frames.length - 1 }, (_, i) => {
            const v = i - source.frames.length + 1;
            return { value: String(v), label: v === 0 ? "0 frames" : (v > 0 ? "+" : "") + v + " frames" };
          })}
          onChange={(value) => {
            setSettings({...settings,shift:Number(value)});
            setInterval(null);
          }}
        />
        <LabeledSelect
          label="Trace"
          value={metric}
          options={[
            { value: "contrast", label: "Local contrast (σ Y′)" },
            { value: "mean", label: "Mean luma (Y′)" },
          ]}
          onChange={(v) => {
            if (v) setSettings({...settings,channel:v});
          }}
        />
      </div>
      <AlignedFrames
        key={alignment + "/" + shift}
        runs={runs}
        setup={basis}
        setRegion={(region) => setSettings({ ...settings, region })}
        setInterval={setInterval}
        rows={rows}
      />
      {selected.length > 0 && (
        <>
          <AnalysisReport origin={source.checkId} editions={runs} setup={basis} samples={selected} />
          <SaveAnalysis setup={basis} runs={runs} onSaved={onSaved} />
        </>
      )}
    </div>
  );
}

function SaveAnalysis({ setup, runs, onSaved }: {
  setup: AnalysisSetup;
  runs: Edition[];
  onSaved: (id: string) => void;
}) {
  const { checkId, issueId: target, serial } = runs[0];
  const { users, targets } = useVerification();
  const draft = useFindingDraft("/api/inspection-analysis", {
    checkId, target, editions: runs.map(({ id, digest }) => ({ id, digest })), ...setup,
  }, onSaved);
  if (!target) return <p className="text-sm text-muted-foreground">No issue is linked to this inspection.</p>;
  return (
    <form onSubmit={draft.save} className="grid gap-2">
      <PersonField label="Analyst" placeholder="Choose analyst" people={users} {...draft.person} />
      <NoteField label="Observation"
          name="observation"
          {...draft.observation}
          placeholder="What changed in this interval?"
        />
      <p className="mt-0.5 text-xs text-muted-foreground">
        Attach to {serial} · {targets[target]?.title ?? target}
      </p>
      <div>
        <Button type="submit" size="sm" variant="outline" className="bg-popover" disabled={draft.disabled}>
          {draft.busy ? "Saving…" : "Save analysis to issue"}
        </Button>
      </div>
      {draft.feedback && <p role="alert">{draft.feedback}</p>}
    </form>
  );
}

export function RunAnalysis({ checkId, pinnedId }: { checkId: string; pinnedId?: string }) {
  const router = useRouter();
  const { data: library, failed, watch, reload } = useOpenRecord<AnalysisLibrary | Edition[]>(
    "/api/inspection-analysis?" + new URLSearchParams(pinnedId ? { check: checkId, finding: pinnedId } : { view: "archive" }),
  );
  return (
    <details open={Boolean(pinnedId)} ref={watch} className="min-w-0">
      <summary className="w-fit cursor-pointer rounded-sm py-1 text-sm font-medium focus-visible:outline-2">
        {pinnedId ? "Saved run analysis" : "Compare other recorded runs"}
      </summary>
      <div className="mt-3 grid min-w-0 gap-3">
        {failed && (
          <p role="alert">
            The inspection archive could not be loaded.{" "}
            <button className={recordLink} onClick={reload}>
              Retry
            </button>
          </p>
        )}
        {!failed && !library && <p role="status">Loading archived runs…</p>}
        {library && (!Array.isArray(library) ? (
          <SavedStudy origin={checkId} library={library} />
        ) : (
          <MeasurementStudy
            origin={checkId}
            runs={library}
            onSaved={(id) => {
              const url = new URL(window.location.href);
              url.searchParams.set("finding", id);
              window.history.replaceState(null, "", url);
              router.refresh();
            }}
          />
        ))}
      </div>
    </details>
  );
}
