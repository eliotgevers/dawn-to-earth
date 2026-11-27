import { isCatalogArchived, type CatalogDirectory } from "@/components/catalog/store";
import type { publicReferences } from "@/db/schema";

// These sources document an agreement or a program without attributing a specific spacecraft.
export const fleetPrograms = new Set(["alen-pnt", "sidus-lizziesat", "blue-canyon-lunar-relay", "arkedge-lnss",
  "aule-space", "oasis-beta", "reditus-enos"]);

// These are documented connections between two different catalogs. A shared name or customer alone is insufficient.
const referencesByProject: Record<string, string> = {
  "public-zft-tom": "zft-tom",
  "public-zft-cloudct": "zft-cloudct",
  "public-gitai-sc1": "gitai-sc1",
  "public-alen-pnt": "alen-pnt",
  "public-astroforge-odin": "astroforge-odin",
  "public-pixxel-firefly": "pixxel-firefly",
  "public-dorbit-ion": "d-orbit-ion-program",
  "public-dorbit-pulse": "d-orbit-pulse",
  "public-sidus-lizziesat": "sidus-lizziesat",
  "public-blue-canyon-lunar-relay": "blue-canyon-lunar-relay",
  "public-arkedge-lunar-navigation": "arkedge-lnss",
  "public-aule-docking": "aule-space",
  "public-cnes-platform-study": "cnes-platform-study",
  "public-reditus-enos": "reditus-enos",
  "public-tumbleweed-oasis-beta": "oasis-beta",
  "public-dawn-aurora": "aurora-spaceplane",
  "public-dawn-loop": "loop-network",
  "public-uarx-ossie": "uarx-ossie",
  "public-hiber-four": "hiber-four",
  "public-hiber-three": "hiber-three",
  "public-georyder": "georyder",
};

type ReferenceData = Omit<typeof publicReferences.$inferSelect, "position">;

export function missionIndex(catalog: Pick<CatalogDirectory, "projects" | "archivedRows">, references: readonly ReferenceData[]) {
  const sources = new Map(references.map(reference => [reference.id, reference]));

  return catalog.projects
    .filter(project => !isCatalogArchived(catalog, "project", project.id))
    .map(({ id, title, customer, description }) => ({
      id, title, customer, description, reference: sources.get(referencesByProject[id]),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type MissionRecord = ReturnType<typeof missionIndex>[number];
