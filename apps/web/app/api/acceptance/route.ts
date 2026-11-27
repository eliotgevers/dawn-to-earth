import { readAcceptanceChecks, writeAcceptance } from "@/db/verification/acceptance";
import { readDatabase, writeDatabase } from "@/db/http";

export function GET() {
  return readDatabase(async (db) => ({ enabled: true, checks: await readAcceptanceChecks(db) }));
}

export function POST(request: Request) {
  return writeDatabase(request, writeAcceptance);
}
