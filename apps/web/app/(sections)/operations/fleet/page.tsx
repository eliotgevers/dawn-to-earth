import seed from "@/db/seed/records.json";
import { Suspense } from "react";
import { Loading } from "@/components/records/empty";
import { redirect } from "next/navigation";
import { SectionTabs } from "@/components/workspace/section-tabs";
import { missionIndex } from "@/components/operations/fleet/index-records";
import { OrbitalCanvas } from "@/components/operations/fleet/orbital-canvas";
import { loadCatalog, readPublicReferences } from "@/db/catalog";
import { readForRequest } from "@/db/http";
import { catalogSpacecraft } from "@/db/schema";

export const metadata = { title: "Fleet Explorer" };

export default async function FleetPage({ searchParams }: PageProps<"/operations/fleet">) {
  const params = await searchParams;
  // Fleet selection is a spacecraft or a program. Other workspace and archive parameters have no effect here.
  if (Object.keys(params).some(key => key !== "sat" && key !== "program")) {
    const query = new URLSearchParams();
    for (const key of ["sat", "program"]) {
      const value = params[key];
      if (typeof value === "string") query.set(key, value);
    }
    redirect("/operations/fleet" + (query.size ? "?" + query : ""));
  }

  return <SectionTabs section="operations" active="fleet" selections={[]}>
    <Suspense fallback={<Loading />}><FleetDirectory /></Suspense>
  </SectionTabs>;
}

async function FleetDirectory() {
  const directory = await readForRequest(async db => {
    const [catalog, references, spacecraft] = await Promise.all([
      loadCatalog(db, ["projects", "archivedRows"], true),
      readPublicReferences(db),
      db.select({ data: catalogSpacecraft.data }).from(catalogSpacecraft).orderBy(catalogSpacecraft.noradId),
    ]);

    return { records: missionIndex(catalog, references), spacecraft: spacecraft.map(row => row.data) };
  });

  if (directory) return <OrbitalCanvas {...directory} />;

  const { programs, spacecraft } = seed.publicArchive;
  const projects = [...seed.catalog.projects, ...programs.map(program => ({
    ...program, revisionIds: [], recordIds: [],
  }))];
  const references = programs.map(({ referenceId: id, title, description: summary, status, sources }) => ({
    id, title, summary, status, sources,
  }));

  return <>
    <p role="status" className="mb-2 text-sm text-muted-foreground">Database is unavailable · Showing the bundled Fleet directory.</p>
    <OrbitalCanvas records={missionIndex({ projects }, references)} spacecraft={spacecraft} />
  </>;
}
