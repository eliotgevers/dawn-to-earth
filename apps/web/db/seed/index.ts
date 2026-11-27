import {
  seedPublicArchive, seedPlanningScenarios, seedRevisionFiles, seedMaterialRegisters,
  mergeCatalogEntry, mergeEvidence, publishedCopy, priorDefaults, attachUnreviewedOasis, verifyStudyEditions,
} from "./preserve";
import type { CatalogEntry } from "@/components/catalog/store";
import { methodIds, reviewRecord } from "@/components/verification/model";
import {
  auroraCalendar, auroraFlightComments, auroraServices, auroraServiceFilings, auroraServiceDocuments,
  planningStations, planningTasks, validationStudies, inspectionRuns, acceptanceChecks, assemblyRecords,
  catalogEntries, designEditions, engineeringWork, verificationReviews, workItems, workspaceBaseline, toolCases,
} from "../schema";
import { isDeepStrictEqual } from "node:util";
import source from "./records.json";
import { validateSeed } from "./validate";
import { catalogRows } from "../catalog";
import { fileURLToPath } from "node:url";
import { db, writeTransaction } from "../connection";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { reviewWorkChange } from "../records/work";
import { migrate } from "drizzle-orm/postgres-js/migrator";

if (!db) throw new Error("Set DATABASE_URL before migrating.");

