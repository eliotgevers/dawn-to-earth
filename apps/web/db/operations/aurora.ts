import { and, asc, desc, eq, inArray, sql, getTableColumns } from "drizzle-orm";
import { parseSelection } from "@/components/workspace/selection";
import { studyScope } from "@/lib/archives/study";
import { loadCatalog } from "../catalog";
import { fail, type Reader, type RecordWriter, type Transaction, type WorkspaceDatabase } from "../connection";
import { formText, isRequestId } from "../records/history";
import { auroraCalendar as appointments, auroraFlightComments as comments, auroraServices as services, auroraServiceDocuments as documents, auroraServiceFilings as filings, catalogFlights } from "../schema";

export type FlightEntry = typeof comments.$inferSelect;

async function archiveScope(db: Reader, items: readonly string[], recordings?: "aurora") {
  const selections = items.map(parseSelection);
  if (!selections.every(item => item !== null)) return null;

  return studyScope(await loadCatalog(db), selections, recordings);
}

const reportProject = sql<string>`${catalogFlights.data}->>'projectId'`;
const individualFlight = sql`${catalogFlights.data}->>'kind' = 'flight'`;

async function reportsIn(db: Reader, projects: string[], flightsOnly = false) {
  const rows = await db.select({ report: catalogFlights.data }).from(catalogFlights)
    .where(and(inArray(reportProject, projects), flightsOnly ? individualFlight : undefined))
    .orderBy(sql`(${catalogFlights.data}->>'position')::int`, catalogFlights.id);

  return rows.map(row => row.report);
}

export async function readFlightArchive(db: Reader, items: readonly string[]) {
  const scope = await archiveScope(db, items, "aurora");
  if (!scope) return { reports: [], hasRecordings: false };
  const { targets, availableArchives } = scope;
  const reports = await reportsIn(db, scope.projectIds);

  return { reports, hasRecordings: Boolean(targets.length || availableArchives.length) };
}

async function hasFlight(db: Reader, items: readonly string[], id?: string) {
  const scope = await archiveScope(db, items);
  if (!scope) return false;
  const [flight] = await db.select({ id: catalogFlights.id }).from(catalogFlights)
    .where(and(inArray(reportProject, scope.projectIds), individualFlight, id === undefined ? undefined : eq(catalogFlights.id, id)))
    .limit(1);

  return Boolean(flight);
}

const commentReadOnly = "To post a comment, open this flight in a writable workspace.";

export async function canPostFlightComment(db: Pick<WorkspaceDatabase, "execute">) {
  const [permission] = await db.execute<{ allowed: boolean }>(
    sql`select has_table_privilege(current_user, 'public.aurora_flight_comments', 'INSERT') as allowed`,
  );

  return permission.allowed;
}

export function flightComments(db: Reader, flightId: string) {
  return db.select().from(comments).where(eq(comments.flightId, flightId))
    .orderBy(asc(comments.recordedAt), asc(comments.id));
}

export async function readFlightReview(db: Reader, flightId: string, items: string[]) {
  if (!await hasFlight(db, items, flightId)) return fail("Flight unavailable for this selection.", 404);

  return { entries: await flightComments(db, flightId) };
}

export async function saveFlightReview(tx: Transaction, flightId: string, items: string[], input: Record<string, unknown>) {
  const { id } = input;
  const author = typeof input.author === "string" ? input.author.trim() : null;
  if (input.author != null && (!author || author.length > 120)) return fail("Enter a name of up to 120 characters or leave it out.", 400);
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!isRequestId(id) || !body || body.length > 1000)
    return fail("Enter a comment of up to 1,000 characters.", 400);
  if (!await hasFlight(tx, items, flightId)) return fail("Flight unavailable for this selection.", 404);
  if (!await canPostFlightComment(tx)) return fail(commentReadOnly, 403);

  const [written] = await tx.insert(comments).values({ id, flightId, author, body }).onConflictDoNothing().returning({ id: comments.id });
  if (!written) {
    const [prior] = await tx.select().from(comments).where(eq(comments.id, id));
    if (!prior || prior.example || prior.flightId !== flightId || prior.author !== author || prior.body !== body)
      return fail("This comment ID has already been used.");
  }

  return { id };
}

export type Appointment = typeof appointments.$inferSelect;

