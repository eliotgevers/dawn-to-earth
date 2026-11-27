import type records from "./records.json";
import { isRequestId } from "../records/history";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ClaimStudy } from "@/db/workflows/qualification";
import type { ToolId, CaseRow } from "@/db/workflows/cases";
import { pixelBox, type InspectionRun } from "@/lib/evidence/images";
import { requirementApplies } from "@/components/workspace/selection";
import type { Catalog } from "@/components/catalog/store";
import { isRecordUnit, sameUnit } from "@/lib/records/journal";
import { acceptanceArtifacts } from "@/components/verification/acceptance";
import { methodIds, type EvidenceReview, type VerificationRecords } from "@/components/verification/model";
import type { auroraCalendar, auroraServiceDocuments, auroraServiceFilings, auroraServices, AssemblyRecord, RecordEvent, toolDecisions, assemblyRecords, engineeringWork, workItems, planningTasks, planningStations, designEditions, validationStudies } from "../schema";

type SeedAssemblyRecord = Omit<AssemblyRecord, "origin" | "related"> & { buildId?: string };

type AuroraSeed = Pick<typeof records, "publicArchive" | "auroraFlightComments" | "auroraServiceDocuments" | "auroraServices" | "auroraCalendar">;

type FixtureSeed = AuroraSeed & {
  version: 3;
  toolCases: Record<ToolId, CaseRow[]>;
  materialMovements: (typeof toolDecisions.$inferInsert)[];
  planning: { stations: (typeof planningStations.$inferInsert)[]; tasks: (typeof planningTasks.$inferInsert)[] };
  validationStudies: (typeof validationStudies.$inferSelect)[];
  designEditions: (typeof designEditions.$inferInsert)[];
  inspectionRuns: InspectionRun[];
  engineering: SeedAssemblyRecord[];
  production: SeedAssemblyRecord[];
  bracketEvents: readonly RecordEvent[];
  verification: VerificationRecords;
  catalog: Catalog;
  initialReviews: EvidenceReview[];
  workItems: (typeof workItems.$inferInsert)[];
  engineeringWork: (typeof engineeringWork.$inferInsert)[];
};

