import { pgTable, text, date, timestamp, index, boolean, integer, jsonb, uuid, unique, uniqueIndex, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { AlignedSample, AnalysisSetup, InspectionRun } from "@/lib/evidence/images";
import type { StudyArchive, ValidationCondition, ValidationDecision, ValidationRow } from "@/lib/evidence/validation";
import type { StudyId, StudyScope } from "@/lib/archives/study";
import type { ToolId, Section } from "@/lib/workspace-routes";
import type { ItemSelection } from "@/components/workspace/selection";
import type { Catalog, CatalogEntry } from "@/components/catalog/store";
import type { AssemblyHeading, RecordUnit, BracketRecord, RecordEntry } from "@/lib/records/journal";
import type { VerificationRecords, VerificationTest, EvidenceReview, ReviewRole } from "@/components/verification/model";
import type { AcceptanceDefinition } from "@/components/verification/acceptance";

// Histories across tables cite the exact edition and retain the database clock.
function unitEdition() {
  return { serial: text("serial").notNull(), revisionId: text("revision_id").notNull() };
}

function historyTime<Name extends string>(name: Name) {
  return timestamp(name, {withTimezone: true, mode: "string"}).defaultNow().notNull();
}

// Imported records retain their original timestamp; the database does not supply one.
function recordedTime() {
  return timestamp("recorded_at", { withTimezone: true }).notNull();
}

// Catalog

export const catalogEntries = pgTable("catalog_entries", {
  kind: text("kind").$type<keyof Catalog>().notNull(),
  id: text("id").notNull(),
  position: integer("position").notNull(),
  data: jsonb("data").$type<CatalogEntry>().notNull(),
}, (row) => [primaryKey({ columns: [row.kind, row.id] })]);

export const publicReferences = pgTable("public_references", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  sources: jsonb("sources").$type<readonly { title: string; href: string }[]>().notNull(),
  position: integer("position").notNull(),
});

// Public Catalog records. The IDs identify public reports; only flightNumber is a Dawn flight number.
// Dates refer to the event, not to the publication of a later announcement or film.
export type AuroraFlight = {
  id: string;
  position?: number;
  projectId: string;
  title: string;
  kind: "flight" | "campaign";
  period: string;
  precision: "day" | "month" | "year" | "range";
  summary: string;
  source: string;
  corroboration?: string;
  artifacts?: { label: string; url: string }[];
  site?: string;
  flightNumber?: number;
  flightCount?: number;
  footage?: string;
};

export type PublicSpacecraft = {
  name: string;
  noradId: number;
  internationalDesignator: string;
  catalogName: string;
  projectId: string;
  launchDate: string;
  decayDate?: string;
  orbitNote?: string;
  sources: readonly { title: string; href: string }[];
};

// Sourced public records are separate from physical demo units and their verification history.
export const catalogSpacecraft = pgTable("catalog_spacecraft", {
  noradId: integer("norad_id").primaryKey(),
  data: jsonb("data").$type<PublicSpacecraft>().notNull(),
});

export const catalogFlights = pgTable("catalog_flights", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<AuroraFlight>().notNull(),
});

export const auroraFlightComments = pgTable("aurora_flight_comments", {
  id: uuid("id").primaryKey(),
  flightId: text("flight_id").notNull().references(() => catalogFlights.id),
  author: text("author"),
  body: text("body").notNull(),
  example: boolean("example").default(false).notNull(),
  recordedAt: historyTime("recorded_at"),
}, table => [index("aurora_flight_comments_flight").on(table.flightId, table.recordedAt)]);

export const auroraServiceDocuments = pgTable("aurora_service_documents", {
  id: text("id").primaryKey(),
  flightId: text("flight_id").notNull().references(() => catalogFlights.id),
  kind: text("kind").$type<"Inspection" | "Repair" | "Return to service">().notNull(),
  title: text("title").notNull(),
  filedBy: text("filed_by").notNull(),
  filedOn: date("filed_on").notNull(),
  body: text("body").notNull(),
});

