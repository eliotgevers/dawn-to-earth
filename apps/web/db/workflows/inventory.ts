import { recordActivity, recordedBuildProgress, type RecordUnit } from "@/lib/records/journal";
import { assemblyAtUnit, unitProblem, entryText, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent, type WorkWrite } from "./cases";

export type Order = { buildId: string; unit: RecordUnit; installationId?: string };
type Lot = {
  partId: string;
  lotId: string;
  locations: { id: string; name: string }[];
  orders: Order[];
  receipt: { locationId: string; quantity: number; reference: string; at: string; recorder: string };
  containmentId?: string;
};
export type Register = WorkCase & { data: Lot };

export function isRegister(record: WorkCase): record is Register {
  return (
    record.tool === "inventory" &&
    typeof record.data.lotId === "string" &&
    Array.isArray(record.data.locations) &&
    Array.isArray(record.data.orders) &&
    !!record.data.receipt
  );
}

export const movements = {
  receive: "Receive stock",
  transfer: "Transfer stock",
  reserve: "Reserve for build",
  release: "Release reservation",
  issue: "Issue reserved stock",
  return: "Return from build",
  install: "Record installation evidence",
} as const;
export type Action = keyof typeof movements;
export function needsOrder(action: Action) {
  return action !== "receive" && action !== "transfer";
}

type Movement = {
  action: Action;
  quantity: number;
  partId: string;
  lotId: string;
  reference: string;
  movementId?: string;
  locationId?: string;
  toLocationId?: string;
  buildId?: string;
  unitSerial?: string;
  revisionId?: string;
};

// One work order identity for ledger replay, writes, and returning to the originating build.
export function orderFor<T extends Order>(orders: T[], buildId: unknown, serial: unknown, revisionId: unknown) {
  return orders.find(order => order.buildId === buildId && order.unit.serial === serial && order.unit.revisionId === revisionId);
}

export function stockRegister(record: Register) {
  const { receipt, locations, orders, partId, lotId } = record.data;
  const saved = record.history as (WorkEvent & { data: Movement })[];
  // The opening receipt participates in balance and reference checks, but is not a saved decision.
  const opening: Movement = { ...receipt, action: "receive", partId, lotId };
  const entries = [
    { id: receipt.reference, at: receipt.at, actor: receipt.recorder, data: opening },
    ...saved,
  ];
  const bins = new Map(locations.map(location => [location.id, { ...location, onHand: 0, reserved: 0 }]));
  const allocations = orders.map((order) => ({
    ...order,
    byLocation: new Map<string, number>(),
    reserved: 0,
    issued: 0,
    installed: 0,
  }));
  for (const { data: m } of entries) {
    const loc = bins.get(m.locationId ?? "");
    const order = orderFor(allocations, m.buildId, m.unitSerial, m.revisionId);
    const n = m.quantity;
    if (loc) {
      if (m.action === "receive" || m.action === "return") loc.onHand += n;
      if (m.action === "transfer" || m.action === "issue") loc.onHand -= n;
      if (m.action === "transfer") {
        const destination = bins.get(m.toLocationId ?? "");
        if (destination) destination.onHand += n;
      }
      if (order && (m.action === "reserve" || m.action === "release" || m.action === "issue")) {
        const delta = m.action === "reserve" ? n : -n;
        loc.reserved += delta;
        order.reserved += delta;
        order.byLocation.set(loc.id, (order.byLocation.get(loc.id) ?? 0) + delta);
      }
    }
    if (order && m.action === "issue") order.issued += n;
    if (order && m.action === "return") order.issued -= n;
    if (order && m.action === "install") order.installed += n;
  }

  return { bins, allocations, entries, previousId: saved.at(-1)?.id ?? null };
}

type RegisterState = ReturnType<typeof stockRegister>;
type LocationBalance = { id: string; onHand: number; reserved: number };
export function availableStock(location: LocationBalance) {
  return location.onHand - location.reserved;
}

export function movementAllowance(
  action: Action,
  location?: LocationBalance,
  order?: RegisterState["allocations"][number],
) {
  if ((action === "reserve" || action === "transfer") && location)
    return {
      quantity: availableStock(location),
      label: "pieces available here",
      error: "There is insufficient unreserved stock at this location.",
    };
  if ((action === "issue" || action === "release") && location && order)
    return {
      quantity: order.byLocation.get(location.id) ?? 0,
      label: "reserved here for " + order.unit.serial,
      error: "This build does not have that quantity reserved at this location.",
    };
  if ((action === "install" || action === "return") && order)
    return {
      quantity: order.issued - order.installed,
      label: "issued pieces without an installation entry",
      error: "This build has insufficient issued quantity remaining without installation evidence.",
    };
}