export function validateSeed(input: unknown) {
  const seed = input as FixtureSeed | null;
  if (seed?.version !== 3 || ![
    seed.materialMovements, seed.initialReviews, seed.workItems, seed.engineeringWork, seed.engineering, seed.production, seed.bracketEvents,
    seed.catalog?.projects, seed.catalog?.systems, seed.catalog?.revisions, seed.catalog?.units,
  ].every(Array.isArray) || !methodIds.every((id) => Array.isArray(seed.verification?.records?.[id])) ||
    !isRecordUnit(seed.verification?.article) || !seed.verification.groundFiringFixture?.review || !seed.verification.proofPressureFixture) {
    throw new Error("Invalid records");
  }

  const stockRegisters = new Map(seed.toolCases.inventory.map(register => [register.id, register.data]));
  for (const movement of seed.materialMovements) {
    const register = stockRegisters.get(movement.caseId);
    if (!register || movement.tool !== "inventory" ||
        register.partId !== movement.data.partId || register.lotId !== movement.data.lotId) {
      throw new Error("Movement does not belong to its stock register: " + movement.id);
    }
  }

  const assembly = new Map<string, typeof assemblyRecords.$inferInsert>();
  const { engineering, production, ...workspace } = seed;
  for (const [section, rows] of [["engineering", engineering], ["production", production]] as const) {
    const kinds = new Set(section === "engineering" ? ["requirement", "configuration", "change"] : ["queue", "build", "issue"]);
    for (const [position, row] of rows.entries()) {
      if (!row || "related" in row || !kinds.has(row.kind) || typeof row.id !== "string" || !row.id ||
          typeof row.title !== "string" || typeof row.reference !== "string" || typeof row.status !== "string" ||
          !Array.isArray(row.fields) || ((section === "production" || row.unit !== undefined) && !isRecordUnit(row.unit))) {
        throw new Error("Invalid records");
      }
      if (assembly.has(row.id)) throw new Error("Duplicate assembly record ID");
      const { buildId, ...record } = row;
      assembly.set(row.id, { id: row.id, section, position, buildId, data: { ...record, origin: "fixture" } });
    }
  }
  const recordById = (id: string) => assembly.get(id)?.data;
  const { records } = seed.verification;
  const catalogEvidence = seed.verification.catalogEvidence ?? [];
  const acceptanceChecks = seed.verification.acceptanceChecks ?? [];
  const ids = new Set<string>();
  for (const group of [...Object.values(records), catalogEvidence]) {
    const originals = new Map(group.map(record => [record.id, record]));
    for (const record of group) {
      if (
        typeof record.id !== "string" ||
        !record.id ||
        typeof record.title !== "string" ||
        !isRecordUnit(record.unit) ||
        ids.has(record.id)
      ) {
        throw new Error("Invalid evidence record");
      }
      ids.add(record.id);
      if (!record.capture) continue;
      const { reviewId, replaces } = record.capture;
      if (typeof reviewId !== "string" || !reviewId) throw new Error("Invalid evidence review ID");
      if (replaces === undefined) continue;
      const original = originals.get(replaces);
      if (replaces === record.id || !original?.capture || !sameUnit(original.unit, record.unit)) {
        throw new Error("Invalid evidence replacement");
      }
    }
  }
  for (const { data: row } of assembly.values()) {
    const seen = new Set<string>();
    for (const { section, id } of row.overviewLinks ?? []) {
      const exists = section === "verification"
        ? ids.has(id)
        : (section === "engineering" || section === "production") && assembly.get(id)?.section === section;
      const key = section + ":" + id;
      if (!exists || seen.has(key)) {
        throw new Error(`Invalid relationship from ${row.id} to ${key}`);
      }
      seen.add(key);
    }
  }
  const catalogById = new Map(catalogEvidence.map((row) => [row.id, row]));
  for (const entry of catalogEvidence) {
    const build = recordById(entry.build.id);
    const requirement = recordById(entry.requirement.id);
    if ((build?.kind !== "build" && build?.kind !== "queue") || !sameUnit(build.unit, entry.unit) ||
        build.title !== entry.build.title || requirement?.kind !== "requirement" ||
        requirement.title !== entry.requirement.title ||
        !requirementApplies(seed.catalog, entry.requirement.id, entry.unit.revisionId, entry.unit)) {
      throw new Error("Evidence destination changed: " + entry.id);
    }
    if (!entry.exchangeArchive) continue;
    for (const id of entry.relatedEvidenceIds ?? []) {
      const source = catalogById.get(id);
      if (!source || !sameUnit(entry.unit, source.unit) || source.requirement.id !== entry.requirement.id || source.build.id !== entry.build.id) {
        throw new Error("Unmatched archive source for " + entry.id);
      }
    }
  }
  for (const review of seed.initialReviews) {
    const valid = review.evidenceIds.length && review.evidenceIds.every((id) => {
      const entry = catalogById.get(id);

      return entry && entry.test === review.test && review.scope?.selection === `unit:${entry.unit.serial}` &&
        review.scope.revision === entry.unit.revisionId;
    });
    if (!valid || !review.reason.trim() || !Number.isFinite(Date.parse(review.recordedAt))) {
      throw new Error("Invalid initial review: " + review.id);
    }
  }
  for (const { buildId, data: record } of assembly.values()) {
    if (!buildId) continue;
    const build = recordById(buildId);
    if (record.kind !== "build" || build?.kind !== "queue" || !sameUnit(record.unit, build.unit)) {
      throw new Error("Invalid build history parent: " + record.id);
    }
  }
  const filled = (value: unknown) => typeof value === "string" && !!value.trim();
  if (!Array.isArray(acceptanceChecks)) throw new Error("Invalid acceptance checks");
  const builds = new Set<string>();
  const checksById = new Set<string>();
  for (const check of acceptanceChecks) {
    if (!check || !isRecordUnit(check.unit)) throw new Error("Invalid acceptance scope");
    const build = recordById(check.buildId);
    if (!check.issueId || !check.interfaceId || !check.changeId) throw new Error("Invalid acceptance check relationships");
    const issue = recordById(check.issueId);
    if (
      ![check.id, check.owner, check.nextAction].every(filled) ||
      (check.artifact !== undefined && !Object.hasOwn(acceptanceArtifacts, check.artifact)) ||
      checksById.has(check.id) ||
      builds.has(check.buildId) ||
      !requirementApplies(seed.catalog, check.requirementId, check.unit.revisionId, check.unit) ||
      (check.initial && ![check.initial.mark, check.initial.source, check.initial.observation].every(filled)) ||
      (build?.kind !== "queue" && build?.kind !== "build") ||
      issue?.kind !== "issue" ||
      !sameUnit(build?.unit, check.unit) ||
      !sameUnit(issue.unit, check.unit) ||
      recordById(check.requirementId)?.kind !== "requirement" ||
      recordById(check.interfaceId)?.designKind !== "interface" ||
      recordById(check.changeId)?.kind !== "change"
    ) {
      throw new Error("Invalid acceptance check relationships");
    }
    builds.add(check.buildId);
    checksById.add(check.id);
  }

  for (const study of seed.validationStudies) validateStudyArchive(study.archive);

  return {
    ...workspace, assembly,
    inspectionRuns: validateInspectionRuns(seed.inspectionRuns),
    qualificationStudies: validateQualificationCases(seed.toolCases.qualification, seed.catalog),
    aurora: validateAurora(seed),
  };
}

