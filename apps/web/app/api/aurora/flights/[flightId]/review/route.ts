import { readFlightReview } from "@/db/operations/aurora";
import { readDatabase } from "@/db/http";

type Route = { params: Promise<{ flightId: string }> };

export async function GET(request: Request, { params }: Route) {
  const { flightId } = await params, items = new URL(request.url).searchParams.getAll("item");
  return readDatabase(db => readFlightReview(db, flightId, items));
}
