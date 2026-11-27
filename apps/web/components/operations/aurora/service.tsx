"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConnectionLink } from "@/components/records/links";
import { FlightReportLink } from "./view";
import { saveServiceRecord } from "@/app/(sections)/operations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ServiceDocument, ServiceRecord } from "@/db/operations/aurora";
import type { AuroraFlight } from "@/db/schema";
import { formatUtcDateTime } from "@/lib/utc-time";

type ServiceForm = { id: string; flight: string; record?: ServiceRecord };

const selectClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2";

const flightName = (flight: AuroraFlight) => flight.flightNumber ? `Flight ${flight.flightNumber} · ${flight.title}` : flight.title;

export default function AuroraService({ flights, items, records, documents, flightId, filingAvailable }: {
  flights: readonly AuroraFlight[];
  items: string[];
  records: readonly ServiceRecord[];
  documents: readonly ServiceDocument[];
  flightId?: string;
  filingAvailable: boolean;
}) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [form, setForm] = useState<ServiceForm>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const params = new URLSearchParams(items.map(item => ["item", item]));
  if (flightId) params.set("flight", flightId);
  const flight = flights.find(row => row.id === flightId);

  function open(button: HTMLButtonElement, record?: ServiceRecord) {
    trigger.current = button;
    setError("");
    setForm({ id: record?.id ?? crypto.randomUUID(), flight: record?.flightId ?? flightId ?? "", record });
  }

  async function save(payload: Record<string, unknown>, message: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    const result = await saveServiceRecord(items, payload)
      .catch(() => ({ error: "Saving could not be confirmed. Try again." }));
    setSaving(false);
    if ("error" in result) { setError(result.error); return; }

    setForm(undefined);
    setAnnouncement(message);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const command = form.record
      ? { action: "setStatus", updatedAt: form.record.updatedAt, status: "Completed" }
      : { action: "add" };

    void save({ ...values, ...command, id: form.id, flightId: form.flight },
      form.record ? "Service record completed." : "Service record added.");
  }

  const all = new URLSearchParams(items.map(item => ["item", item]));
  all.set("view", "service");

  return <section aria-labelledby="aurora-service-heading" className="grid max-w-4xl gap-4">
    {flightId && <Link href={"/operations/aurora?" + all} className="w-fit text-sm text-primary hover:underline">All service records</Link>}
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 id="aurora-service-heading" className="text-lg font-semibold">Service records</h2>
        {flight && <FlightReportLink report={flight} items={items} />}
      </div>
      {flights.length > 0 && <Button variant="outline" className="bg-popover" size="sm" onClick={e => open(e.currentTarget)}>Add service record</Button>}
    </header>
    {error && !form && <div role="alert" className="text-sm">{error} <Button size="sm" variant="outline" onClick={() => { setError(""); router.refresh(); }}>Refresh records</Button></div>}
    {!records.length && <p className="text-sm text-muted-foreground">{flights.length ? "No service records for these flights." : "No individual flights in this selection."}</p>}
    {(["Open", "Completed"] as const).map(status => {
      const group = records.filter(record => record.status === status);
      if (!group.length) return null;

      return <section key={status} className="grid gap-1">
        <h3 className="text-sm font-semibold">{status === "Open" ? "Work due" : "Completed"} ({group.length})</h3>
        <ul className="divide-y border-t">{group.map(record => {
          const source = flights.find(row => row.id === record.flightId)!;
          const query = new URLSearchParams(params);
          query.set("flight", source.id);
          const linked = [...new Set([record.filing?.evidenceId, record.filing?.completionEvidenceId, record.filing?.returnRecordId])];
          return <li key={record.id} id={"service-" + record.id} tabIndex={-1} className="scroll-mt-4 space-y-2 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="grid min-w-0 flex-1 basis-56 gap-1">
                <p className="wrap-anywhere font-medium">{record.work}</p>
                <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  {record.filing?.category && <span>{record.filing.category}</span>}<span>{record.owner}</span>
                  {record.filing?.dueOn && <time dateTime={record.filing.dueOn}>Due {record.filing.dueOn}</time>}
                  {record.example && <span>Demo service record</span>}
                </p>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {!flight && <FlightReportLink report={source} items={items} sourceId={"service-" + record.id} />}
                  <time dateTime={record.updatedAt}>Updated {formatUtcDateTime(record.updatedAt)}</time>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled={saving} aria-label={`${status === "Open" ? "Complete" : "Reopen"} ${record.work}`}
                onClick={e => status === "Open" ? open(e.currentTarget, record) : void save({
                  action: "setStatus", id: record.id, flightId: record.flightId, updatedAt: record.updatedAt, status: "Open",
                }, "Service record reopened.")}>{status === "Open" ? "Complete" : "Reopen"}</Button>
            </div>
            {linked.map(id => {
              const doc = documents.find(row => row.id === id && row.flightId === record.flightId);
              if (!id) return null;
              if (!doc) return <p key={id} className="text-xs text-muted-foreground">Document {id} unavailable for this flight.</p>;
              const target = new URLSearchParams(query);
              target.set("view", "service");
              target.set("document", doc.id);
              target.set("record", record.id);
              return <ConnectionLink key={id} sourceId={"service-" + record.id} scope={[]} className="block w-fit"
                connection={{ href: "/operations/aurora?" + target, label: doc.kind + " " + doc.id, identity: doc.title }} />;
            })}
          </li>;
        })}</ul>
      </section>;
    })}
    <Dialog open={!!form} onOpenChange={open => { if (!open && !saving) { setForm(undefined); setError(""); } }}>
      <DialogContent finalFocus={trigger}>
        <DialogHeader><DialogTitle>{form?.record ? "Complete service record" : "Add service record"}</DialogTitle></DialogHeader>
        {form && <form onSubmit={submit} className="grid gap-3 text-sm">
          <ServiceFields filingAvailable={filingAvailable} form={form} flight={flight} flights={flights} documents={documents} onFlight={value => setForm({ ...form, flight: value })}/>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <Button type="submit" disabled={saving} className="justify-self-end">{saving ? "Saving…" : form.record ? "Record completion" : "Save record"}</Button>
        </form>}
      </DialogContent>
    </Dialog>
    <span role="status" className="sr-only">{announcement}</span>
  </section>;
}

