import { asc, desc, eq, max } from "drizzle-orm";
import type { RecordEntry } from "@/lib/records/journal";
import { forecastPlan, validDay, type PlanningGates } from "@/lib/planning";
import { loadCatalog } from "./catalog";
import type { Reader, WorkspaceDatabase } from "./connection";
import { formText } from "./records/history";
import { planningTasks, planningStations, planScenarios, publishedPlans, type Reservation } from "./schema";
import { readProductionExecution } from "./operations/tools";
import { readActors, reviewers } from "./records/work";

async function readCalendar(db: Reader) {
  const [tasks, stations] = await Promise.all([
    db.select().from(planningTasks).orderBy(asc(planningTasks.id)),
    db.select().from(planningStations).orderBy(asc(planningStations.name)),
  ]);

  return { tasks, stations };
}

export async function readSchedule(db: Reader) {
  const [calendar, scenarios, versions] = await Promise.all([
    readCalendar(db),
    db.select().from(planScenarios).orderBy(desc(planScenarios.savedAt)),
    db.select().from(publishedPlans).orderBy(desc(publishedPlans.version)),
  ]);

  return { ...calendar, scenarios, versions };
}

// Require one reservation per current task and retain only the four fields the planner can assign.
export function parseReservations(
  input: unknown,
  tasks: readonly Pick<typeof planningTasks.$inferSelect, "id" | "stations">[],
  people: readonly { id: string }[],
): Reservation[] | undefined {
  if (!Array.isArray(input) || input.length !== tasks.length) return;
  const remaining = new Map(tasks.map(task => [task.id, new Set(task.stations)]));
  const availablePeople = new Set(people.map(person => person.id));
  const slots: Reservation[] = [];
  for (const slot of input) {
    if (!slot || !remaining.get(slot.task)?.has(slot.station) ||
        !availablePeople.has(slot.person) || !validDay(slot.day)) return;
    const { task, day, station, person } = slot;
    slots.push({ task, day, station, person });
    remaining.delete(task);
  }

  return slots;
}

type Writer = Pick<WorkspaceDatabase, "select" | "insert">;

async function publishedVersion(db: Reader) {
  const [latest] = await db.select({ version: max(publishedPlans.version) }).from(publishedPlans);

  return latest.version ?? 0;
}

const stalePlan = { status: 409, error: "A newer plan was published. Compare against the current version." };
const staleScenario = { status: 409, error: "Save a current scenario before publishing." };

// The workspace write transaction locks the current plan for both operations.
export async function savePlanScenario(db: Writer, input: Record<string, unknown>) {
  const version = await publishedVersion(db);
  if (input.baseVersion !== version) return stalePlan;
  const title = formText(input.title, 100);
  const [tasks, actors] = await Promise.all([
    db.select({ id: planningTasks.id, stations: planningTasks.stations }).from(planningTasks),
    readActors(db),
  ]);
  const slots = parseReservations(input.slots, tasks, reviewers(actors));
  if (!title || !slots?.length)
    return { status: 400, error: "Choose a valid date, person and station for every task and name the scenario." };

  const id = crypto.randomUUID();
  await db.insert(planScenarios).values({ id, title, baseVersion: version, slots });

  return { saved: true, scenarioId: id };
}

export async function publishPlan(
  db: Writer,
  input: Record<string, unknown>,
  readGates: () => Promise<PlanningGates & { local: readonly RecordEntry[] }>,
) {
  const version = await publishedVersion(db);
  if (input.baseVersion !== version) return stalePlan;
  if (typeof input.scenario !== "string") return staleScenario;
  const [scenario] = await db.select().from(planScenarios).where(eq(planScenarios.id, input.scenario));
  if (!scenario || scenario.baseVersion !== version) return staleScenario;

  const [calendar, execution, actors, catalog, { local, ...records }] = await Promise.all([
    readCalendar(db), readProductionExecution(db, "publication"), readActors(db), loadCatalog(db, ["units", "archivedRows"]), readGates(),
  ]);
  const slots = parseReservations(scenario.slots, calendar.tasks, reviewers(actors));
  if (!slots) return staleScenario;
  const forecast = forecastPlan({ ...calendar, ...execution }, slots, { ...records, catalog }, local);
  if (forecast.conflicts) return { status: 409, error: "Resolve reservation and dependency conflicts before publishing." };
  if (forecast.stamp !== input.stamp) return { status: 409, error: "Forecast changed. Review the current blockers before publishing." };

  await db.insert(publishedPlans).values({
    version: version + 1, scenario: scenario.id, dates: forecast.deliveries.map(delivery => delivery.date),
  });

  return { saved: true };
}
