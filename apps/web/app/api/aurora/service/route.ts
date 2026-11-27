import { readAuroraService } from "@/db/operations/aurora";
import { readDatabase } from "@/db/http";

export function GET(request: Request) {
  const items = new URL(request.url).searchParams.getAll("item");
  return readDatabase(async db => ({ records: (await readAuroraService(db, items)).records }));
}