export const auroraServices = pgTable("aurora_services", {
  id: uuid("id").primaryKey(),
  flightId: text("flight_id").notNull().references(() => catalogFlights.id),
  work: text("work").notNull(),
  owner: text("owner").notNull(),
  status: text("status").$type<"Open" | "Completed">().notNull(),
  example: boolean("example").default(false).notNull(),
  recordedAt: historyTime("recorded_at"),
  updatedAt: historyTime("updated_at"),
});

// A service task can predate its maintenance filing. The task retains the owner and current status.
export const auroraServiceFilings = pgTable("aurora_service_filings", {
  serviceId: uuid("service_id").primaryKey().references(() => auroraServices.id),
  category: text("category").$type<"Scheduled" | "Unscheduled">(),
  dueOn: date("due_on"),
  evidenceId: text("evidence_id").references(() => auroraServiceDocuments.id),
  completionEvidenceId: text("completion_evidence_id").references(() => auroraServiceDocuments.id),
  returnRecordId: text("return_record_id").references(() => auroraServiceDocuments.id),
});

export const auroraCalendar = pgTable("aurora_calendar", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  kind: text("kind", { enum: ["Appointment", "Flight", "Preparation", "Service"] }).default("Appointment").notNull(),
  status: text("status").$type<"Tentative" | "Confirmed">().notNull(),
  example: boolean("example").default(false).notNull(),
  updatedAt: historyTime("updated_at"),
});

// Engineering and production records

export type AssemblyRecordKind = Exclude<RecordEntry["kind"], "evidence">;

export const assemblyRecords = pgTable("assembly_records", {
  id: text("id").primaryKey(),
  buildId: text("build_id").references((): AnyPgColumn => assemblyRecords.id),
  section: text("section", { enum: ["engineering", "production"] }).notNull(),
  position: integer("position").notNull(),
  data: jsonb("data").$type<AssemblyHeading & {
  origin: "fixture";
  kind: AssemblyRecordKind;
  designKind?: "interface";
  fields: readonly (readonly [string, string])[];
  history?: readonly RecordEvent[];
  source?: BracketRecord;
  overviewLinks?: readonly {
    section: "engineering" | "production" | "verification";
    id: string;
    relation?: string;
    detailField?: string;
  }[];
}>().notNull(),
});

export type AssemblyRecord = typeof assemblyRecords.$inferSelect["data"];

function assemblyId<Name extends string>(name: Name) {
  return text(name).references(() => assemblyRecords.id);
}

export const engineeringWork = pgTable("engineering_work", {
  recordId: assemblyId("record_id").primaryKey(),
  requirementId: assemblyId("requirement_id"),
  owner: text("owner"),
  next: text("next_step"),
  decision: text("decision"),
  blocker: text("blocker"),
});

// Workspace history and reviews

export const workspaceBaseline = pgTable("workspace_baseline", {
  id: text("id").primaryKey(),
  verification: jsonb("verification").$type<VerificationRecords>().notNull(),
  history: jsonb("history").$type<readonly ({
  at: string;
  actor: string;
  title: string;
  note: string;
  record?: BracketRecord;
})[]>().notNull(),
});

export type RecordEvent = (typeof workspaceBaseline.$inferSelect["history"])[number];

export const workspaceRecords = pgTable("workspace_records", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<RecordEntry["kind"]>().notNull(),
  recordedAt: recordedTime(),
  data: jsonb("data").$type<RecordEntry>().notNull(),
});

export const verificationReviews = pgTable("verification_reviews", {
  id: text("id").primaryKey(),
  recordedAt: recordedTime(),
  data: jsonb("data").$type<EvidenceReview>().notNull(),
});

// Acceptance

export const acceptanceChecks = pgTable("acceptance_checks", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<AcceptanceDefinition>().notNull(),
});

export type ArchivedPair = NonNullable<AcceptanceDefinition["comparison"]> & { runId: string; rerunId: string; requirementId: string };

