import { eciToEcf, gstime, json2satrec, sgp4 } from "satellite.js";
import { maxElementAge, type OrbitRow } from "./orbital-catalog";

const earthRadiusKm = 6378.135; // WGS-72, used by SGP4.
export const forecastMinutes = 30;

export function prepareElements(rows: readonly OrbitRow[]) {
  return rows.map(([id, name, designator, epoch, inclination, node, eccentricity, pericenter, anomaly,
    meanMotion, bstar, dot, ddot, set]) => ({
    id, epoch: Date.parse(epoch),
    record: json2satrec({
      NORAD_CAT_ID: id, OBJECT_NAME: name, OBJECT_ID: designator, EPOCH: epoch,
      INCLINATION: inclination, RA_OF_ASC_NODE: node, ECCENTRICITY: eccentricity,
      ARG_OF_PERICENTER: pericenter, MEAN_ANOMALY: anomaly, MEAN_MOTION: meanMotion,
      BSTAR: bstar, MEAN_MOTION_DOT: dot, MEAN_MOTION_DDOT: ddot, ELEMENT_SET_NO: set,
    }),
  }));
}

type Element = ReturnType<typeof prepareElements>[number];
export type OrbitFrame = { at: number; ids: Int32Array; xyz: Float32Array; path: Float32Array };

function position(element: Element, at: number) {
  const age = at - element.epoch;
  if (Math.abs(age) > maxElementAge) return;
  const estimate = sgp4(element.record, age / 60000);
  if (!estimate) return;
  const { x, y, z } = eciToEcf(estimate.position, gstime(new Date(at)));
  if (![x, y, z].every(Number.isFinite)) return;
  // three-globe uses +Z at Greenwich, +X east, +Y north. Use Earth radii throughout the scene.
  return [y / earthRadiusKm, z / earthRadiusKm, x / earthRadiusKm];
}

export function estimateCatalog(elements: readonly Element[], at: number, selected: number | null = null): OrbitFrame {
  const ids: number[] = [], xyz: number[] = [], path: number[] = [];
  for (const element of elements) {
    const location = position(element, at);
    if (!location) continue;
    ids.push(element.id);
    xyz.push(...location);
    if (element.id !== selected) continue;
    path.push(...location);
    // Only draw the full short arc if every sample is supported by this same edition.
    for (let minute = 2; minute <= forecastMinutes; minute += 2) {
      const next = position(element, at + minute * 60000);
      if (!next) { path.length = 0; break; }
      path.push(...next);
    }
  }

  return { at, ids: Int32Array.from(ids), xyz: Float32Array.from(xyz), path: Float32Array.from(path) };
}

export const previewWindow = 90 * 60000;
export type FleetClock = { at: number; started: number; end: number | null; playing: boolean; speed: number };
export function viewTime(clock: FleetClock, now: number) {
  const elapsed = clock.playing ? Math.max(0, now - clock.started) * clock.speed : 0;

  return Math.min(clock.at + elapsed, clock.end ?? Infinity);
}
