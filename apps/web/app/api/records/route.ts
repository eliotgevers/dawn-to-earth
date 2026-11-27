import { readArchiveSources } from "@/db/verification/evidence";
import { writeWorkspace } from "@/db/workspace";
import { readDatabase, writeDatabase } from "@/db/http";

export function GET() {
  return readDatabase(readArchiveSources);
}

export function POST(request: Request) {
  return writeDatabase(request, async (db, input) => {
    if (input.operation === "import-bench-run" || input.operation === "file-station-capture") {
      return { error: "File recordings in Verification or use the scoped bench ingest endpoint.", status: 403 };
    }
    return writeWorkspace(db, input);
  });
}
