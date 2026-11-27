"use client";

import { useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOpenRecord } from "@/components/records/watch-open-record";
import { ConnectionLink } from "@/components/records/links";
import { unitSelection } from "@/components/workspace/selection";
import type { CatalogRevision } from "./store";
import type { RecordUnit } from "@/lib/records/journal";
import type { FileInfo, fileLibrary } from "@/db/engineering/design";
import { attachRevisionFile } from "@/app/(sections)/catalog/actions";

const ModelPreview = dynamic(() => import("./model-preview"), { ssr: false });
type Library = Awaited<ReturnType<typeof fileLibrary>>;
type Revision = Pick<CatalogRevision, "id" | "version" | "systemId">;

function RevisionFileList({ revision }: { revision: Revision }) {
  const { data, failed, watch, reload } = useOpenRecord<Library>("/api/design-files?revision=" + encodeURIComponent(revision.id));
  const [preview, setPreview] = useState("");
  if (!data || "error" in data) return <p ref={watch} role="status">{failed || data ? "Revision files are unavailable." : "Loading revision files…"}</p>;
  const { attached, available } = data;
  const file = attached.find(file => file.id === preview) ?? attached[0];
  const url = file && "/api/design-files?file=" + file.id;
  return <div ref={watch} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
    {attached.length ? <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 text-sm">Attached file
      <select aria-label="Attached file" className="w-full min-w-0 max-w-full truncate rounded border bg-background p-2" value={file?.id} onChange={e => setPreview(e.target.value)}>
        {attached.map(f => <option key={f.id} value={f.id}>{f.name} · {f.kind === "drawing" ? "Drawing" : "3D model"}</option>)}
      </select>
    </label> : <p className="text-sm text-muted-foreground">This revision has no attached files.</p>}
    {file && url && <>
      {file.kind === "drawing" ? <img className="max-h-[45dvh] w-full rounded-lg bg-muted object-contain" alt={file.name + " · attached drawing"} src={url} />
        : <ModelPreview key={file.id} url={url} name={file.name} />}
      <a className="w-fit text-xs text-primary underline" href={url} download={file.name}>Download {file.kind === "drawing" ? "PNG" : "OBJ"}</a>
    </>}
    <AttachFile revision={revision} available={available} saved={async id => {await reload(); setPreview(id);}} />
  </div>;
}

function AttachFile({ revision, available, saved }: {
  revision: Revision; available: FileInfo[]; saved: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"upload" | "reuse" | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return !mode ? <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="bg-popover" size="sm" onClick={() => { setMode("upload"); setError(""); }}>Add file</Button>
      {available.length > 0 && <Button variant="outline" size="sm" onClick={() => {setMode("reuse"); setError("");}}>Attach existing file</Button>}
    </div> : <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 border-t pt-3" action={form => {
      const upload = form.get("file");
      if (upload instanceof File && upload.size > 512 * 1024) {setError("Choose a file up to 512 KB."); return;}
      form.set("revisionId", revision.id);
      setError("");
      start(async () => {
        try {
          const result = await attachRevisionFile(form);
          if ("error" in result) {setError(result.error); return;}
          await saved(result.id); setMode(null);
        } catch {setError("The file could not be saved. Try again.");}
      });
    }}>
      {mode === "upload" ? <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">PNG drawing or plain OBJ mesh
        <input type="file" required name="file" accept=".png,.obj" className="w-full min-w-0 max-w-full text-sm file:me-2 file:rounded file:border file:px-2 file:py-1" />
        <span className="text-xs text-muted-foreground">Up to 512 KB. Models use vertices and triangle or quad faces.</span>
      </label> : <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">Existing file
        <select aria-label="Existing file" required name="existing" defaultValue="" className="w-full min-w-0 max-w-full truncate rounded border bg-background p-2">
          <option disabled value="">Select a file</option>
          {available.map(f => <option key={f.id} value={f.id}>{f.name} · {f.kind} · {f.id.slice(0,8)}</option>)}
        </select>
      </label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={pending} size="sm" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
        <Button type="submit" disabled={pending} size="sm">{pending ? "Saving…" : "Attach to revision"}</Button>
      </div>
    </form>;
}

export function RevisionFiles({ revision, systemTitle, open, onOpenChange }: {
  revision: Revision; systemTitle: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger ref={trigger} aria-label={`Files for ${systemTitle} · ${revision.version}`}
      render={<Button variant="link" size="sm" className="h-auto px-0" />}>Files</DialogTrigger>
    <DialogContent finalFocus={trigger} className="min-w-0 grid-cols-[minmax(0,1fr)] sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Revision files</DialogTitle>
        <p className="text-sm text-muted-foreground">{systemTitle} · {revision.version}</p>
      </DialogHeader>
      <RevisionFileList revision={revision} />
    </DialogContent>
  </Dialog>;
}

export function RevisionFileLink({ unit, sourceId }: { unit: RecordUnit; sourceId: string }) {
  const {data, watch} = useOpenRecord<{attached: boolean}>("/api/design-files?linked=" + encodeURIComponent(unit.revisionId));
  const query = new URLSearchParams({view: "systems", files: unit.revisionId, item: unitSelection(unit.serial, unit.revisionId)});
  return <span ref={watch}>{data?.attached && <ConnectionLink sourceId={sourceId} connection={{
    href: "/catalog?" + query, label: `Files · ${unit.revision}`, location: "Catalog · Revisions", identity: unit.revision,
  }} />}</span>;
}
