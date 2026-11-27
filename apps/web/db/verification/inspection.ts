import { readActors } from "../records/work";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alignedSamples, validRegion } from "@/lib/evidence/images";
import { inspectionAnalyses, inspectionRuns, type AnalysisBasis, acceptanceChecks, inspectionFindings, users } from "../schema";
import { formText, isRequestId } from "../records/history";
import { archivedPair, acceptsIssueFinding } from "./acceptance";
import { writeTransaction, type WorkspaceDatabase, type Reader } from "../connection";

function registeredRuns(db: Reader) {
  return db.select({ run: inspectionRuns, check: acceptanceChecks.data }).from(inspectionRuns)
    .innerJoin(acceptanceChecks, eq(acceptanceChecks.id, inspectionRuns.checkId));
}

function runEdition({ run, check }: Awaited<ReturnType<typeof registeredRuns>>[number]) {
  const { id, checkId, digest, data } = run;
  const pair = check.comparison;
  const image = pair?.runId === id ? "originalImage" : pair?.rerunId === id ? "repeatImage" : undefined;
  const current = !!(pair?.runId && pair.rerunId && image && check.id === checkId && pair.evidenceId === data.archiveId &&
    check.unit.serial === data.serial && check.unit.revisionId === data.revisionId &&
    pair.frames.length === data.frames.length && pair.frames.every((frame, i) => typeof frame[image] === "string" && frame[image] === data.frames[i].image));

  return { ...data, id, checkId, digest, current, issueId: check.issueId };
}

export async function readInspectionArchive(db: Reader) {
  const rows = await registeredRuns(db).orderBy(asc(inspectionRuns.checkId), asc(inspectionRuns.id));

  return rows.map(runEdition).filter(run => run.current);
}

export async function readInspectionAnalysis(db: Reader, check: string, finding?: string | null) {
  const saved = await db.select({ id: inspectionAnalyses.findingId, actor: users.name, observation: inspectionFindings.observation,
    recordedAt: inspectionFindings.createdAt, basis: inspectionAnalyses.basis, samples: inspectionAnalyses.samples })
    .from(inspectionAnalyses).innerJoin(inspectionFindings, eq(inspectionFindings.id, inspectionAnalyses.findingId))
    .innerJoin(users, eq(users.id, inspectionAnalyses.actor)).where(and(eq(inspectionFindings.checkId, check),
      finding ? eq(inspectionFindings.id, finding) : undefined)).orderBy(desc(inspectionFindings.createdAt));
  if (finding && !saved.length) return { runs: [], saved };
  const historical = new Set(saved.flatMap(row => row.basis.editions.map(edition => edition.id)));
  const rows = await registeredRuns(db).where(finding ? inArray(inspectionRuns.id, [...historical]) : undefined)
    .orderBy(asc(inspectionRuns.id));
  const editions = rows.map(runEdition);
  const browse = !finding && (historical.size > 0 || editions.some(run => run.current && run.checkId === check));
  const runs = editions.filter(run => historical.has(run.id) || (browse && run.current));

  return { runs, saved };
}
export type AnalysisLibrary = Awaited<ReturnType<typeof readInspectionAnalysis>>;

const fail = (error: string, status = 400) => ({ error, status });

export async function saveInspectionAnalysis(db: WorkspaceDatabase, input: Record<string, unknown>) {
  const { checkId, requestId, editions, alignment, shift, region, first, last, actor, channel, target } = input;
  const observation = formText(input.observation);
  if (typeof checkId !== "string" || !isRequestId(requestId) ||
      typeof actor !== "string" || !observation ||
      (typeof target !== "string" || !target) || (channel !== "contrast" && channel !== "mean") ||
      !Array.isArray(editions) || editions.length < 2 || editions.length > 3 ||
      !editions.every(e => e && typeof e.id === "string" && typeof e.digest === "string") ||
      new Set(editions.map(e => e.id)).size !== editions.length || !validRegion(region) ||
      (alignment !== "marker" && alignment !== "start") || typeof shift !== "number" || !Number.isSafeInteger(shift) ||
      typeof first !== "number" || typeof last !== "number" || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      first < 1 || first > last) return fail("Select distinct run editions, a trace, a region and interval, an analyst and an observation.");

  const basis: AnalysisBasis = { metric: "caption-luma-v1", channel, editions: editions.map(({ id, digest }) => ({ id, digest })),
    alignment, shift, region, first, last };

  return writeTransaction(db, async tx => {
    // Finding IDs are shared with ordinary issue findings. Only an exact replay of an existing analysis can reuse one.
    const [prior] = await tx.select({ checkId: inspectionFindings.checkId, observation: inspectionFindings.observation,
      issueId: inspectionFindings.issueId, actor: inspectionAnalyses.actor,
      sameBasis: sql<boolean>`${inspectionAnalyses.basis} = ${JSON.stringify(basis)}::jsonb` })
      .from(inspectionFindings).leftJoin(inspectionAnalyses, eq(inspectionAnalyses.findingId, inspectionFindings.id))
      .where(eq(inspectionFindings.id, requestId));
    if (prior) return prior.sameBasis && prior.actor === actor && prior.checkId === checkId && prior.observation === observation &&
      target === prior.issueId ? { saved: true, id: requestId, status: 200 }
      : fail("This request already identifies another finding.", 409);

    const [registered, [analyst]] = await Promise.all([
      registeredRuns(tx).where(inArray(inspectionRuns.id, basis.editions.map(e => e.id))),
      readActors(tx, actor),
    ]);
    if (!analyst) return fail("Choose a recorded analyst.");
    const ordered = basis.editions.flatMap(({ id, digest }) => {
      const row = registered.find(({run}) => run.id === id && run.digest === digest);

      return row ? [{...runEdition(row), check: row.check}] : [];
    });
    if (ordered.length !== basis.editions.length || ordered.some(run => !run.current))
      return fail("A run edition or its registered archive changed. Reopen the comparison.", 409);
    if (alignment === "marker" && ordered.some(run => !Number.isInteger(run.marker) || run.marker < 1 || run.marker > run.frames.length))
      return fail("A selected run has no recorded alignment marker. Choose First stored frame.");
    const [source, comparison, control] = ordered;
    const check = source.check;
    const archive = archivedPair(check);
    if (!archive || source.checkId !== checkId || !await acceptsIssueFinding(tx, check, target))
      return fail("The source and destination must belong to the selected inspection.", 409);
    const samples = alignedSamples(source, comparison, control, basis, basis);
    if (samples.length !== last - first + 1) return fail("Every selected frame must exist in all compared runs.");
    // The source, destination, interval and unused request ID were checked under this same lock.
    await tx.insert(inspectionFindings).values({
      id: requestId, checkId, serial: source.serial, revisionId: source.revisionId, archiveId: archive.evidenceId,
      archive, first, last, issueId: target, observation,
    });
    await tx.insert(inspectionAnalyses).values({ findingId: requestId, actor: analyst.id, sourceId: source.id,
      comparisonId: comparison.id, controlId: control?.id, basis, samples });

    return { saved: true, id: requestId, status: 201 };
  });
}
