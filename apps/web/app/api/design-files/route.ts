import { eq } from "drizzle-orm";
import { fileLibrary } from "@/db/engineering/design";
import { readDatabase, readForRequest } from "@/db/http";
import { designFiles, revisionFiles } from "@/db/schema";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const linked = params.get("linked");
  if (linked) return readDatabase(async db => {
    const rows = await db.select({ id: revisionFiles.fileId }).from(revisionFiles).where(eq(revisionFiles.revisionId, linked)).limit(1);
    return { attached: rows.length > 0 };
  });
  const file = params.get("file");
  if (!file) return readDatabase(db => fileLibrary(db, params.get("revision") ?? ""));
  if (!/^[a-f0-9]{64}$/.test(file)) return new Response("Unknown file.", {status: 404});
  const rows = await readForRequest(db => db.select().from(designFiles).where(eq(designFiles.id, file)));
  if (!rows) return new Response("The file store is unavailable.", {status: 503});
  if (!rows[0]) return new Response("Unknown file.", {status: 404});
  const { content, kind } = rows[0];
  return new Response(Buffer.from(content, "base64"), { headers: {
    "Content-Type": kind === "drawing" ? "image/png" : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=31536000, immutable",
  }});
}
