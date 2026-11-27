import { snapshotFile, type CatalogSnapshot, type CatalogIndex } from "@/lib/orbital-catalog";
import { prepareElements, estimateCatalog, type OrbitFrame } from "@/lib/orbital-estimates";

export type Scope = { owners: string; selected: number | null };
export type CatalogEvent = { index: CatalogIndex } | ({ frame: OrbitFrame } & Scope) | { error: string };
let elements: ReturnType<typeof prepareElements> = [];

async function read(url: string): Promise<CatalogSnapshot> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Fleet elements unavailable.");
  const snapshot: CatalogSnapshot = await response.json();
  if (snapshot.group !== "dawn" || !Array.isArray(snapshot.rows) || !snapshot.rows.length || !Number.isFinite(Date.parse(snapshot.retrievedAt))) throw new Error("Unrecognized fleet data.");
  return snapshot;
}

self.onmessage = async ({ data }: MessageEvent<{ load: true } | ({ at: number } & Scope)>) => {
  try {
    if ("load" in data) {
      const data = await read("/api/fleet/catalog").catch(() => read(snapshotFile));
      elements = prepareElements(data.rows);
      const rows: CatalogIndex["rows"] = data.rows.map(([id, name, designator, epoch]) => [id, name, designator, epoch]);
      postMessage({ index: { rows, retrievedAt: data.retrievedAt } } satisfies CatalogEvent);
      return;
    }
    const owners = new Set(data.owners.split(",").map(Number));
    const frame = estimateCatalog(elements.filter(row => owners.has(row.id)), data.at, data.selected);
    postMessage({ frame, owners: data.owners, selected: data.selected } satisfies CatalogEvent,
      { transfer: [frame.xyz.buffer, frame.path.buffer, frame.ids.buffer] });
  } catch { postMessage({ error: "Fleet position estimates unavailable." } satisfies CatalogEvent); }
};