export const evidence = pgTable(
  "acceptance_evidence",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id").notNull(),
    ...unitEdition(),
    revision: text("revision").notNull(),
    mark: text("mark").notNull(),
    interval: jsonb("interval").$type<{ start: number; end: number }>(),
    archive: jsonb("archive").$type<ArchivedPair>(),
    imported: boolean("imported").notNull().default(false),
    source: text("source").notNull(),
    observation: text("observation").notNull(),
    recordedAt: recordedTime(),
  },
  (row) => [index("acceptance_evidence_scope").on(row.checkId, row.serial, row.revisionId, row.recordedAt)],
);

export const decisions = pgTable("acceptance_decisions", {
  id: text("id").primaryKey(),
  evidenceId: text("evidence_id")
    .notNull()
    .unique()
    .references(() => evidence.id),
  decision: text("decision", { enum: ["Approved", "On hold"] }).notNull(),
  reason: text("reason").notNull(),
  reviewer: text("reviewer").notNull().default("Quality assurance"),
  recordedAt: recordedTime(),
});

// People and assignments

export const users = pgTable("users", {
  id: text("id").$type<ReviewRole | "research-partner">().primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().unique(),
  position: integer("position").notNull(),
});

function requiredUser<Name extends string>(name: Name) {
  return text(name).notNull().references(() => users.id);
}

export const workItems = pgTable("work_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  assigneeId: requiredUser("assignee_id").$type<ReviewRole>(),
  waitingUserIds: text("waiting_user_ids").$type<ReviewRole>().array().notNull().default([]),
  reason: text("reason").notNull(),
  href: text("href").notNull(),
  actionLabel: text("action_label").notNull(),
  priority: text("priority", { enum: ["urgent", "follow_up", "routine"] }).notNull(),
  method: text("method").$type<VerificationTest>().notNull(),
  ...unitEdition(),
  evidenceIds: text("evidence_ids").array().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
});

// Immutable delivery packet versions and scoped Engineering review assignments.
export type PacketScope = {reference?:string; projectId?:string; caseId:string; edition:string; versionId:string; acknowledgement:string};
export type PacketContents = RecordUnit & {
  scopes?: PacketScope[];
  builds: { id: string; title: string; reference?: string }[];
  inspections: { checkId: string; requirementId: string; evidenceId: string; source: string; capturedAt: string; decisionId: string; reviewer: string; decidedAt: string }[];
};

export const deliveryPackets = pgTable("delivery_packets", {
  id: text("id").primaryKey(),
  ...unitEdition(),
  version: integer("version").notNull(),
  signedBy: requiredUser("signed_by"),
  signedAt: historyTime("signed_at"),
  contents: jsonb("contents").$type<PacketContents>().notNull(),
});

export const packetResponses = pgTable("packet_responses", {
  packetId:text("packet_id").primaryKey().references(() => deliveryPackets.id),
  outcome:text("outcome",{enum:["Accepted","Returned"]}).notNull(),
  receivedFrom:text("received_from").notNull(),
  reference:text("reference").notNull(),
  recordedBy:requiredUser("recorded_by"),
  recordedAt:historyTime("recorded_at"),
});

