// CelesTrak GP CSV in CCSDS field order below. Tuples avoid repeating 14 keys for every object.
export type OrbitRow = [
  noradId: number, name: string, designator: string, epoch: string, inclination: number,
  ascendingNode: number, eccentricity: number, pericenter: number, anomaly: number,
  revolutionsPerDay: number, bstar: number, motionDot: number, motionDdot: number, elementSet: number,
];
export type CatalogSnapshot = { source: "CelesTrak"; group: "dawn"; retrievedAt: string; rows: OrbitRow[] };

const columns = ["NORAD_CAT_ID", "OBJECT_NAME", "OBJECT_ID", "EPOCH", "INCLINATION", "RA_OF_ASC_NODE",
  "ECCENTRICITY", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "MEAN_MOTION", "BSTAR", "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT", "ELEMENT_SET_NO"] as const;

function* csvRecords(csv: string): Generator<string[]> {
  let record: string[] = [], field = "", quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ",") { record.push(field); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && csv[index + 1] === "\n") index++;
      if (field || record.length) yield [...record, field];
      record = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Incomplete quoted CSV field.");
  if (field || record.length) yield [...record, field];
}

export function parseGpCatalog(raw: string, retrievedAt: string, identities: ReadonlyMap<number, string>): CatalogSnapshot {
  const csv = csvRecords(raw.replace(/^\uFEFF/, ""));
  const header = csv.next().value as string[] | undefined;
  const indexes = columns.map(name => header?.indexOf(name) ?? -1);
  if (indexes.includes(-1) || !Number.isFinite(Date.parse(retrievedAt))) throw new Error("Unrecognized GP catalog.");

  const rows: OrbitRow[] = [];
  const seen = new Set<number>();
  for (const record of csv) {
    const [id, name, designator, epoch, ...elements] = indexes.map(index => record[index]?.trim() ?? "");
    const numbers = elements.map(value => value === "" ? NaN : Number(value));
    const [inclination, node, ecc, peri, anomaly, motion, drag, dot, ddot, set] = numbers;
    const norad = Number(id);
    if (identities.get(norad) !== designator) continue;
    if (!Number.isSafeInteger(norad) || norad <= 0 || !name || seen.has(norad) ||
      !/^\d{4}-\d\d-\d\dT/.test(epoch) || !Number.isFinite(Date.parse(epoch.endsWith("Z") ? epoch : epoch + "Z")) ||
      !numbers.every(Number.isFinite) || ecc < 0 || ecc >= 1 || motion <= 0 || inclination < 0 || inclination > 180) continue;
    seen.add(norad);
    rows.push([norad, name, designator, epoch.endsWith("Z") ? epoch : epoch + "Z", inclination, node, ecc, peri, anomaly, motion, drag, dot, ddot, set]);
  }

  return { source:"CelesTrak", group:"dawn", retrievedAt, rows };
}

export const maxElementAge = 72 * 60 * 60 * 1000;
const snapshotMaxAge = 6 * 60 * 60 * 1000;

export function archiveTime(snapshot: CatalogSnapshot, now: number): number | null {
  const retrieved = Date.parse(snapshot.retrievedAt);
  const epochs = snapshot.rows.map(row => Date.parse(row[3]));
  const near = (time: number) => epochs.some(epoch => Math.abs(time - epoch) <= maxElementAge);
  if (now >= retrieved && now - retrieved <= snapshotMaxAge && near(now)) return null;

  return near(retrieved) || !epochs.length ? retrieved : Math.max(...epochs);
}
export const snapshotFile = "/fleet/catalog/dawn-snapshot.json";

export type CatalogEntry = [noradId: number, name: string, designator: string, epoch: string];
export type CatalogIndex = { rows: CatalogEntry[]; retrievedAt: string; archivedAt: number | null };
