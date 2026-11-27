"use client";
import { TableColumns } from "@/components/records/table";
import { EmptyRecords } from "@/components/records/empty";
import { DecisionDialog } from "@/components/records/case-form";
import { CaseList } from "@/components/records/case-list";
import { WorkspaceLink } from "@/components/workspace/section-tabs";

import { useSearchParams } from "next/navigation";
import { includesUnit } from "@/components/workspace/selection";
import { useState } from "react";
import { LabeledSelect, TextField } from "@/components/records/forms";
import { ConnectionLink } from "@/components/records/links";
import { sameUnit } from "@/lib/records/journal";
import { connectionToRecord } from "@/components/records/schema";
import { recordConnection, recordHref } from "@/lib/records/links";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { ToolProps } from "@/components/workspace/workbench";
import { toolHref } from "@/lib/workspace-routes";
import {
  availableStock,
  movementOrderProblem,
  isRegister,
  movements,
  movementAllowance,
  needsOrder,
  orderFor,
  stockRegister,
  type Action,
  type Register,
} from "@/db/workflows/inventory";

export default function Inventory(props: ToolProps) {
  if (props.dossier) return isRegister(props.dossier) ? <LotRegister {...props} record={props.dossier} /> : <EmptyRecords />;
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold">Stock by lot</h2>
      <CaseList label="Stock by lot" rows={props.cases.filter(isRegister).map(record => {
        const { bins } = stockRegister(record);
        const available = [...bins.values()].reduce((n, bin) => n + availableStock(bin), 0);
        return {
          record,
          detail: `${record.data.lotId} · ${record.data.partId}`,
          filter: available > 0 ? "Stock available" : "None available",
          status: `${available} available`,
        };
      })} />
    </section>
  );
}