// Qualification can apply to a whole design revision or to one article's configured requirement.
// Check the authored source against the catalog before bootstrapping either representation.
function validateQualificationCases(cases: CaseRow[], catalog: Catalog) {
  const byId = new Map(cases.map(row => [row.id, row]));
  const reports = new Set<string>();
  const studies = new Set<CaseRow>();
  for (const dossier of cases) {
    const { requirementId, revisionId, sourceFor } = dossier.data;
    if (typeof sourceFor === "string") {
      const target = byId.get(sourceFor)?.data;
      const edition = JSON.stringify([sourceFor, dossier.data.report]);
      const excerpts = dossier.data.excerpts;
      if (!target || target.sourceFor || !Array.isArray(target.rows) || !dossier.data.report ||
          reports.has(edition) || dossier.data.report === target.report || !excerpts || typeof excerpts !== "object")
        throw Error("Qualification source does not identify a distinct report on this comparison: " + dossier.id);
      reports.add(edition);
      const claims = new Set(target.rows.map(row => row.id));
      for (const [claim, entry] of Object.entries(excerpts)) {
        if (!claims.has(claim)) throw Error("Qualification source cites another claim: " + dossier.id + "/" + claim);
        const study: ClaimStudy | undefined = entry?.study;
        if (!study) continue;
        if (!study.quantity || !study.unit || !study.targetSource || !study.dependency || !study.testedConfiguration ||
            (study.proposedValue !== null && !Number.isFinite(study.proposedValue)) || !Array.isArray(study.samples) ||
            !study.samples.length || study.samples.some(sample => !sample.locator || !["Demonstrated","Exception","Unrecorded"].includes(sample.finding) ||
              (sample.value === null ? sample.finding !== "Unrecorded" : !Number.isFinite(sample.value))))
          throw Error("Qualification source has an unusable observation: " + dossier.id + "/" + claim);
        studies.add(dossier);
      }
      continue;
    }
    if (typeof requirementId !== "string" || typeof revisionId !== "string")
      throw Error("Missing qualification target: " + dossier.id);
    if (!requirementApplies(catalog, requirementId, revisionId, dossier.unit ?? undefined))
      throw Error("Qualification requirement is outside its recorded scope: " + dossier.id);
  }

  return [...studies];
}

