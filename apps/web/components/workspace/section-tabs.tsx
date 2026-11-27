"use client";
import { recordLink, sectionTabs, sectionTab } from "@/components/records/presentation";
import { Fragment, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShell } from "@/lib/workspace";
import { ArrowLeft } from "lucide-react";
import { ContentLinkLabel } from "@/components/records/links";
import { followRecordLink, recordDestination, useItemSelection } from "@/components/workspace/navigation";
import { sectionLabels, primary, tabHref, withSelections, type Section, type Destination } from "@/lib/workspace-routes";
import { ItemPicker } from "@/components/workspace/item-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ItemSelection } from "@/components/workspace/selection";
import { Loading } from "@/components/records/empty";
import { cn } from "@/lib/utils";

function SectionTabList({ section, active, selections, parent }: {
  section: Section;
  active: string;
  selections: readonly ItemSelection[];
  parent?: Destination;
}) {
  const tabs = parent?.children ?? primary[section];
  const label = (parent?.label ?? sectionLabels["/" + section]) + " views";
  const scrollable = !parent && (section === "operations" || section === "engineering");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!scrollable || !list) return;
    const revealActiveTab = () => {
      const tab = list.querySelector('[aria-selected="true"]');
      if (!tab) return;
      const visible = list.getBoundingClientRect();
      const selected = tab.getBoundingClientRect();
      if (selected.left < visible.left) list.scrollLeft += selected.left - visible.left;
      else if (selected.right > visible.right) list.scrollLeft += selected.right - visible.right;
    };
    const resize = new ResizeObserver(revealActiveTab);
    resize.observe(list);
    return () => resize.disconnect();
  }, [active, scrollable]);
  return (
    <TabsList ref={listRef} variant="line" aria-label={label}
      className={cn(sectionTabs, scrollable && "flex-nowrap overflow-x-auto max-[551px]:gap-x-0.5")}>
      {tabs.map((tab) => (
        <Fragment key={tab.id}>
          {tab.divider && <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
          <TabsTrigger className={cn(sectionTab, scrollable && "focus-visible:-outline-offset-2 focus-visible:inset-ring-2 focus-visible:inset-ring-ring")}
            value={tab.id}
            nativeButton={false}
            render={<Link href={tabHref(section, tab, selections)} scroll={false}
              onClick={event => followRecordLink(event, undefined, [])} />}
          >
            {tab.label}
          </TabsTrigger>
        </Fragment>
      ))}
    </TabsList>
  );
}
export function SectionTabs({ section, active, catalog, selections, onChange, pendingPicker, children, className = "" }:
  Omit<ComponentProps<typeof ItemPicker>, "onChange"> & { onChange?: ComponentProps<typeof ItemPicker>["onChange"]; section: Section; active: string; children: ReactNode; className?: string; pendingPicker?: boolean }) {
  const picker = onChange ? <ItemPicker catalog={catalog} selections={selections} onChange={onChange} />
    : pendingPicker && <ItemPicker selections={selections} />;
  return (
    <Tabs value={active} className="mt-3.5 min-w-0 gap-[19px] sm:mt-[19px]">
      {section !== "operations" && picker}
      <SectionTabList section={section} active={active} selections={selections} />
      {section === "operations" && picker}
      <TabsContent key={active} value={active} className={`min-w-0 data-ending-style:hidden ${className} ${section === "verification"
        ? "w-full [&_h2]:text-base [&_h2]:font-[650] [&_h2]:tracking-tight [&_h3]:text-sm [&_h3]:font-[630]" : ""}`}>
        {children}
      </TabsContent>
    </Tabs>
  );
}

// The URL already identifies the tab and scopes while the directory and records are streaming.
export function PendingSection({ section, active, items, subview }: {
  section: Section; active: string; items: ItemSelection[]; subview?: string;
}) {
  const { selections: previous } = useShell();
  const selections = items.length || section === "operations" ? items : previous;

  return <SectionTabs section={section} active={active} selections={selections}
    pendingPicker={section !== "operations" || active === "readiness" || active === "audit"}>
    {subview ? <SectionSubview section={section} parent={active} active={subview} selections={selections}>
      <Loading />
    </SectionSubview> : <Loading />}
  </SectionTabs>;
}

export function MissingRecord({ id }: { id: string }) {
  return <p role="status" className="my-2 text-sm wrap-anywhere">
    Record <strong>{id}</strong> could not be opened in this view and selection.
  </p>;
}

// Empty Operations indexes and unavailable Audit records use the same scope control.
export function OperationsScopePicker({ active, catalog, selections = [], children }: {
  active: "audit" | "readiness";
  catalog: ComponentProps<typeof ItemPicker>["catalog"];
  selections?: ItemSelection[];
  children?: ReactNode;
}) {
  const router = useRouter();
  const { setSelections } = useShell();
  return <SectionTabs section="operations" active={active} catalog={catalog} selections={selections}
    onChange={next => {
      setSelections(next);
      router.replace(withSelections(active === "audit" ? "/operations/audit" : "/operations", next), { scroll: false });
    }}>{children}</SectionTabs>;
}

export function SectionSubview({
  section,
  parent,
  active,
  selections,
  children,
}: {
  section: Section;
  parent: string;
  active: string;
  selections: readonly ItemSelection[];
  children: ReactNode;
}) {
  const tab = primary[section].find((entry) => entry.id === parent);
  if (!tab?.children) return children;
  return (
    <Tabs value={active} className="min-w-0">
      <SectionTabList section={section} parent={tab} active={active} selections={selections} />
      <TabsContent value={active} className="min-w-0 data-ending-style:hidden pt-2">
        {children}
      </TabsContent>
    </Tabs>
  );
}

// Case links retain the workspace selection even when opened in a fresh browser tab.
// Links to exact section records already own their unit/revision in the URL.
export function WorkspaceLink({ href, direction, children, className, ...props }: ComponentProps<typeof Link> & { direction?: "back" | "forward" }) {
  const { selections } = useItemSelection();
  const destination =
    typeof href === "string" && href.startsWith("/") ? recordDestination(href, selections) : href;
  return (
    <Link {...props} href={destination} className={className ?? (direction && recordLink)}>
      {direction === "back" && <ArrowLeft className="me-[.38em] inline-block size-[1em] align-[-.12em]" aria-hidden />}
      {direction === "forward" ? <ContentLinkLabel kind="internal">{children}</ContentLinkLabel> : children}
    </Link>
  );
}
