"use server";

import { refresh } from "next/cache";
import { saveAppointment, saveAuroraService, saveFlightReview } from "@/db/operations/aurora";
import { writeTransaction, type Transaction } from "@/db/connection";
import { writeForRequest } from "@/db/http";

async function save<T extends object>(write: (tx: Transaction) => Promise<T>) {
  const result = await writeForRequest(db => writeTransaction(db, write));

  if (!("error" in result)) refresh();

  return result;
}

export async function postFlightComment(flightId: string, items: string[], comment: { id: string; body: string }) {
  return save(tx => saveFlightReview(tx, flightId, items, comment));
}

export async function saveServiceRecord(items: string[], record: Record<string, unknown>) {
  return save(tx => saveAuroraService(tx, items, record));
}

export async function saveCalendarAppointment(items: readonly string[], appointment: Record<string, unknown>) {
  return save(tx => saveAppointment(tx, items, appointment));
}