export async function readCalendar(db: Reader, items: readonly string[]) {
  const scope = await archiveScope(db, items);
  const reports = await reportsIn(db, scope?.projectIds ?? []);
  if (!reports.length) return fail("The Aurora calendar is unavailable for this selection.", 404);
  const entries = await db.select().from(appointments).orderBy(appointments.day, appointments.title, appointments.id);

  return { entries, reports };
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");

  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function saveAppointment(tx: RecordWriter, items: readonly string[], input: Record<string, unknown>) {
  const { id, day, status, previousUpdate } = input;
  const title = formText(input.title, 160);
  const { kind } = input;
  if (kind !== undefined && kind !== "Appointment" && kind !== "Flight" && kind !== "Preparation" && kind !== "Service")
    return fail("Choose an appointment type.", 400);
  if (!isRequestId(id) || !title || !isCalendarDay(day) || (status !== "Tentative" && status !== "Confirmed"))
    return fail("Enter a title, a valid date and an appointment status.", 400);
  if (previousUpdate !== undefined && typeof previousUpdate !== "string") return fail("Invalid appointment revision.", 400);
  if (!await hasFlight(tx, items)) return fail("The Aurora calendar is unavailable for this selection.", 404);

  // The workspace transaction serializes this read, the revision check and the write.
  const [current] = await tx.select().from(appointments).where(eq(appointments.id, id));
  if (!current) {
    if (previousUpdate !== undefined) return fail("This appointment is no longer on the calendar.", 404);
    const [entry] = await tx.insert(appointments).values({ id, day, title, status, kind }).returning();

    return { entry };
  }
  const same = current.day === day && current.title === title && current.status === status && (kind === undefined || current.kind === kind);
  if (previousUpdate === undefined)
    return same && !current.example ? { entry: current } : fail("An appointment already exists with this identifier.");
  if (current.updatedAt !== previousUpdate) return fail("This appointment changed since you opened it. Reload the latest version.");
  if (same) return { entry: current };
  const [entry] = await tx.update(appointments).set({ day, title, status, kind, updatedAt: sql`clock_timestamp()` }).where(eq(appointments.id, id)).returning();

  return { entry };
}

export type ServiceRecord = typeof services.$inferSelect & { filing: typeof filings.$inferSelect | null };
export type ServiceDocument = typeof documents.$inferSelect;

export function flightServiceLinks(db: Reader, flightId: string) {
  return db.select({ id: services.id, work: services.work, status: services.status, example: services.example })
    .from(services).where(eq(services.flightId, flightId))
    .orderBy(desc(sql`${services.status} = 'Open'`), desc(services.updatedAt), services.id);
}

export async function readAuroraService(db: Reader, items: readonly string[], flightId?: string) {
  const scope = await archiveScope(db, items);
  const flights = await reportsIn(db, scope?.projectIds ?? [], true);
  const selected = flightId === undefined ? flights : flights.filter(flight => flight.id === flightId);
  if (!selected.length) return { flights: selected, records: [], documents: [], filingAvailable: false };
  const ids = selected.map(flight => flight.id);

  const filingAvailable = await hasMaintenanceFiling(db);
  const openFirst = desc(sql`${services.status} = 'Open'`);
  if (!filingAvailable) {
    const tasks = await db.select().from(services).where(inArray(services.flightId, ids))
      .orderBy(openFirst, desc(services.updatedAt), services.id);

    return { flights: selected, records: tasks.map(task => ({ ...task, filing: null })), documents: [], filingAvailable };
  }
  const [records, filed] = await Promise.all([
    db.select({ ...getTableColumns(services), filing: filings }).from(services)
      .leftJoin(filings, eq(filings.serviceId, services.id))
      .where(inArray(services.flightId, ids))
      .orderBy(openFirst, asc(filings.dueOn), desc(services.updatedAt), services.id),
    db.select().from(documents).where(inArray(documents.flightId, ids)).orderBy(desc(documents.filedOn), documents.id),
  ]);

  return { flights: selected, records, documents: filed, filingAvailable };
}

// Existing installations can continue recording service work before their maintenance filing migration.
async function hasMaintenanceFiling(db: Reader) {
  const [schema] = await db.select({ available: sql<boolean>`filing is not null` })
    .from(sql`to_regclass('aurora_service_filings') as filing`);

  return schema.available;
}

export async function saveAuroraService(tx: RecordWriter, items: string[], input: Record<string, unknown>) {
  const { id, flightId } = input;
  if (!isRequestId(id) || typeof flightId !== "string") return fail("Choose a flight and service record.", 400);
  if (!await hasFlight(tx, items, flightId)) return fail("Flight unavailable for this selection.", 404);
  const [[saved], filingAvailable] = await Promise.all([
    tx.select().from(services).where(eq(services.id, id)),
    hasMaintenanceFiling(tx),
  ]);
  const [filing] = saved && filingAvailable
    ? await tx.select().from(filings).where(eq(filings.serviceId, id)) : [];

  const evidenceId = input.evidenceId === "" ? null : input.evidenceId ?? null;
  const returnRecordId = input.returnRecordId === "" ? null : input.returnRecordId ?? null;
  if ((evidenceId !== null && typeof evidenceId !== "string") || (returnRecordId !== null && typeof returnRecordId !== "string"))
    return fail("Choose a filed document.", 400);
  if (!filingAvailable && (input.category || input.dueOn || evidenceId || returnRecordId))
    return fail("The maintenance filing migration is required to save these details.");
  const ids = [evidenceId, returnRecordId].filter((value): value is string => value !== null);
  if (ids.length) {
    const filed = await tx.select({ id: documents.id, kind: documents.kind }).from(documents)
      .where(and(eq(documents.flightId, flightId), inArray(documents.id, ids)));
    if (evidenceId && !filed.some(doc => doc.id === evidenceId && doc.kind !== "Return to service"))
      return fail("Choose an inspection or repair record filed for this flight.", 400);
    if (returnRecordId && !filed.some(doc => doc.id === returnRecordId && doc.kind === "Return to service"))
      return fail("Choose a filed return-to-service record for this flight.", 400);
  }

  if (input.action === "add") {
    const work = formText(input.work, 1000);
    const owner = formText(input.owner, 120);
    const category = input.category ?? null;
    const dueOn = input.dueOn === "" ? null : input.dueOn ?? null;
    if (!work || !owner) return fail("Enter the work to be done and its owner.", 400);
    if (filingAvailable && category !== "Scheduled" && category !== "Unscheduled") return fail("Choose scheduled or unscheduled work.", 400);
    if (dueOn !== null && !isCalendarDay(dueOn)) return fail("Enter a valid due date.", 400);
    if (returnRecordId) return fail("File the return reference with the completion entry.", 400);
    if (saved) {
      if (saved.example || saved.flightId !== flightId || saved.work !== work || saved.owner !== owner ||
        (filing?.category ?? null) !== category || (filing?.dueOn ?? null) !== dueOn || (filing?.evidenceId ?? null) !== evidenceId)
        return fail("This service record ID is already in use.");

      return { id };
    }
    await tx.insert(services).values({ id, flightId, work, owner, status: "Open" });
    if (category === "Scheduled" || category === "Unscheduled") await tx.insert(filings).values({ serviceId: id, category, dueOn, evidenceId });

    return { id };
  }

  const { status, updatedAt } = input;
  if (input.action !== "setStatus" || (status !== "Open" && status !== "Completed") || typeof updatedAt !== "string")
    return fail("Choose an available service action.", 400);
  if (!saved || saved.flightId !== flightId) return fail("Service record unavailable for this flight.", 404);
  if (saved.updatedAt !== updatedAt) return fail("This service record changed. Refresh to see its latest status.");
  if (status === "Open" && (evidenceId || returnRecordId)) return fail("Reopening keeps the filed references.", 400);
  if ((filing?.completionEvidenceId && evidenceId && filing?.completionEvidenceId !== evidenceId) ||
      (filing?.returnRecordId && returnRecordId && filing?.returnRecordId !== returnRecordId))
    return fail("This service record already has a filed completion reference.");
  if (saved.status === status) {
    if ((evidenceId && filing?.completionEvidenceId !== evidenceId) || (returnRecordId && filing?.returnRecordId !== returnRecordId))
      return fail("This task already has the requested status. Refresh the record.");

    return { id };
  }

  await tx.update(services).set({ status, updatedAt: sql`clock_timestamp()` }).where(eq(services.id, id));
  if (evidenceId || returnRecordId) {
    const references = {
      completionEvidenceId: filing?.completionEvidenceId ?? evidenceId,
      returnRecordId: filing?.returnRecordId ?? returnRecordId,
    };
    await tx.insert(filings).values({ serviceId: id, ...references })
      .onConflictDoUpdate({ target: filings.serviceId, set: references });
  }

  return { id };
}
