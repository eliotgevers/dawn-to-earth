import { createHash, timingSafeEqual } from "node:crypto";
import { writeForRequest } from "@/db/http";
import { fileBenchRun } from "@/db/verification/evidence";
import { isObject } from "@/db/workflows/cases";

const envelopeLimit = 36 * 1024;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Read the envelope within a fixed budget, including requests without Content-Length.
async function readEnvelope(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > envelopeLimit) {
        await reader.cancel();
        return error("Use a recording file of 32 KB or less.", 413);
      }
      chunks.push(value);
    }

    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const token = process.env.BENCH_INGEST_TOKEN;
  const sourceId = process.env.BENCH_INGEST_SOURCE_ID;
  const serial = process.env.BENCH_INGEST_SERIAL;
  const revisionId = process.env.BENCH_INGEST_REVISION_ID;
  if (!token || token.length < 32 || !sourceId || !serial || !revisionId) {
    return error("Bench ingest is not configured.", 503);
  }

  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest("Bearer " + token))) {
    return error("A valid bench ingest bearer token is required.", 401);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return error("Send the recording as application/json.", 415);
  }

  const input = await readEnvelope(request);
  if (input instanceof Response) return input;
  if (!isObject(input) || !isObject(input.recording) || typeof input.fileName !== "string" ||
      Object.keys(input).some(key => !["sourceId", "fileName", "recording"].includes(key))) {
    return error("Include sourceId, fileName and recording in a JSON object.", 400);
  }
  const { recording } = input;
  if (input.sourceId !== sourceId || recording.serial !== serial || recording.revisionId !== revisionId) {
    return error("This credential is assigned to a different source, serial or revision.", 403);
  }
  if (recording.channel !== "display_count") {
    return error("Bench ingest accepts display_count recordings only.", 400);
  }

  const result = await writeForRequest(db => fileBenchRun(db, {
    operation: "import-bench-run", sourceId, fileName: input.fileName, file: JSON.stringify(recording),
  }, { includeGrafanaReceipt: true }));
  if ("error" in result) return error(result.error, result.status);

  return Response.json({ evidenceId: result.id, evidenceUrl: result.evidenceUrl, grafanaUrl: result.grafanaUrl });
}