export const revisionReviews = pgTable("revision_reviews", {
  id: text("id").primaryKey(),
  changeId: text("change_id").notNull(),
  ...unitEdition(),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  owner: requiredUser("owner"),
  reason: text("reason").notNull(),
  createdAt: historyTime("created_at"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  conclusion: text("conclusion"),
});

export const inspectionFindings = pgTable("inspection_findings", {
  id: text("id").primaryKey(),
  checkId: text("check_id").notNull().references(() => acceptanceChecks.id),
  ...unitEdition(),
  archiveId: text("archive_id").notNull(),
  archive: jsonb("archive").$type<ArchivedPair>(),
  first: integer("first_frame").notNull(),
  last: integer("last_frame").notNull(),
  issueId: assemblyId("issue_id"),
  decisionId: text("decision_id").references(() => decisions.id),
  observation: text("observation").notNull(),
  createdAt: historyTime("created_at"),
});

// Production planning. A reservation occupies one working day for one person and one station.
export type Reservation = { task: string; day: string; person: string; station: string };
export type DeliveryDate = { checkId: string; day: string; forecast: string | null };

export const planningStations = pgTable("planning_stations", {
  id: text("id").primaryKey(), name: text("name").notNull(), capacity: integer("capacity").notNull(),
  closed: text("closed").array().notNull(),
});
export const planningTasks = pgTable("planning_tasks", {
  id: text("id").primaryKey(), title: text("title").notNull(), checkId: text("check_id").notNull().references(() => acceptanceChecks.id),
  after: text("after_task"), gate: text("gate", {enum:["issue","engineering","qa"]}), issueId: assemblyId("issue_id"),
  day: text("day").notNull(), person: requiredUser("person"),
  station: text("station").notNull().references(() => planningStations.id), stations: text("stations").array().notNull(),
});
export const planScenarios = pgTable("plan_scenarios", {
  id: text("id").primaryKey(), title: text("title").notNull(), baseVersion: integer("base_version").notNull(),
  slots: jsonb("slots").$type<Reservation[]>().notNull(),
  savedAt: historyTime("saved_at"),
});
export const publishedPlans = pgTable("published_plans", {
  version: integer("version").primaryKey(), scenario: text("scenario").notNull().references(() => planScenarios.id),
  publishedAt: historyTime("published_at"),
  dates: jsonb("dates").$type<DeliveryDate[]>().notNull(),
});

// Source dossiers, decision ledger, and the assignments created by those decisions.
export const toolCases = pgTable("tool_cases", {
  id: text("id").primaryKey(),
  tool: text("tool").$type<ToolId>().notNull(),
  title: text("title").notNull(),
  unit: jsonb("unit").$type<RecordUnit>(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
});
export const toolDecisions = pgTable("tool_decisions", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => toolCases.id),
  tool: text("tool").$type<ToolId>().notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  actor: requiredUser("actor"),
  at: historyTime("at"),
  data: jsonb("data").$type<Record<string,unknown>>().notNull(),
});
export const toolAssignments = pgTable("tool_assignments", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => toolDecisions.id),
  caseId: text("case_id").notNull().references(() => toolCases.id),
  tool: text("tool").$type<ToolId>().notNull(),
  title: text("title").notNull(),
  owner: requiredUser("owner"),
  section: text("section").$type<Section>().notNull(),
  unit: jsonb("unit").$type<RecordUnit>(),
  selection: text("selection").$type<ItemSelection>(),
  sourceId: text("source_id").notNull(),
  completedAt: timestamp("completed_at",{withTimezone:true,mode:"string"}),
  completedBy:text("completed_by").references(() => toolDecisions.id),
});

// Append-only document editions and the exact field a reviewer compared.
type DesignTarget = { id: string; section: "engineering" | "production"; title: string };
export const designEditions = pgTable("design_editions", {
  id: text("id").primaryKey(),
  recordId: assemblyId("record_id").notNull(),
  ...unitEdition(),
  position: integer("position").notNull(),
  label: text("label").notNull(),
  source: text("source").notNull(),
  fields: jsonb("fields").$type<{ key: string; label: string; value: string }[]>().notNull(),
  targets: jsonb("targets").$type<DesignTarget[]>().notNull(),
  figure: jsonb("figure").$type<{
    src: string; alt: string; width: number; height: number; registrationId?: string;
    regions: { fieldKey: string; x: number; y: number; width: number; height: number }[];
  }>(),
}, (row) => [uniqueIndex("design_edition_order").on(row.recordId, row.serial, row.revisionId, row.position)]);

