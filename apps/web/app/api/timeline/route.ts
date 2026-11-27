import { parseSelections } from "@/components/workspace/selection";
import { readDatabase } from "@/db/http";
import { readTimeline } from "@/db/records/timeline";

export function GET(request: Request) {
  const selections = parseSelections(new URL(request.url).searchParams.getAll("item"));
  return readDatabase(db => readTimeline(db, selections));
}
