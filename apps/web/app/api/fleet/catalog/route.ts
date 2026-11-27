import { cacheLife } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import seed from "@/db/seed/records.json";
import snapshot from "@/public/fleet/catalog/dawn-snapshot.json";
import { mergeCatalog, parseGpCatalog, type CatalogSnapshot } from "@/lib/orbital-catalog";

const bundled = snapshot as CatalogSnapshot;
const sixHours = 6 * 60 * 60;
const feed = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv";
const identities = new Map(seed.publicArchive.spacecraft.map(craft => [craft.noradId, craft.internationalDesignator]));

// Cache a failed attempt too, so visitors cannot repeatedly trigger an upstream download.
async function refresh(_sixHourWindow: number) {
  "use cache: remote";
  cacheLife({ stale: 120, revalidate: sixHours, expire: sixHours + 300 });
  try {
    const response = await fetch(feed, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const next = parseGpCatalog(await response.text(), new Date().toISOString(), identities);
      if (next.rows.length) return next;
    }
  } catch {
    // A timeout, blocked download or malformed catalog leaves the published edition intact.
  }
  return null;
}

async function publishedSnapshot() {
  "use cache";
  // Prerender an offline edition. The first visit can initiate a refresh after deployment.
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    cacheLife({ stale: 120, revalidate: 300, expire: 31536000 });
    return bundled;
  }

  cacheLife({ stale: 120, revalidate: sixHours, expire: 31536000 });
  const refreshed = await refresh(Math.floor(Date.now() / (sixHours * 1000)));
  if (refreshed) return mergeCatalog(bundled, refreshed);
  if (process.env.NODE_ENV === "development") return bundled;

  // Failed ISR revalidation keeps the last successful JSON in Vercel’s durable cache.
  throw new Error("The public Fleet snapshot could not be refreshed.");
}

export async function GET() {
  return Response.json(await publishedSnapshot());
}
