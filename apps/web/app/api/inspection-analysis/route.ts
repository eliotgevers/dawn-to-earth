import { readInspectionAnalysis, readInspectionArchive, saveInspectionAnalysis } from "@/db/verification/inspection";
import { readDatabase, writeDatabase } from "@/db/http";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("check");
  if (!id && params.get("view") === "archive") return readDatabase(readInspectionArchive);
  return id
    ? readDatabase((db) => readInspectionAnalysis(db, id, params.get("finding")))
    : Response.json({ error: "Choose an archive." }, { status: 400 });
}
export function POST(request: Request) {
  return writeDatabase(request, saveInspectionAnalysis);
}