function ServiceFields({ form, flight, flights, documents, onFlight, filingAvailable }: {
  form: ServiceForm;
  filingAvailable: boolean;
  flight?: AuroraFlight;
  flights: readonly AuroraFlight[];
  documents: readonly ServiceDocument[];
  onFlight: (flightId: string) => void;
}) {
  const available = documents.filter(doc => doc.flightId === form.flight);
  const evidence = available.filter(doc => doc.kind !== "Return to service");
  const returns = available.filter(doc => doc.kind === "Return to service");

  return <>
    {form.record ? <p>{form.record.work}</p> : <>
      {flight ? <p>{flightName(flight)}</p> : <label>Flight<select required className={selectClass} value={form.flight}
        onChange={e => onFlight(e.target.value)}>
        <option value="" disabled>Choose a flight</option>
        {flights.map(row => <option key={row.id} value={row.id}>{flightName(row)}</option>)}
      </select></label>}
      <label>Work<Textarea required name="work" maxLength={1000}/></label>
      <label>Owner<Input required name="owner" maxLength={120}/></label>
      {filingAvailable && <div className="grid gap-3 sm:grid-cols-2">
        <label>Work type<select required name="category" defaultValue="" className={selectClass}>
          <option disabled value="">Choose type</option><option>Scheduled</option><option>Unscheduled</option>
        </select></label>
        <label>Due date (optional)<Input type="date" name="dueOn"/></label>
      </div>}
    </>}
    {!form.record?.filing?.completionEvidenceId && evidence.length > 0 && <label>Inspection or repair evidence
      <select key={form.flight} name="evidenceId" className={selectClass} defaultValue="">
        <option value="">No reference</option>{evidence.map(doc =>
          <option key={doc.id} value={doc.id}>{doc.id} · {doc.title}</option>)}
      </select></label>}
    {form.record && !form.record.filing?.returnRecordId && returns.length > 0 && <label>Existing return-to-service record
      <select name="returnRecordId" className={selectClass} defaultValue="">
        <option value="">No reference</option>{returns.map(doc =>
          <option key={doc.id} value={doc.id}>{doc.id} · {doc.title}</option>)}
      </select></label>}
  </>;
}
