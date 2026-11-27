import { readDatabase, writeDatabase } from "@/db/http";
import { readValidation, saveValidationJudgment, validModelTarget } from "@/db/engineering/validation";

export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const target = { recordId: query.get("recordId"), evidenceId: query.get("evidenceId"),
    serial: query.get("serial"), revisionId: query.get("revisionId") };
  if (!validModelTarget(target))
    return Response.json({ error: "Choose one design record or an exact evidence source and unit revision." }, { status: 400 });
  return readDatabase(db => readValidation(db, target));
}

export function POST(request: Request) {
  return writeDatabase(request, saveValidationJudgment);
}