try {
  const seed = validateSeed(source);
  const cases = seed.toolCases;
  const runRows = seed.inspectionRuns;

  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations/", import.meta.url)) });
  await writeTransaction(db, async tx => {
    await seedPublicArchive(tx);
    const { comments, documents, services, calendar } = seed.aurora;
    if (comments.length) await tx.insert(auroraFlightComments).values(comments).onConflictDoNothing();
    if (documents.length) await tx.insert(auroraServiceDocuments).values(documents).onConflictDoNothing();
    if (services.length) {
      const created = await tx.insert(auroraServices).values(services.map(row => row.task)).onConflictDoNothing()
        .returning({ id: auroraServices.id });
      const ids = new Set(created.map(row => row.id));
      const filings = services.flatMap(({ filing }) => filing && ids.has(filing.serviceId) ? [filing] : []);
      if (filings.length) await tx.insert(auroraServiceFilings).values(filings);
    }
    if (calendar.length) await tx.insert(auroraCalendar).values(calendar).onConflictDoNothing();

    const { acceptanceChecks: checks = [], ...verification } = seed.verification;
    const initialized = await tx.insert(workspaceBaseline).values({
      id: "dawn-to-earth", verification, history: seed.bracketEvents,
    }).onConflictDoNothing().returning({ id: workspaceBaseline.id });
    const catalog = catalogRows(seed.catalog);
    const inserted = await tx.insert(assemblyRecords).values([...seed.assembly.values()])
      .onConflictDoNothing().returning({ id: assemblyRecords.id });
    if (checks.length) await tx.insert(acceptanceChecks).values(checks.map((data) => ({ id: data.id, data }))).onConflictDoNothing();
    if (initialized.length) {
      await tx.insert(catalogEntries).values(catalog);
    } else {
      // A live workspace may have renamed, moved or archived its catalog units.
      await tx.insert(catalogEntries).values(catalog.filter(row => row.kind === "units")).onConflictDoNothing();
      const newWork = new Set(inserted.map(row => row.id));
      const changed = await tx.execute<{ kind: string; id: string; data: CatalogEntry; curated: CatalogEntry }>(sql`
        SELECT c.kind, c.id, c.data, incoming.data AS curated FROM catalog_entries c
        JOIN jsonb_populate_recordset(NULL::catalog_entries, ${JSON.stringify(catalog)}::jsonb) incoming USING (kind, id)
        WHERE c.data <> incoming.data FOR UPDATE OF c`);
      const catalogChanges = changed.flatMap(({ kind, id, data, curated }) => {
        const key = kind + ":" + id;
        const updated = publishedCopy("catalog", key, data) ? curated : mergeCatalogEntry(data, priorDefaults.catalogEdits[key], curated, newWork);

        return isDeepStrictEqual(updated, data) ? [] : [{ kind, id, data: updated }];
      });
      if (catalogChanges.length) await tx.execute(sql`UPDATE catalog_entries c SET data = p.data
        FROM jsonb_populate_recordset(NULL::catalog_entries, ${JSON.stringify(catalogChanges)}::jsonb) p
        WHERE (c.kind, c.id) = (p.kind, p.id)`);

      const priorAssembly = await tx.select({ id: assemblyRecords.id, data: assemblyRecords.data })
        .from(assemblyRecords).where(inArray(assemblyRecords.id, Object.keys(priorDefaults.assembly)));
      const workChanges = priorAssembly.flatMap(({ id, data }) => {
        const updated = seed.assembly.get(id)?.data;

        return updated && !isDeepStrictEqual(data, updated) && publishedCopy("assembly", id, data)
          ? [{ id, data, updated }] : [];
      });
      if (workChanges.length) await tx.execute(sql`UPDATE assembly_records r SET data = p.updated
        FROM jsonb_to_recordset(${JSON.stringify(workChanges)}::jsonb) AS p(id text, data jsonb, updated jsonb)
        WHERE (r.id, r.data) = (p.id, p.data) AND NOT EXISTS (
          SELECT 1 FROM delivery_packets packet, jsonb_array_elements(packet.contents->'builds') AS build
          WHERE build->>'id' = r.id)`);

      const [baseline] = await tx.select({ id: workspaceBaseline.id, verification: workspaceBaseline.verification }).from(workspaceBaseline).where(eq(workspaceBaseline.id, "dawn-to-earth")).for("update");
      const initial = Object.fromEntries(seed.initialReviews.map(review => [review.id, review]));
      const citations = await tx.execute<{ id: string; authored: boolean }>(sql`
        SELECT jsonb_array_elements_text(data->'evidenceIds') AS id,
          data IS DISTINCT FROM (${JSON.stringify(initial)}::jsonb -> (data->>'id')) AS authored
        FROM verification_reviews
        UNION SELECT data #>> '{action,parentId}', true FROM workspace_records WHERE data #>> '{action,parentId}' IS NOT NULL`);
      const retained = new Set(citations.map(row => row.id));
      const authored = new Set(citations.filter(row => row.authored).map(row => row.id));
      const records = { ...baseline.verification.records };
      for (const id of methodIds) {
        records[id] = mergeEvidence(records[id], verification.records[id], retained);
      }
      const catalogEvidence = mergeEvidence(baseline.verification.catalogEvidence ?? [], verification.catalogEvidence ?? [], retained, authored);
      const merged = { ...baseline.verification, records, catalogEvidence };
      if (!isDeepStrictEqual(merged, baseline.verification)) await tx.update(workspaceBaseline)
        .set({ verification: merged }).where(eq(workspaceBaseline.id, baseline.id));
    }

    // Attach artwork only to the exact original edition, preserving later editions and edits.
    await tx.insert(designEditions).values(seed.designEditions).onConflictDoUpdate({
      target: designEditions.id,
      set: { figure: sql`excluded.figure` },
      setWhere: sql`(${designEditions.figure} is null or
        (not (${designEditions.figure} ? 'registrationId') and ${designEditions.figure} = excluded.figure - 'registrationId')) and
        (to_jsonb(${designEditions}) - 'figure') = (to_jsonb(excluded) - 'figure')`,
    });
    if (seed.validationStudies.length) {
      const byId = new Map(seed.validationStudies.map(study => [study.id, study]));
      await tx.insert(validationStudies).values(seed.validationStudies).onConflictDoNothing();
      const saved = await tx.select().from(validationStudies).where(inArray(validationStudies.id, [...byId.keys()]));
      if (saved.some(study => !isDeepStrictEqual(study, byId.get(study.id))))
        throw Error("A changed model or source archive requires a new edition ID.");
    }
    await tx.insert(inspectionRuns).values(runRows).onConflictDoNothing();
    const [changed] = await tx.execute<{ id: string }>(sql`SELECT incoming.id
      FROM jsonb_to_recordset(${JSON.stringify(runRows.map(({ id, digest }) => ({ id, digest })))}::jsonb) AS incoming(id text, digest text)
      LEFT JOIN inspection_runs saved USING (id) WHERE saved.digest IS DISTINCT FROM incoming.digest LIMIT 1`);
    if (changed) throw Error("Changed measurements require a new edition ID: " + changed.id);

    await tx.insert(planningStations).values(seed.planning.stations).onConflictDoNothing();
    await tx.insert(planningTasks).values(seed.planning.tasks).onConflictDoNothing();
    await seedPlanningScenarios(tx);

    // Restore missing released steps from the same traveler edition before checking the exact retitle basis.
    await tx.execute(sql`UPDATE tool_cases c SET data = jsonb_set(c.data, '{steps}', t.data->'steps')
      FROM jsonb_populate_recordset(NULL::tool_cases, ${JSON.stringify(cases.traveler)}::jsonb) t
      WHERE c.id = t.id AND c.tool = t.tool AND c.data->>'edition' = t.data->>'edition'
        AND NOT (c.data ? 'steps') AND jsonb_typeof(t.data->'steps') = 'array'`);
    const stockWithHistory = new Set(seed.materialMovements.map(move => move.caseId));
    const historyRegisters = cases.inventory.filter(record => stockWithHistory.has(record.id));
    await seedMaterialRegisters(tx, historyRegisters, seed.materialMovements);
    await tx.insert(toolCases).values(Object.values(cases).flat().filter(record => !stockWithHistory.has(record.id))).onConflictDoUpdate({
      target: toolCases.id,
      set: { title: sql`excluded.title` },
      setWhere: sql`tool_cases.title = (${JSON.stringify(priorDefaults.toolTitles)}::jsonb ->> excluded.id)
        AND (tool_cases.tool, tool_cases.unit, tool_cases.data)
          IS NOT DISTINCT FROM (excluded.tool, excluded.unit, excluded.data)`,
    });
    await seedRevisionFiles(tx, source.revisionFiles);
    await attachUnreviewedOasis(tx, cases.qualification);
    await verifyStudyEditions(tx, seed.qualificationStudies);
    await tx.insert(verificationReviews).values(seed.initialReviews.map((data) => ({
      id: data.id, recordedAt: new Date(data.recordedAt), data,
    }))).onConflictDoNothing();
    // Keep user edits and decisions. Only the three published assignment fields are eligible for editorial updates.
    await tx.insert(engineeringWork).values(seed.engineeringWork).onConflictDoUpdate({
      target: engineeringWork.recordId,
      set: { next: sql`excluded.next_step`, blocker: sql`excluded.blocker`, decision: sql`excluded.decision` },
      setWhere: sql`(engineering_work.next_step, engineering_work.blocker, engineering_work.decision)
          IS DISTINCT FROM (excluded.next_step, excluded.blocker, excluded.decision)
        AND EXISTS (SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(priorDefaults.workEdits)}::jsonb) AS p("recordId" text, next text, blocker text, decision text, owner text, "requirementId" text)
          WHERE p."recordId" = excluded.record_id
            AND (p.owner IS NULL OR (p.owner, p."requirementId") IS NOT DISTINCT FROM (engineering_work.owner, engineering_work.requirement_id))
            AND (p.next, p.blocker, p.decision)
            IS NOT DISTINCT FROM (engineering_work.next_step, engineering_work.blocker, engineering_work.decision))`,
    });
    // A missing Home task starts with its recorded review history. Existing tasks keep their saved state.
    const taskIds = seed.workItems.map(item => item.id);
    const reviews = await tx.select({ data: verificationReviews.data }).from(verificationReviews)
      .where(sql`(SELECT count(*) FROM work_items WHERE id = ANY(${sql.param(taskIds)}::text[])) < ${taskIds.length}`)
      .orderBy(asc(verificationReviews.recordedAt), asc(verificationReviews.id));
    const findEvidence = (id: string) => reviewRecord(verification, id)?.record;
    const tasks = seed.workItems.map(item => {
      const task = { waitingUserIds: [], completedAt: null, ...item };
      for (const { data } of reviews) Object.assign(task, reviewWorkChange(task, data, findEvidence));

      return task;
    });
    await tx.insert(workItems).values(tasks).onConflictDoUpdate({
      target: workItems.id,
      set: { title: sql`excluded.title` },
      setWhere: sql`work_items.title = (${JSON.stringify(priorDefaults.workTitles)}::jsonb ->> excluded.id)
        AND work_items.title <> excluded.title AND (work_items.serial, work_items.revision_id, work_items.evidence_ids)
          = (excluded.serial, excluded.revision_id, excluded.evidence_ids)`,
    });
  });
  console.log("Workspace migrations and initial records are ready.");
} finally {
  await db.$client.end();
}
