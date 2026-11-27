import { resolveExchange } from "@/components/verification/document-exchanges";
import { bracketRecords, type AssemblyAction, sameUnit, type RecordIdentity, latestRecordEdit, type RecordEntry, type RecordUnit } from "@/lib/records/journal";
import { evidenceReferences, isVerificationTest, methodSources, reviewActor, reviewOptions, reviewScopeOptions, sameReviewScope, type EvidenceRecord, type EvidenceReview, type ReviewTarget, type VerificationRecords, type VerificationTest } from "@/components/verification/model";
import { proofArchiveRecords, measurementEdition, measurementUrl, type RecordedSeries } from "@/components/verification/numeric-series";
import { evidenceRetentionReason, methodEvidence } from "@/components/verification/outcomes";
import { includesUnit, parseSelection, serialFromSelection, unitSelection } from "@/components/workspace/selection";
import { type AssemblyRecordKind, acceptanceChecks, assemblyRecords, inspectionAnalyses, inspectionFindings, toolAssignments, verificationReviews, workspaceBaseline, workspaceRecords } from "../schema";
import { and, desc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { readAcceptanceChecks } from "./acceptance";
import { loadCatalog, loadUnitCatalog, readUnitEdition } from "../catalog";
import { fail, writeTransaction, type Reader, type RecordWriter, type WorkspaceDatabase } from "../connection";
import { actionParent, actionType, formText, readArticle, readCurrentRecords, readReviews, readVerificationBaseline, recordRemovals } from "../records/history";
import { advanceReviewWork, readActors, reviewers } from "../records/work";
import { createHash } from "node:crypto";
import { parseRun } from "@/lib/evidence/bench-recording";
import { recordHref } from "@/lib/records/links";
import { captureStation, stationEdition } from "@/lib/evidence/station";
import { frameEpoch } from "@/lib/evidence/traces";
import { readRecordedEditions, readerConfiguration } from "../operations/traces";
import { isObject } from "../workflows/cases";

// Findings and model judgments cite the original record. A review/handoff link can navigate to it
// but cannot stand in for it. Conflicting archive identities cannot support a new decision.
export async function readOriginalEvidence(db: Reader, ids: readonly string[]) {
  const register = workspaceBaseline.verification;
  const rows = await db.select({
    requested: sql<string>`wanted.id`,
    id: sql<string>`entry->>'id'`,
    title: sql<string>`entry->>'title'`,
    test: sql<VerificationTest>`method`,
    unit: sql<EvidenceRecord["unit"] | null>`entry->'unit'`,
    readOnly: sql<boolean | null>`(entry#>>'{capture,readOnly}')::boolean`,
    content: sql<EvidenceRecord["content"] | null>`entry->>'content'`,
    exchangeArchive: sql<EvidenceRecord["exchangeArchive"] | null>`entry->'exchangeArchive'`,
  }).from(workspaceBaseline).crossJoin(sql`lateral (
    select entry->>'test' as method, entry from jsonb_array_elements(${register}->'catalogEvidence') entry
    union all
    select method, entry from jsonb_each(${register}->'records') as methods(method, entries),
      jsonb_array_elements(entries) entry
  ) as sources`).crossJoin(sql`unnest(${sql.param([...new Set(ids)])}::text[]) as wanted(id)`)
    .where(sql`wanted.id in (entry->>'id', entry#>>'{capture,reviewId}', entry#>>'{capture,handoffId}')
      or entry#>'{capture,priorReviewIds}' ? wanted.id`);
  const originals = new Map<string, typeof rows[number]>();
  for (const [id, matches] of Map.groupBy(rows, row => row.requested)) {
    if (matches.length === 1 && matches[0].id === id && isVerificationTest(matches[0].test)) originals.set(id, matches[0]);
  }

  return originals;
}

// The offline archives rely on registered editions and recorded removals, independent of the workspace's queues and reviews.
export async function readArchiveSources(db: Reader) {
  const [verification, { units, archivedRows = [] }, actions] = await Promise.all([
    readVerificationBaseline(db),
    loadCatalog(db, ["units", "archivedRows"], true),
    db.select({ data: workspaceRecords.data }).from(workspaceRecords).where(and(
      eq(workspaceRecords.kind, "evidence"),
      sql`(${actionType} = 'remove' or ${workspaceRecords.data} ? 'eventFinding' or ${workspaceRecords.data} ? 'benchRun')`,
    )),
  ]);
  const source = (test: string, { id, unit, exchangeArchive, numericSeries }: EvidenceRecord) =>
    ({ test, id, unit, exchangeArchive, numericSeries });
  const records = verificationEvidence(proofArchiveRecords(verification), actions.flatMap(({ data }) => data.benchRun ? [data] : []));

  return {
    units: units.map(({ serial, configurations }) => ({ serial, configurations })),
    archivedUnits: archivedRows.filter(row => row.entity === "unit").map(row => row.id),
    sources: [
      ...Object.entries(records).flatMap(([test, rows]) => rows.map(row => source(test, row))),
      ...(verification.catalogEvidence ?? []).map(row => source(row.test, row)),
    ],
    activity: actions.filter(row => !row.data.benchRun).map(({ data: { kind, test, action, eventFinding } }) => {
      const entry = { kind, test, action, eventFinding };
      if (!eventFinding || test !== "communication" || action?.type !== "note") return entry;
      const { archive, basis } = eventFinding;
      try {
        return { ...entry, matchesSource: isObject(basis) && !!resolveExchange(archive, basis) };
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;

        return { ...entry, matchesSource: false };
      }
    }),
  };
}

export async function readEvidenceIndex(db: Reader) {
  const data = workspaceBaseline.verification;
  // A destination and a decision need the evidence identity, scope, and review, never its archive or recorded measurements.
  const summaries = <T>(entries: SQL) => sql<T>`(select coalesce(jsonb_agg(
    (entry - array['numericSeries','exchangeArchive','supports','content','relatedEvidenceIds'])
      || jsonb_strip_nulls(jsonb_build_object('reference', entry#>>'{exchangeArchive,id}')) order by n
  ), '[]'::jsonb) from jsonb_array_elements(${entries}) with ordinality as r(entry,n))`;
  const [[summary], checks] = await Promise.all([
    db.select({
      bracketEvents: workspaceBaseline.history,
      article: sql<VerificationRecords["article"]>`${data}->'article'`,
      records: sql<VerificationRecords["records"]>`(select jsonb_object_agg(method, ${summaries(sql`entries`)})
        from jsonb_each(${data}->'records') as methods(method,entries))`,
      catalogEvidence: summaries<NonNullable<VerificationRecords["catalogEvidence"]>>(sql`${data}->'catalogEvidence'`),
      review: sql<VerificationRecords["groundFiringFixture"]["review"]>`${data}#>'{groundFiringFixture,review}'`,
    }).from(workspaceBaseline).limit(1),
    readAcceptanceChecks(db),
  ]);
  if (!summary) throw new Error("Workspace has not been initialized");

  return { ...summary, acceptanceChecks: checks };
}

// The method register holds current evidence. Notes, removals and recorded findings keep their original journal entries.
function verificationEvidence(baseline: VerificationRecords["records"], authored: readonly RecordEntry[]) {
  const records = { ...baseline };
  for (const [test, rows] of Map.groupBy(authored, row => row.test)) {
    if (!test) continue;
    records[test] = [...records[test], ...rows.map(({id, title, evidenceType, description, context, recordedAt, unit, benchRun}) => ({
      id, title, authored: true as const, type: evidenceType ?? "Note", observation: description, source: context, recordedAt, unit,
      ...(benchRun && { importedRun: true as const, numericSeries: benchRun.companion ? [benchRun.series, benchRun.companion] : [benchRun.series], relatedEvidenceIds: [benchRun.sourceId] }),
    }))];
  }

  return records;
}

export async function readVerificationWorkspace(db: Reader) {
  const [catalog, verification, checks, journal, reviews, actors, findings, toolTasks] = await Promise.all([
    loadCatalog(db),
    readVerificationBaseline(db),
    readAcceptanceChecks(db),
    readCurrentRecords(db, or(eq(workspaceRecords.kind, "evidence"), and(eq(workspaceRecords.kind, "issue"), eq(actionType, "edit")))),
    readReviews(db), readActors(db),
    db.select({...getTableColumns(inspectionFindings), analysisId: inspectionAnalyses.findingId})
      .from(inspectionFindings).leftJoin(inspectionAnalyses, eq(inspectionAnalyses.findingId, inspectionFindings.id))
      .orderBy(desc(inspectionFindings.createdAt)),
    db.select().from(toolAssignments).where(and(eq(toolAssignments.section, "verification"), isNull(toolAssignments.completedAt))),
  ]);
  const records = verificationEvidence(proofArchiveRecords(verification), journal.records);

  const ids = new Set([
    ...Object.values(bracketRecords).map(record => record.id),
    ...(verification.catalogEvidence ?? []).flatMap(row => [row.requirement.id, row.build.id]),
    ...checks.flatMap(row => [row.buildId, row.issueId, row.changeId, row.interfaceId, row.requirementId]),
    ...findings.flatMap(row => [row.archive?.requirementId, row.issueId]),
  ].filter((id): id is string => Boolean(id)));
  const { data } = assemblyRecords;
  const cited = await db.select({
    id: assemblyRecords.id, section: assemblyRecords.section,
    kind: sql<AssemblyRecordKind>`${data}->>'kind'`,
    reference: sql<string>`${data}->>'reference'`,
    title: sql<string>`${data}->>'title'`,
    unit: sql<RecordIdentity["unit"] | null>`${data}->'unit'`,
    designKind: sql<"interface" | null>`${data}->>'designKind'`,
  }).from(assemblyRecords).where(inArray(assemblyRecords.id, [...ids]));
  const targets = Object.fromEntries(cited.map(({ unit, designKind, ...row }) => [
    row.id, { ...row, unit: unit ?? undefined, designKind: designKind ?? undefined,
      title: latestRecordEdit(journal.history, row.id, unit ?? verification.article)?.title ?? row.title },
  ]));

  return {
    findings, toolTasks, records: {catalog, verification: {...verification, records, acceptanceChecks: checks}}, actors, users: reviewers(actors),
    targets,
    evidenceHistory: journal.history.filter(row => row.kind === "evidence"), reviews,
  };
}

// A replacement inherits the original request on the same unit edition.
function evidenceIds(ids: readonly string[], verification?: VerificationRecords, test?: VerificationTest) {
  if (!verification || !test) return ids;
  const captures = methodSources(verification, test).filter(record => record.capture);
  const requested = new Set(ids);
  const cited = captures.filter(record => evidenceReferences(record).some(id => requested.has(id)));
  const family = captures.filter(record => cited.some(source => source === record || sameUnit(source.unit, record.unit)));

  return [...new Set([...ids, ...family.flatMap(evidenceReferences)])];
}

function reviewsForEvidence(db: Reader, ids: readonly string[]) {
  return readReviews(db, sql`(${verificationReviews.data}->'evidenceIds') ?| ${sql.param(ids)}::text[]`);
}

// An archival source can receive notes, but its observations cannot be edited as authored evidence.
export async function checkEvidenceAction(
  db: Reader, { type, parentId, unit }: AssemblyAction, test: VerificationTest | undefined,
  authored: RecordEntry | undefined, history: readonly RecordEntry[],
) {
  if (!test || (authored && (authored.kind !== "evidence" || authored.test !== test)))
    return fail("Choose evidence from this method.");

  const baseline = authored ? undefined : await readVerificationBaseline(db);
  const changesEvidence = type === "edit" || type === "remove";
  const reviews = baseline || changesEvidence ? await reviewsForEvidence(db, evidenceIds([parentId], baseline, test)) : [];
  const source = baseline && methodEvidence(baseline, test, reviews, []).find(row => row.record.id === parentId)?.record;
  if (!authored && !source) return fail("The linked record has changed.");
  const owner = authored?.unit ?? source?.unit ?? baseline?.article ?? await readArticle(db);
  if (!sameUnit(unit, owner)) return fail("The linked record has changed.");
  if (!changesEvidence) return;
  if (type === "edit" && source) return fail("The source evidence is read-only.");

  const { id: checkId, data: checkData } = acceptanceChecks;
  const { id: runId, data: runData } = workspaceRecords;
  const [checks, runs] = await Promise.all([
    db.select({ id: checkId }).from(acceptanceChecks)
      .where(eq(sql`${checkData}#>>'{comparison,evidenceId}'`, parentId)).limit(1),
    test === "communication" || test === "leak"
      ? db.select({ id: runId }).from(workspaceRecords)
        .where(eq(sql`${runData}#>>'{benchRun,sourceId}'`, parentId)).limit(1)
      : [],
  ]);
  const retained = evidenceRetentionReason(
    source ?? { id: parentId, importedRun: authored?.benchRun ? true : undefined },
    reviews,
    checks.length > 0,
    history.some(entry => entry.eventFinding && entry.action?.parentId === parentId),
    runs.length > 0,
  );
  if (retained) return fail(retained);
}

function reviewFields(input: unknown) {
  if (!isObject(input) || !isObject(input.scope)) return;
  const { decision, scope } = input;
  const test = input.test;
  const reason = formText(input.reason);
  const selection = typeof scope.selection === "string" ? parseSelection(scope.selection) : null;
  const revision = scope.revision;
  if (!isVerificationTest(test) || !reason || !selection || typeof decision !== "string" ||
    revision !== undefined && typeof revision !== "string") return;

  return { test, decision, reason, scope: { selection, revision } };
}

export async function readReviewCandidates(db: Reader, test: VerificationTest, sourceIds: readonly string[], baseline?: VerificationRecords) {
  const verification = baseline ?? await readVerificationBaseline(db);
  const ids = evidenceIds(sourceIds, verification, test);
  const [journal, decisions] = await Promise.all([
    readCurrentRecords(db, and(eq(workspaceRecords.kind, "evidence"), or(
      inArray(workspaceRecords.id, ids),
      and(inArray(actionType, ["edit", "remove"]), inArray(actionParent, ids)),
    ))),
    reviewsForEvidence(db, ids),
  ]);
  const records = verificationEvidence(verification.records, journal.records);

  return methodEvidence({ ...verification, records }, test, decisions, journal.history)
    .filter(row => sourceIds.includes(row.record.id) || sourceIds.includes(row.id));
}

export async function prepareReview(db: Reader, input: Record<string, unknown>) {
  const fields = reviewFields(input.review);
  if (!fields || !Array.isArray(input.targets)) return fail("Enter a valid review.", 400);
  const targets = new Map<string, string | undefined>();
  for (const target of input.targets) {
    if (!target || typeof target.id !== "string" ||
      target.expectedReviewId !== undefined && typeof target.expectedReviewId !== "string")
      return fail("Invalid review target.", 400);
    if (targets.has(target.id)) return fail("Choose each evidence record only once.", 400);
    targets.set(target.id, target.expectedReviewId);
  }
  const { selection, revision } = fields.scope;
  const serial = selection.startsWith("unit:") ? serialFromSelection(selection) : undefined;
  const [catalog, verification, authors] = await Promise.all([
    serial && revision ? loadUnitCatalog(db, serial, revision) : loadCatalog(db),
    targets.size ? readVerificationBaseline(db) : undefined,
    readActors(db, reviewActor(fields.decision)),
  ]);
  const [target] = reviewScopeOptions(catalog, [serial ? unitSelection(serial, revision) : selection]);
  if (!target) return fail("The review target or revision no longer exists.");
  if (!sameReviewScope(fields.scope, target.scope)) return fail("Enter a valid review.", 400);
  const entry = {
    ...fields, id: crypto.randomUUID(), recordedAt: new Date().toISOString(), evidenceIds: [...targets.keys()],
  };

  let selected: ReviewTarget[] = [];
  if (verification) {
    const rows = await readReviewCandidates(db, entry.test, entry.evidenceIds, verification);
    selected = rows.filter(row => targets.has(row.id) && includesUnit(target.item, row.record.unit));
  }
  const option = reviewOptions(entry.test, selected, entry.scope).find(choice => choice.value === entry.decision);
  if (!option || selected.length !== targets.size || selected.some(({id, latest}) => latest?.id !== targets.get(id)))
    return fail("The record has changed. Check the current handoff and try again.");
  const data: EvidenceReview = { ...entry, decision: option.value, reviewer: authors[0]?.name };
  return { data, selected };
}

export async function saveReview(db: RecordWriter, input: Record<string, unknown>) {
  const prepared = await prepareReview(db, input);
  if ("error" in prepared) return prepared;

  const { data, selected } = prepared;
  await db.insert(verificationReviews).values({ id: data.id, recordedAt: new Date(data.recordedAt), data });
  if (selected.length) await advanceReviewWork(db, data, selected);

  return { saved: true } as const;
}

async function indexRun(method: "communication" | "leak", id: string, unit: RecordUnit, series: RecordedSeries) {
  const { influxUrl, influxWriter } = await readerConfiguration();
  if (!influxWriter || /[\p{Cc}]/u.test(unit.serial + unit.revisionId)) return null;

  const edition = await measurementEdition(method, id, unit, series);
  const escapeTag = (value: string) => value.replace(/[\\ ,=]/g, char => "\\" + char);
  const tags = [
    "evidence_sample",
    "method=" + method,
    "source_id=" + id,
    "serial=" + escapeTag(unit.serial),
    "revision=" + escapeTag(unit.revisionId),
    "series_id=" + series.editionId,
    "edition=" + edition,
  ].join(",");
  const sourceFields = [
    "quantity=" + JSON.stringify(series.quantity),
    "unit=" + JSON.stringify(series.unit),
    "source=" + JSON.stringify(series.source),
  ].join(",");
  const lines = series.points.map((point, index) => {
    const fields = [
      "value=" + point.value,
      `elapsed_ms=${point.elapsedMs}i`,
      `source_row=${index + 1}i`,
      "locator=" + JSON.stringify(point.locator),
      sourceFields,
    ].join(",");

    return `${tags},sample_id=${point.id} ${fields} ${frameEpoch + point.elapsedMs}`;
  });

  const endpoint = `${influxUrl}/api/v2/write?org=dawn-to-earth&bucket=synthetic&precision=ms`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Token " + influxWriter, "Content-Type": "text/plain" },
    body: lines.join("\n"),
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });

  return response.ok ? edition : null;
}

