import { Database, UserRound } from "lucide-react";
import { Loading } from "@/components/records/empty";
import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { hasPublicInflux } from "@/db/operations/traces";
import { SidePanelLayout, Sidebar } from "@/components/panel/panel";
import { SourceLink } from "@/components/records/links";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { loadWikiIndex } from "@/components/panel/wiki-files";
import { ThemeToggle } from "@/components/workspace/theme-toggle";
import { headerBadge, RepositoryButton } from "@/components/workspace/repository-button";

function HeaderDisclosure({ title, icon, description, children }: {
  title: string; icon: ReactNode; description: ReactNode; children: ReactNode;
}) {
  return <Dialog>
    <DialogTrigger render={<Button type="button" variant="outline" className={`${headerBadge} cursor-pointer`} />}>
      {icon}<span className="max-[360px]:max-w-[5.5em] max-[360px]:whitespace-normal max-[360px]:leading-[13px] @max-[540px]/header:max-w-[5.5em] @max-[540px]/header:whitespace-normal @max-[540px]/header:leading-[13px]">{title}</span>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription render={<div />} className="space-y-3">{description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>
    </DialogContent>
  </Dialog>;
}

async function ServiceSidebar() {
  await connection();

  return <Sidebar showInflux={hasPublicInflux()} />;
}

export default async function SectionsLayout({ children }: { children: ReactNode }) {
  const wiki = await loadWikiIndex();

  return (
    <TooltipProvider delay={150}>
      <SidePanelLayout
        sidebar={<Suspense fallback={<Sidebar />}><ServiceSidebar /></Suspense>}
        wiki={wiki}
        headerActions={
          <>
            <div className="flex shrink-0 items-center gap-2 max-[630px]:absolute max-[630px]:inset-x-3.5 max-[630px]:bottom-2 max-[390px]:gap-1">
              <HeaderDisclosure title="Built by Eliot Gevers" icon={<UserRound className="size-3.5" aria-hidden="true" />}
                description={<>
                  <p>I’d like to work at Dawn Aerospace as a software engineer. I built this demo to show how I could build and connect internal tools and dashboards that support engineering, operations and manufacturing.</p>
                  <p>I used public sources and fictional records to build this dashboard. For example, you can open a bench run in Verification and follow its Grafana link to see the recorded readings. I built this independently, without access to Dawn’s internal systems.</p>
                  <p>The name “Dawn to Earth” is a play on Dawn Aerospace and the phrase “down to earth”.</p>
                  <p>I also built <a href="https://www.aerovia.org/" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">AeroVia</a>. You can try its calculators under Tools in the side panel.</p>
                  <p>I built this demo in 4 days.</p>
                </>}>
                <SourceLink href="https://www.eliotgevers.com/">Personal website</SourceLink>
                <SourceLink href="https://www.linkedin.com/in/eliotgevers/">LinkedIn</SourceLink>
                <SourceLink href="/cv">CV (PDF)</SourceLink>
              </HeaderDisclosure>
              <HeaderDisclosure title="Demo Data" icon={<Database className="size-3.5" aria-hidden="true" />}
                description="I created this sample dataset using publicly available information to show what a representative engineering interface could look like. I did not access Dawn Aerospace’s internal systems or use internal company data.">
                <SourceLink href="https://www.dawnaerospace.com/heritage-and-missions">Heritage and Missions</SourceLink>
                <SourceLink href="https://www.dawnaerospace.com/green-propulsion">In-Space Propulsion</SourceLink>
              </HeaderDisclosure>
              <RepositoryButton />
            </div>
            <ThemeToggle />
          </>
        }
      >
        <Suspense fallback={<Loading />}>
          {children}
        </Suspense>
      </SidePanelLayout>
    </TooltipProvider>
  );
}