export const designFindings = pgTable("design_findings", {
  id: text("id").primaryKey(),
  recordId: assemblyId("record_id").notNull(),
  ...unitEdition(),
  priorId: text("prior_id").notNull().references(() => designEditions.id),
  currentId: text("current_id").notNull().references(() => designEditions.id),
  fieldKey: text("field_key").notNull(),
  targetId: assemblyId("target_id").notNull(),
  observation: text("observation").notNull(),
  actor: requiredUser("actor"),
  basis: jsonb("basis").$type<{ label: string; before: string | null; after: string | null; target: DesignTarget }>().notNull(),
  createdAt: historyTime("created_at"),
}, (row) => [index("design_finding_target").on(row.targetId, row.serial, row.revisionId)]);

// Archived inspections and model validation

export const inspectionRuns = pgTable("inspection_runs", {
  id: text("id").primaryKey(),
  checkId: text("check_id")
    .notNull()
    .references(() => acceptanceChecks.id),
  digest: text("digest").notNull(),
  data: jsonb("data").$type<Omit<InspectionRun, "id" | "checkId">>().notNull(),
});

export type AnalysisBasis = AnalysisSetup & {
  editions: { id: string; digest: string }[];
  metric: "caption-luma-v1";
};
export const inspectionAnalyses = pgTable("inspection_analyses", {
  findingId: text("finding_id")
    .primaryKey()
    .references(() => inspectionFindings.id),
  sourceId: text("source_id")
    .notNull()
    .references(() => inspectionRuns.id),
  comparisonId: text("comparison_id")
    .notNull()
    .references(() => inspectionRuns.id),
  controlId: text("control_id").references(() => inspectionRuns.id),
  actor: requiredUser("actor"),
  basis: jsonb("basis").$type<AnalysisBasis>().notNull(),
  samples: jsonb("samples").$type<AlignedSample[]>().notNull(),
});

export const validationStudies = pgTable("validation_studies", {
  id: text("id").primaryKey(),
  supersedesId: text("supersedes_id").unique().references((): AnyPgColumn => validationStudies.id),
  recordId: assemblyId("record_id").notNull(),
  ...unitEdition(),
  modelEditionId: text("model_edition_id").notNull(),
  archive: jsonb("archive").$type<StudyArchive>().notNull(),
}, table => [unique().on(table.recordId, table.serial, table.revisionId, table.modelEditionId)]);

export const validationJudgments = pgTable("validation_judgments", {
  id: uuid("id").primaryKey(),
  studyId: text("study_id").notNull().references(() => validationStudies.id),
  decision: text("decision").$type<ValidationDecision>().notNull(),
  observation: text("observation").notNull(),
  actor: requiredUser("actor"),
  createdAt: historyTime("created_at"),
  basis: jsonb("basis").$type<{
    sourceDigest: string;
    edition?: Pick<typeof validationStudies.$inferSelect & StudyArchive, "serial" | "revisionId" | "recordId" | "modelEditionId" | "unit" | "quantity" | "title" | "source">;
    condition: ValidationCondition;
    selected: ValidationRow[];
  }>().notNull(),
});

// A saved Operations finding keeps the actual inputs the reviewer saw, even after a new edition is filed.
export const operationsStudyFindings = pgTable("operations_study_findings", {
  id: uuid("id").primaryKey(),
  study: text("study").$type<StudyId | "fleet">().notNull(),
  edition: text("edition").notNull(),
  subject: text("subject").notNull(),
  source: jsonb("source").$type<{ label: string; scope?: StudyScope }>().notNull(),
  first: integer("first_sample").notNull(),
  last: integer("last_sample").notNull(),
  outcome: text("outcome").notNull(),
  note: text("note").notNull(),
  recordedAt: historyTime("recorded_at"),
}, row => [index("operations_study_findings_history").on(row.study, row.recordedAt, row.id)]);

// A file's immutable bytes can be referenced by several catalog revisions.
export const designFiles = pgTable("design_files", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<"drawing" | "model">().notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
});
export const revisionFiles = pgTable("revision_files", {
  revisionKind: text("revision_kind").default("revisions").notNull(),
  revisionId: text("revision_id").notNull(),
  fileId: text("file_id").notNull().references(() => designFiles.id),
}, table => [primaryKey({columns: [table.revisionId, table.fileId]})]);
