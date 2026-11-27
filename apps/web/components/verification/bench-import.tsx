"use client";

import { FileUp, Info } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { ConnectionLink } from "@/components/records/links";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseRun } from "@/lib/evidence/bench-recording";
import type { RecordUnit } from "@/lib/records/journal";
import { recordConnection } from "@/lib/records/links";
import { downloadJson, saveWorkspace } from "@/lib/workspace";
import { GrafanaLinks } from "./grafana-links";
import type { RecordedSeries } from "./numeric-series";

type Preview = { file: string; fileName: string; title: string; series: RecordedSeries };

export function ImportBenchRun({ sourceId, title, unit, original, returnReviewId }: {
  sourceId: string; title: string; unit: RecordUnit;
  original?: RecordedSeries; returnReviewId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [saved, setSaved] = useState<{ id: string; indexed: boolean }>();
  const label = original ? "Submit retest recording" : "Import bench run";
  const example = {
    title: original ? "Readout retest" : "Indicator window comparison", serial: unit.serial, revisionId: unit.revisionId,
    channel: original?.unit === "count" ? "display_count" : "indicator_percent", samples: [[0, 12], [100, 36], [200, 84], [300, 81]],
  };

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setError("");
    setPreview(undefined);
    if (!file) return;
    if (!file.size || file.size > 32_768) {
      setError("Choose a JSON file of 32 KB or less.");
      return;
    }

    const text = await file.text().catch(() => null);
    if (!input.isConnected || input.files?.[0] !== file) return;
    if (text === null) {
      setError("The file could not be read. Select it again.");
      return;
    }

    const run = parseRun({ fileName: file.name, file: text });
    if ("error" in run) {
      setError(run.error);
    } else if (run.serial !== unit.serial || run.revisionId !== unit.revisionId) {
      setError(`This recording is for ${run.serial} · ${run.revisionId}. Choose a file for ${unit.serial} · ${unit.revisionId}.`);
    } else {
      setPreview({ fileName: file.name, file: text, title: run.title, series: run.series });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || saving) return;

    setSaving(true);
    setError("");
    const result = await saveWorkspace({
      operation: "import-bench-run", sourceId, returnReviewId: original ? returnReviewId : undefined,
      fileName: preview.fileName, file: preview.file,
    });
    if (result.id) setSaved({ id: result.id, indexed: result.indexed === true });
    else setError(result.error || "The recording could not be saved.");
    setSaving(false);
  }

  return <Dialog open={open} onOpenChange={value => {
    if (saving) return;
    setOpen(value);
    if (value) { setError(""); setPreview(undefined); setSaved(undefined); }
  }}>
    {(!original || returnReviewId) && <DialogTrigger render={<Button variant="outline" className="bg-popover" size="sm" />}>
      <FileUp data-icon="inline-start" aria-hidden="true" />{label}
    </DialogTrigger>}
    <DialogContent>
      <DialogHeader><DialogTitle>{label}</DialogTitle>
        <DialogDescription>{title} · {unit.serial} · {unit.revision}</DialogDescription>
      </DialogHeader>
      {saved && preview ? <>
        <p role="status">{original ? "Retest filed" : "Evidence filed"} · {preview.title}</p>
        <ConnectionLink primary sourceId={sourceId} onFollow={() => setOpen(false)}
          connection={recordConnection("verification", saved.id, unit, { label: "Open imported evidence", view: "Electronics" })} />
        {saved.indexed
          ? <GrafanaLinks series={[preview.series]} method="communication" recordId={saved.id} unit={unit} />
          : <p className="text-xs text-muted-foreground">Grafana indexing is pending.</p>}
      </> : <>
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Recorded run
            <Input type="file" accept=".json,application/json" required disabled={saving} onChange={selectFile} />
          </label>
          {preview ? <div role="status" className="grid gap-1 text-sm">
            <strong>{preview.title}</strong>
            <p>{preview.series.quantity} · {preview.series.points.length} readings · {preview.series.points[0].elapsedMs}–{preview.series.points.at(-1)!.elapsedMs} ms</p>
            <p className="text-xs text-muted-foreground">First reading {preview.series.points[0].value} {preview.series.unit} · Last reading {preview.series.points.at(-1)!.value} {preview.series.unit}</p>
          </div> : <p className="text-xs text-muted-foreground">Choose a JSON recording for this unit to preview its readings.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="sm" variant="outline" disabled={saving || !preview} className="w-fit bg-popover" type="submit">
            {saving ? "Filing…" : original ? "Submit retest" : "File evidence"}
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className="text-xs underline underline-offset-2" onClick={() => downloadJson(JSON.stringify(example, null, 2), original ? "readout-retest.json" : "indicator-window.json")}>Download example for this unit</button>
          {!original && <Dialog>
            <DialogTrigger render={<Button size="sm" variant="ghost" />}>
              <Info aria-hidden="true" data-icon="inline-start" />Connect a test tool
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Connect a test tool</DialogTitle>
                <DialogDescription>File display-counter readings from a separate Python process.</DialogDescription>
              </DialogHeader>
              <p>Send a recording to <code>POST /api/bench-ingest</code> with a bearer token bound to its source, serial and revision.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt>Source</dt><dd className="break-all">{sourceId}</dd>
                <dt>Unit</dt><dd>{unit.serial} · {unit.revisionId}</dd>
              </dl>
              <p>See <strong>Connect a test tool</strong> in docs/operations.md for setup and a working Python example.</p>
            </DialogContent>
          </Dialog>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