function readBenchCapture(input: Record<string, unknown>) {
  if (input.operation === "file-station-capture") {
    const { method, take, serial, revisionId, edition } = input;
    if ((method !== "communication" && method !== "leak") || (take !== 0 && take !== 1) ||
        typeof serial !== "string" || typeof revisionId !== "string" || edition !== stationEdition || input.returnReviewId !== undefined)
      return fail("Reopen the station and capture a recording for this unit and edition.", 400);

    return { ...captureStation(method, take), method, serial, revisionId } as const;
  }
  const run = parseRun(input);
  if ("error" in run) return run;

  return { ...run, method: "communication" as const, companion: undefined, observation: undefined };
}

export async function fileBenchRun(db: WorkspaceDatabase, input: Record<string, unknown>,
  { includeGrafanaReceipt = false } = {}) {
  const { sourceId, returnReviewId } = input;
  if (typeof sourceId !== "string" || !sourceId || sourceId.length > 180) {
    return fail("Choose a source evidence record.", 400);
  }
  if (returnReviewId !== undefined && (typeof returnReviewId !== "string" || !returnReviewId || returnReviewId.length > 180)) {
    return fail("Choose the recorded follow-up request.", 400);
  }

  const run = readBenchCapture(input);
  if ("error" in run) return run;
  const { title, series, serial, revisionId, method, companion, observation } = run;
  const identity = [sourceId, serial, revisionId, title, series];
  if (companion) identity.push(companion);
  if (returnReviewId) identity.push(returnReviewId);
  const id = "bench-" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");

  const unit = await writeTransaction(db, async tx => {
    const [target, [filedSource], removals] = await Promise.all([
      readUnitEdition(tx, serial, revisionId),
      tx.select({ record: workspaceRecords.data }).from(workspaceRecords).where(eq(workspaceRecords.id, sourceId)),
      recordRemovals(tx, [sourceId, id], serial, revisionId),
    ]);
    const authored = filedSource?.record;
    const source = authored?.kind === "evidence" && !authored.action
      ? authored
      : (await readOriginalEvidence(tx, [sourceId])).get(sourceId);
    if (!target?.registered || target.archived || removals.length || source?.test !== method || !sameUnit(target.unit, source.unit)) {
      return fail("The recording must match active evidence in this method on this exact unit and revision.");
    }
    if (observation && source && "readOnly" in source && source.readOnly) {
      return fail("This historical capture is read-only.");
    }

    const original = authored?.benchRun?.series;
    if (original && returnReviewId) {
      // A retry can repair the projection after the technician has already filed this retest.
      const [alreadyFiled] = await tx.select({ id: workspaceRecords.id }).from(workspaceRecords).where(eq(workspaceRecords.id, id));
      if (alreadyFiled) return target.unit;

      if (original.quantity !== series.quantity || original.unit !== series.unit) {
        return fail("The retest must record the same channel as the returned run.");
      }
      const sameRecording = original.source === series.source &&
        original.points.length === series.points.length &&
        original.points.every((point, i) =>
          point.elapsedMs === series.points[i].elapsedMs && point.value === series.points[i].value);
      if (sameRecording) return fail("This is the original recording. Choose the retest file.");

      const handoff = await saveReview(tx, {
        review: {
          test: "communication",
          scope: { selection: "unit:" + serial, revision: revisionId },
          decision: "Follow-up submitted",
          reason: "Filed retest recording: " + series.source,
        },
        targets: [{ id: sourceId, expectedReviewId: returnReviewId }],
      });
      if ("error" in handoff) return handoff;
    } else if (original || returnReviewId) {
      return fail("Open the returned recording to file its retest.");
    }

    const recordedAt = new Date();
    const range = `${series.points[0].elapsedMs}–${series.points.at(-1)!.elapsedMs} ms`;
    const data: RecordEntry = {
      id,
      title,
      unit: target.unit,
      kind: "evidence",
      test: method,
      evidenceType: method === "leak" ? "Trace" : "Functional check",
      description: observation ?? `${series.points.length} ${series.quantity.toLowerCase()} readings, ${range}.`,
      context: series.source,
      recordedAt: recordedAt.toISOString(),
      benchRun: { sourceId, series, companion, returnReviewId },
    };
    await tx.insert(workspaceRecords).values({ id, kind: data.kind, recordedAt, data }).onConflictDoNothing();

    return target.unit;
  });
  if ("error" in unit) return unit;

  // PostgreSQL owns the evidence; a failed optional projection can be retried against the same edition.
  const traces = companion ? [series, companion] : [series];
  const results = await Promise.all(traces.map(trace => indexRun(method, id, unit, trace).catch(() => null)));
  const indexed = results.every(Boolean);

  const evidenceUrl = recordHref("verification", id, unit, { view: method });
  let grafanaUrl: string | null = null;
  if (includeGrafanaReceipt && !companion && results[0]) {
    const edition = results[0];
    const viewer = await readRecordedEditions("series", [edition]).catch(() => null);
    const data = viewer?.editions.find(row => row.edition === edition);
    if (viewer?.grafana && data && "points" in data) {
      grafanaUrl = measurementUrl(series, edition, data, viewer.grafanaPublicUrl,
        series.points[0].elapsedMs, series.points.at(-1)!.elapsedMs) ?? null;
    }
  }

  return { id, saved: true, indexed, evidenceUrl, grafanaUrl };
}
