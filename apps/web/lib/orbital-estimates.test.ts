import { expect, test } from "bun:test";
import bundled from "../public/fleet/catalog/dawn-snapshot.json";
import { mergeCatalog, type CatalogSnapshot } from "./orbital-catalog";
import { estimateCatalog, prepareElements } from "./orbital-estimates";

const snapshot = bundled as CatalogSnapshot;
const [first, second] = snapshot.rows;

test("bundled elements still draw an estimated orbit at the current view time when stale", () => {
  const at = Date.parse(first[3]) + 7 * 24 * 60 * 60 * 1000;
  const frame = estimateCatalog(prepareElements([first]), at, first[0]);
  expect(frame.at).toBe(at);
  expect([...frame.ids]).toEqual([first[0]]);
  expect(frame.path.length).toBeGreaterThan(3);
  expect([...frame.path].every(Number.isFinite)).toBe(true);
});

test("a partial refresh preserves missing rows and prefers the newest epoch", () => {
  const newer = [...first] as typeof first;
  newer[3] = new Date(Date.parse(first[3]) + 1000).toISOString();
  const base = { ...snapshot, rows: [first, second] };
  expect(mergeCatalog(base, { ...snapshot, rows: [newer] }).rows).toEqual([newer, second]);
  expect(mergeCatalog({ ...base, rows: [newer, second] }, { ...snapshot, rows: [first] }).rows).toEqual([newer, second]);
});