export function inventoryForPlanning(cases: WorkCase[]) {
  return cases.filter(isRegister).flatMap((record) =>
    stockRegister(record).allocations.map(({ buildId, unit, reserved, issued, installed }) => ({
      caseId: record.id,
      lotId: record.data.lotId,
      partId: record.data.partId,
      buildId,
      unit,
      reserved,
      issued,
      installed,
    })),
  );
}

export function movementOrderProblem(order: Order | undefined, action: Action, workspace: ToolContext["workspace"]) {
  const invalidOrder = "Choose a current build and its exact unit revision.";
  if (!order) return invalidOrder;
  // Closed and archived orders can still give back their own outstanding stock.
  if (action === "release" || action === "return") return;
  const build = assemblyAtUnit(workspace, order.buildId, order.unit);
  if (build?.kind !== "queue" || unitProblem(workspace.catalog, order.unit)) return invalidOrder;
  const activity = recordActivity(workspace.local, build.id, order.unit);
  if (recordedBuildProgress(build.status, activity).status === "Complete") return invalidOrder;
  if (action === "install" && !order.installationId) return "This work order has no installation register for this part.";
}

export function decide(ctx: ToolContext, command: ToolCommand): WorkWrite | string {
  const record = command.dossier;
  if (!isRegister(record)) return "Choose an existing stock lot.";
  const { data } = command;
  if (!Object.hasOwn(movements, command.action)) return "Choose a stock movement.";
  const action = command.action as Action;
  const { partId, lotId } = record.data;
  if (data.partId !== partId || data.lotId !== lotId) return "The part and lot do not match this register.";
  const { bins, allocations, entries, previousId } = stockRegister(record);
  if (typeof data.movementId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(data.movementId))
    return "A movement identifier is required.";
  if (entries.some((e) => e.data.movementId === data.movementId))
    return "This movement has already been recorded.";
  if (data.previousId !== previousId)
    return "This register changed. Reopen the movement and check the balances.";
  const n = data.quantity;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) return "Enter a positive whole quantity.";
  const reference = entryText(data.reference, 180);
  if (!reference)
    return "Enter a document and line reference of up to 180 characters.";
  const normalize = (ref: string) => ref.toLowerCase().replace(/\s+/g, "");
  if (
    entries.some(
      (e) =>
        e.data.action === action &&
        typeof e.data.reference === "string" &&
        normalize(e.data.reference) === normalize(reference),
    )
  )
    return "This document line already records that movement.";
  const loc = action !== "install" && typeof data.locationId === "string" ? bins.get(data.locationId) : undefined;
  if (action !== "install" && !loc) return "Choose a stock location.";
  const order = needsOrder(action) ? orderFor(allocations, data.buildId, data.unitSerial, data.revisionId) : undefined;
  if (needsOrder(action)) {
    const problem = movementOrderProblem(order, action, ctx.workspace);
    if (problem) return problem;
  }
  const to = action === "transfer" && typeof data.toLocationId === "string" ? bins.get(data.toLocationId) : undefined;
  if (action === "transfer" && (!to || to.id === loc?.id)) return "Choose a different destination location.";
  const allowance = movementAllowance(action, loc, order);
  if (allowance && n > allowance.quantity) return allowance.error;
  if (action === "receive") {
    // Stock enters the ledger only through receipts. Issues and transfers move existing pieces.
    const received = entries.reduce((total, { data }) => total + (data.action === "receive" ? data.quantity : 0), 0);
    if (!Number.isSafeInteger(received + n)) return "The resulting stock quantity is too large.";
  }

  return {
    kind: action === "install" ? "installation-recorded" : "stock-" + action,
    title: movements[action] + " · " + lotId + (order ? " · " + order.unit.serial : ""),
    data: {
      action, partId, lotId, reference, quantity: n, movementId: data.movementId,
      ...(loc && { locationId: loc.id }),
      ...(to && { toLocationId: to.id }),
      ...(order && { buildId: order.buildId, unitSerial: order.unit.serial, revisionId: order.unit.revisionId }),
      ...(action === "install" && order && {
        lotCorrections: [{
          lotId, serial: order.unit.serial, revisionId: order.unit.revisionId,
          sourceId: order.installationId, fileId: reference,
        }],
      }),
    },
  };
}
