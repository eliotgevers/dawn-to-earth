"use client";

import { Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { ConnectionLink } from "@/components/records/links";
import { LabeledSelect } from "@/components/records/forms";
import { Button } from "@/components/ui/button";
import { captureStation, stationEdition, stationRecordings } from "@/lib/evidence/station";
import { recordConnection } from "@/lib/records/links";
import type { RecordUnit } from "@/lib/records/journal";
import { saveWorkspace } from "@/lib/workspace";
import { GrafanaLinks } from "./grafana-links";
import { methods, type VerificationTest } from "./model";

// Each packet is a standalone training example. Its page labels never enter the evidence register.
const packets = {
  leak: ["Witness card", "LC-12", "LC-21"],
  pressure: ["Report appendix", "PA-04", "PA-04"],
  communication: ["Display log", "DL-06", "DL-09"],
  vibration: ["Mount photograph", "MP-18", "MP-18"],
  thermal: ["Sleeve photograph", "SP-03", "SP-08"],
  "ground-firing": ["Archive cover sheet", "CS-14", "CS-41"],
} satisfies Record<VerificationTest, [string, string, string]>;

function PacketReplay({ method }: { method: VerificationTest }) {
  const [opened, setOpened] = useState(false);
  const [answer, setAnswer] = useState<boolean>();
  const [document, requested, filed] = packets[method];
  const matches = requested === filed;

  return <div className="grid gap-3">
    <p>Check the attachment in a fictional packet. This exercise leaves the evidence and its QA decision unchanged.</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y py-3">
      <dt className="text-muted-foreground">Packet index</dt><dd>{document} · {requested}</dd>
      {opened && <><dt className="text-muted-foreground">Filed copy</dt><dd>{document} · {filed}</dd></>}
    </dl>
    {!opened ? <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpened(true)}>Open attachment</Button> : <>
      <p>Does the filed copy match the index?</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-pressed={answer === true} onClick={() => setAnswer(true)}>Matches</Button>
        <Button size="sm" variant="outline" aria-pressed={answer === false} onClick={() => setAnswer(false)}>Different label</Button>
      </div>
    </>}
    {answer !== undefined && <p role="status">{answer === matches ? "Correct." : "Look again."} {matches
      ? `Both pages identify ${requested}.` : `The index lists ${requested}, but the filed copy is ${filed}.`}</p>}
  </div>;
}

export function TestStation({ method, sourceId, unit, canFileCapture }: {
  method: VerificationTest; sourceId: string; unit: RecordUnit; canFileCapture: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [take, setTake] = useState<0 | 1 | "document">("document");
  const [captured, setCaptured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof saveWorkspace>>>();
  const benchMethod = canFileCapture && (method === "communication" || method === "leak") ? method : undefined;
  const fixture = benchMethod && stationRecordings[benchMethod];
  const capture = captured && benchMethod && take !== "document" ? captureStation(benchMethod, take) : undefined;

  async function file() {
    if (!benchMethod || take === "document") return;
    setSaving(true);
    setResult(await saveWorkspace({ operation: "file-station-capture", sourceId, serial: unit.serial,
      revisionId: unit.revisionId, method: benchMethod, take, edition: stationEdition }));
    setSaving(false);
  }

  return <Dialog open={open} onOpenChange={next => {
    if (saving) return;
    if (next) { setTake("document"); setCaptured(false); setResult(undefined); }
    setOpen(next);
  }}>
    <DialogTrigger render={<Button size="sm" variant="outline" className="bg-popover" />}>
      <Play data-icon="inline-start" aria-hidden="true" />Run simulated test
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{methods[method].label} · training station</DialogTitle>
        <DialogDescription>{unit.serial} · {unit.revision}</DialogDescription>
      </DialogHeader>
      {fixture && !result?.id && <LabeledSelect label="Recording" value={String(take)} disabled={saving}
        options={[{ label: "Practice packet review", value: "document" },
          ...fixture.names.map((label, i) => ({ label, value: String(i) }))]}
        onChange={value => { setTake(value === "0" ? 0 : value === "1" ? 1 : "document"); setCaptured(false); setResult(undefined); }} />}
      {!fixture || take === "document" ? open && <PacketReplay method={method} /> : result?.id && capture ? <>
        <p role="status">Evidence filed · {capture.title}</p>
        <ConnectionLink primary sourceId={sourceId} onFollow={() => setOpen(false)} connection={recordConnection("verification", result.id, unit,
          { label: "Open filed evidence", view: methods[method].label })} />
        {result.indexed
          ? <GrafanaLinks series={capture.companion ? [capture.series, capture.companion] : [capture.series]}
              method={method} recordId={result.id} unit={unit} />
          : <p className="text-xs text-muted-foreground">Grafana indexing is pending.</p>}
      </> : <>
        <p>{fixture.description}</p>
        {capture ? <>
          <p role="status" className="text-sm font-medium">{capture.observation}</p>
          <table className="w-full text-left text-xs tabular-nums" aria-label="Captured readings">
            <thead><tr className="border-b"><th scope="col">Elapsed (ms)</th><th scope="col">{capture.series.quantity}</th>
              {capture.companion && <th scope="col">{capture.companion.quantity}</th>}</tr></thead>
            <tbody>{capture.series.points.map((point, i) => <tr key={point.id}>
              <td>{point.elapsedMs}</td><td>{point.value}</td>{capture.companion && <td>{capture.companion.points[i].value}</td>}
            </tr>)}</tbody>
          </table>
          {result?.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
          <Button variant="outline" className="w-fit bg-popover" size="sm" disabled={saving} onClick={file}>{saving ? "Filing…" : "File evidence"}</Button>
        </> : <Button variant="outline" className="w-fit bg-popover" size="sm" onClick={() => setCaptured(true)}>Capture recording</Button>}
      </>}
    </DialogContent>
  </Dialog>;
}
