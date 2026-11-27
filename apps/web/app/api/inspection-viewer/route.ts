import { inArray, sql } from "drizzle-orm";
import { readDatabase } from "@/db/http";
import { inspectionRuns } from "@/db/schema";
import { readRecordedEditions, readTraceDashboard } from "@/db/operations/traces";
import { frameEpoch } from "@/lib/evidence/traces";

const identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const digest = /^[a-f0-9]{64}$/;
const fromBucket =
  'from(bucket: "synthetic") |> range(start: 2026-01-01T00:00:00Z, stop: 2026-01-02T00:00:00Z)';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const modes = ["run", "exchange", "series"].filter((key) => params.has(key));
  const mode = modes[0];
  const ids = [...new Set(params.getAll(mode))];
  const exactEdition = /^[A-Za-z0-9_.:-]{1,160}~[a-f0-9]{64}$/;
  const valid = (id: string) =>
    mode === "series"
      ? exactEdition.test(id)
      : identifier.test(id) || (mode === "exchange" && exactEdition.test(id));
  if (modes.length !== 1 || !ids.length || ids.length > 3 || !ids.every(valid)) {
    return Response.json({ error: "Choose up to three archived runs from one dashboard." }, { status: 400 });
  }
  if (mode === "exchange" || mode === "series") {
    return Response.json(await readRecordedEditions(mode, ids), { headers: { "Cache-Control": "no-store" } });
  }
  return readDatabase(async (database) => {
    const editions = await database
      .select({
        id: inspectionRuns.id,
        digest: inspectionRuns.digest,
        checkId: inspectionRuns.checkId,
        archiveId: sql<string>`${inspectionRuns.data}->>'archiveId'`,
        serial: sql<string>`${inspectionRuns.data}->>'serial'`,
        revisionId: sql<string>`${inspectionRuns.data}->>'revisionId'`,
        hashes: sql<string[]>`jsonb_path_query_array(${inspectionRuns.data}, '$.frames[*].sha256')`,
      })
      .from(inspectionRuns)
      .where(inArray(inspectionRuns.id, ids));
    const filter =
      editions
        .filter((row) => identifier.test(row.id) && digest.test(row.digest))
        .map((row) => 'r.edition == "' + row.id + "~" + row.digest + '"')
        .join(" or ") || "false";
    const flux = `${fromBucket}
      |> filter(fn: (r) => r._measurement == "inspection_frame" and (${filter}))
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> filter(fn: (r) => exists r.image_sha and exists r.frame and exists r.caption_mean and exists r.caption_contrast)
      |> map(fn: (r) => ({_value: r.edition + "|" + string(v: r.frame) + "|" + r.image_sha + "|" + string(v: uint(v: r._time))}))`;
    const { rows, ...services } = await readTraceDashboard("dte-inspection-frames", flux);
    return {
      ...services,
      editions: editions.map(({ hashes, ...edition }) => {
        const exact = edition.id + "~" + edition.digest;
        const frames = rows.flatMap((row) => {
          const [key, position, sha, ns] = row.split("|");
          const frame = Number(position);
          const ms = frameEpoch + (frame - 1) * 1000;
          return key === exact &&
            digest.test(sha) &&
            hashes[frame - 1] === sha &&
            ns === String(ms) + "000000"
            ? [frame]
            : [];
        });
        return { ...edition, frames };
      }),
    };
  });
}
