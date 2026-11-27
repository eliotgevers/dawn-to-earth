import { readCalendar } from "@/db/operations/aurora";
import { readDatabase } from "@/db/http";

export async function GET(request: Request) {
  const items = new URL(request.url).searchParams.getAll("item");
  return readDatabase(db => readCalendar(db, items));
}