// Re-exports can legitimately disagree. Validate identities here; the review classifies contradictory measurements.
function validateStudyArchive(archive: (typeof validationStudies.$inferSelect)["archive"]) {
  const conditions = new Set(archive.conditions.map(condition => condition.id));
  const rows = new Map(archive.rows.map(row => [row.id, row]));
  if (!conditions.size || conditions.size !== archive.conditions.length || rows.size !== archive.rows.length ||
    archive.conditions.some(c => !c.id.trim() || !c.label.trim() || !Number.isInteger(c.requiredOrigins) || c.requiredOrigins < 1))
    throw Error("Invalid condition or repeated model validation row ID");
  for (const row of rows.values()) {
    if (!conditions.has(row.conditionId) || !row.id.trim() || !row.runId.trim() || !row.source.trim() ||
      !Number.isFinite(row.predicted) || !Number.isFinite(row.observed) || (row.copiedFrom && !rows.has(row.copiedFrom)))
      throw Error("Invalid source row: " + row.id);
    const chain = new Set([row.id]);
    let parent = row.copiedFrom;
    while (parent) {
      if (chain.has(parent)) throw Error("Circular export lineage: " + row.id);
      chain.add(parent);
      parent = rows.get(parent)?.copiedFrom ?? null;
    }
  }
}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function validateInspectionRuns(runs: InspectionRun[]) {
  if (new Set(runs.map((r) => r.id)).size !== runs.length) throw Error("Duplicate inspection edition.");

  return runs.map(run => {
    if (
      !run.id ||
      !run.serial ||
      !run.revisionId ||
      !run.frameLayout ||
      !Number.isInteger(run.marker) ||
      run.marker < 1 ||
      run.marker > run.frames.length
    )
      throw Error("Invalid synchronizing marker: " + run.id);
    for (const [i, frame] of run.frames.entries()) {
      const [x, y, w, h] = frame.caption;
      if (
        !/^\/inspection\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(frame.image) ||
        !frame.caption.every(Number.isInteger) ||
        x < 0 ||
        y < 0 ||
        w < 8 ||
        h < 4 ||
        x + w > frame.width ||
        y + h > frame.height ||
        frame.tiles.length !== 32 ||
        !frame.tiles.every(([n, s, q], tile) => {
          const [, , width, height] = pixelBox(frame, [tile % 8, Math.floor(tile / 8), 1, 1]);

          return (
            n === width * height &&
            Number.isSafeInteger(s) &&
            Number.isSafeInteger(q) &&
            s >= 0 &&
            q >= 0 &&
            s <= n * 255 &&
            q <= n * 255 * 255 &&
            q * n >= s * s
          );
        })
      )
        throw Error("Invalid pixel measurement: " + run.id + " frame " + (i + 1));
      const image = readFileSync(new URL("../../public" + frame.image, import.meta.url));
      if (sha256(image) !== frame.sha256)
        throw Error("Archived image differs from its measured edition: " + frame.image);
    }
    const { id, checkId, ...data } = run;

    return { id, checkId, data, digest: sha256(JSON.stringify(run)) };
  });
}

function validateAurora(source: AuroraSeed) {
  const ids = new Set(source.publicArchive.flights.filter(flight => flight.kind === "flight").map(flight => flight.id));
  const comments = source.auroraFlightComments;
  for (const row of comments) {
    if (!row.example || !isRequestId(row.id) || !ids.has(row.flightId) || !row.body.trim() || !row.author?.trim())
      throw Error("Invalid sample flight comment: " + row.id);
  }

  const documents = source.auroraServiceDocuments.map((row): typeof auroraServiceDocuments.$inferInsert => {
    const kind = row.kind;
    if (!ids.has(row.flightId) || (kind !== "Inspection" && kind !== "Repair" && kind !== "Return to service"))
      throw Error("Invalid service document: " + row.id);

    return { ...row, kind };
  });

  const services = source.auroraServices.map(row => {
    if (!row.example || !ids.has(row.flightId) || (row.status !== "Open" && row.status !== "Completed"))
      throw Error("Invalid sample service record: " + row.id);
    const { category } = row;
    if (category !== undefined && category !== "Scheduled" && category !== "Unscheduled")
      throw Error("Invalid service category: " + row.id);
    const filingRefs: Pick<typeof auroraServiceFilings.$inferInsert, "evidenceId" | "returnRecordId"> = row;
    for (const [id, release] of [[filingRefs.evidenceId, false], [filingRefs.returnRecordId, true]] as const) {
      if (id && !documents.some(doc => doc.id === id && doc.flightId === row.flightId && (doc.kind === "Return to service") === release))
        throw Error("Invalid service document link: " + id);
    }

    const task: typeof auroraServices.$inferInsert = { ...row, status: row.status };
    const filing: typeof auroraServiceFilings.$inferInsert | null = category ? {
      serviceId: row.id, category, dueOn: row.dueOn, evidenceId: filingRefs.evidenceId,
    } : null;

    return { task, filing };
  });

  const calendar = source.auroraCalendar.map((row): typeof auroraCalendar.$inferInsert => {
    if (!row.example || (row.kind !== "Flight" && row.kind !== "Preparation" && row.kind !== "Service" && row.kind !== "Appointment") || (row.status !== "Tentative" && row.status !== "Confirmed"))
      throw Error("Invalid sample calendar entry: " + row.id);
    return { ...row, status: row.status, kind: row.kind };
  });

  return { comments, documents, services, calendar };
}
