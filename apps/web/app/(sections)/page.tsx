import { HomeQueue } from "@/components/workspace/home-queue";
import { readForRequest } from "@/db/http";
import { readHome } from "@/db/records/work";

export default async function HomePage() {
  const queue = await readForRequest(readHome);

  return <>
    <h1>Home</h1>
    {queue ? <HomeQueue {...queue} /> : <p role="status">Database is unavailable</p>}
  </>;
}
