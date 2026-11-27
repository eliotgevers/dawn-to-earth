import { readDesignReview, saveDesignFinding } from "@/db/engineering/design";
import { readDatabase, writeDatabase } from "@/db/http";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return readDatabase((db) => readDesignReview(db, {
    recordId: params.get("recordId") || undefined, targetId: params.get("targetId") || undefined,
    serial: params.get("serial") || undefined, revisionId: params.get("revisionId") || undefined,
  }));
}

export function POST(request: Request) {
  return writeDatabase(request, saveDesignFinding);
}