function LotRegister({ record, workspace, personName, submit, selectedItem }: ToolProps & { record: Register }) {
  const stock = stockRegister(record);
  const { bins, entries, allocations, previousId } = stock;
  const { lotId, partId } = record.data;
  const query = useSearchParams();
  const sourceOrder = orderFor(allocations, query.get("build"), query.get("serial"), query.get("revision"));
  const back = sourceOrder ? recordHref("production", sourceOrder.buildId,
    includesUnit(selectedItem, sourceOrder.unit) ? undefined : sourceOrder.unit) : toolHref("inventory");
  const [draft, setDraft] = useState<{ previousId: string | null; movementId: string } | null>(null);
  const [savedMovement, setSavedMovement] = useState<string>();
  const refreshing = !!savedMovement && !entries.some(entry => entry.data.movementId && entry.id === savedMovement);
  return (
    <article className="grid min-w-0 gap-5">
      <WorkspaceLink direction="back" href={back}>
        {sourceOrder ? "Back to build for " + sourceOrder.unit.serial : "All stock lots"}
      </WorkspaceLink>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{record.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lotId} · {partId}
          </p>
        </div>
        <DecisionDialog heading="Record movement" description={record.title + " · " + lotId}
          people={workspace.actors} submit={submit} disabled={refreshing} saved={setSavedMovement}
          onOpen={() => {
            setDraft({ previousId, movementId: crypto.randomUUID() });
            setSavedMovement(undefined);
          }}
          command={fields => {
            const action = fields.movement as Action;
            if (needsOrder(action) && !fields.buildId) return "Choose the build.";
            if (action !== "install" && !fields.locationId) return "Choose a location.";
            return { action, data: { ...draft, lotId, partId, quantity: Number(fields.quantity) } };
          }}>
          <MovementFields state={stock} workspace={workspace} />
        </DecisionDialog>
      </div>
      <p role="status" className="empty:hidden">
        {savedMovement && (refreshing ? "Updating balances…" : "Movement recorded.")}
      </p>
      <section aria-label="Location balances">
        <h3 className="mb-2 font-semibold">Stock by location</h3>
        <table className="w-full text-left text-sm">
          <TableColumns
            caption="Stock by location, in pieces"
            labels={["Location", "On hand", "Reserved", "Available"]}
            className="text-muted-foreground"
          />
          <tbody className="divide-y">
            {[...bins.values()].map((bin) => (
              <tr key={bin.id}>
                <th scope="row" className="py-2 font-normal">
                  {bin.name}
                </th>
                <td>{bin.onHand}</td>
                <td>{bin.reserved}</td>
                <td>{availableStock(bin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-label="Build allocations">
        <h3 className="mb-1 font-semibold">Build allocations</h3>
        <ul className="divide-y">
          {allocations.map(({ buildId, unit, reserved, issued, installed, installationId, byLocation }) => {
            const build = workspace.assembly.find(row => row.id === buildId && sameUnit(row.unit, unit));

            return <li key={buildId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div>
                <span className="block text-sm">{unit.serial} · {unit.revision}</span>
                <ConnectionLink connection={build ? connectionToRecord("production", build)
                : recordConnection("production", buildId, unit, { view: "Builds", label: "Record unavailable", identity: buildId, unavailable: true })} />
              </div>
              <span className="text-sm">
                {reserved} reserved · {issued} issued
                {installationId ? " · " + installed + " installed" : ""}
                {reserved > 0 && (
                  <small className="block mt-0.5 text-xs text-muted-foreground">
                    {Array.from(byLocation)
                      .filter(([, n]) => n > 0)
                      .map(([id, n]) => bins.get(id)?.name + " (" + n + ")")
                      .join(" · ")}
                  </small>
                )}
              </span>
            </li>;
          })}
        </ul>
      </section>
      {record.data.containmentId && (
        <ConnectionLink connection={{
          href: toolHref("containment", record.data.containmentId),
          location: "Production · Lot trace", label: `Installations · ${lotId}`,
        }} />
      )}
      <section aria-label="Movement history">
        <h3 className="font-semibold">Movement history</h3>
        <ol className="divide-y">
          {entries.toReversed().map(({ id, data, actor, at }) => {
            const from = bins.get(data.locationId ?? "")?.name ?? data.locationId;
            const destination = bins.get(data.toLocationId ?? "")?.name;
            const path = data.action === "transfer" ? from + " → " + destination : [from, data.unitSerial].filter(Boolean).join(" · ");
            const recorder = data.movementId ? personName(actor, actor) : actor;
            return (
              <li key={id} id={id} className="grid gap-1 py-2 text-sm">
                <strong>{movements[data.action]} · {data.quantity} {data.quantity === 1 ? "piece" : "pieces"}</strong>
                <span>{path} · {data.reference}</span>
                <span className="text-muted-foreground">{recorder} · {formatUtcDateTime(at)}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </article>
  );
}

function MovementFields({ state, workspace }: {
  state: ReturnType<typeof stockRegister>;
  workspace: ToolProps["workspace"];
}) {
  const [action, setAction] = useState<Action>("receive");
  const [locationId, setLocation] = useState<string | null>(null);
  const [buildId, setBuild] = useState<string | null>(null);
  const choices = needsOrder(action) ? state.allocations.filter(
    order => !movementOrderProblem(order, action, workspace),
  ) : [];
  const order = choices.find(order => order.buildId === buildId);
  const locations = [...state.bins.values()].map((bin) => ({ value: bin.id, label: bin.name }));
  const allowance = movementAllowance(action, state.bins.get(locationId ?? ""), order);
  const locationLabel =
    action === "transfer" ? "From location" : action === "return" ? "Return to" : "Location";

  return (
    <>
      <LabeledSelect
        label="Movement" name="movement"
        value={action}
        options={Object.entries(movements)
          .filter(([key]) => key !== "install" || state.allocations.some((o) => o.installationId))
          .map(([value, label]) => ({ value, label }))}
        onChange={(value) => {
          if (value) setAction(value as Action);
        }}
      />
      {needsOrder(action) && (
        <LabeledSelect
          label="Build"
          name="buildId"
          value={order?.buildId ?? null}
          options={choices.map((o) => ({ value: o.buildId, label: o.unit.serial + " · " + o.unit.revision }))}
          onChange={setBuild}
          required
        />
      )}
      {order && <>
        <input type="hidden" name="unitSerial" value={order.unit.serial} />
        <input type="hidden" name="revisionId" value={order.unit.revisionId} />
      </>}
      {action !== "install" && (
        <LabeledSelect
          label={locationLabel}
          name="locationId"
          value={locationId}
          options={locations}
          onChange={setLocation}
          required
        />
      )}
      {action === "transfer" && (
        <LabeledSelect
          key={locationId}
          label="To location"
          name="toLocationId"
          options={locations.filter((loc) => loc.value !== locationId)}
          required
        />
      )}
      {allowance && (
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
          {allowance.quantity} {allowance.label}
        </p>
      )}
      <TextField label="Quantity (pieces)" name="quantity" type="number" inputMode="numeric" required min={1} step={1} />
      <TextField label={action === "install" ? "Archived installation document and line" : "Document and line"} name="reference" required maxLength={180} />
    </>
  );
}
