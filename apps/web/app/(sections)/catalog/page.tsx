import { readForRequest } from "@/db/http";
import { sectionTabs, sectionTab } from "@/components/records/presentation";
import { Suspense } from "react";
import { Loading } from "@/components/records/empty";
import { Catalog, CatalogTabs } from "@/components/catalog/catalog";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

import { readCatalogTab } from "@/db/catalog";

export const metadata = { title: "Catalog" };

export default async function CatalogPage({ searchParams }: PageProps<"/catalog">) {
  const { view } = await searchParams;
  const active = view === "systems" || view === "units" || view === "references" ? view : "projects";

  return <CatalogTabs view={active} tabList={
    <TabsList variant="line" className={sectionTabs} aria-label="Catalog views">
      <TabsTrigger className={sectionTab} value="projects">Projects</TabsTrigger>
      <TabsTrigger className={sectionTab} id="catalog-systems-tab" value="systems">
        Systems
      </TabsTrigger>
      <div role="presentation" className="inline-flex shrink-0 items-center gap-x-[inherit]">
        <TabsTrigger className={sectionTab} id="catalog-units-tab" value="units">
          Units
        </TabsTrigger>
        <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <TabsTrigger className={sectionTab} value="references">Public references</TabsTrigger>
      </div>
    </TabsList>
  }>
    <Suspense key={active} fallback={<Loading />}><CatalogRecords view={active} /></Suspense>
  </CatalogTabs>;
}

async function CatalogRecords({ view }: { view: string }) {
  const tab = await readForRequest(db => readCatalogTab(db, view));
  return tab ? <Catalog tab={tab} /> : <p role="status">Database is unavailable</p>;
}
