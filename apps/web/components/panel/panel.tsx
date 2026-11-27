"use client";

import { Loading } from "@/components/records/empty";
import { Menu } from "@base-ui/react/menu";
import { Activity, Boxes, ClipboardCheck, Factory, House, Workflow, BookOpen, History, Wrench, MessageCircle, PanelRight, Plus, X } from "lucide-react";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  Fragment,
} from "react";
import { readRecord } from "@/components/records/watch-open-record";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { selectionSummary, type ItemSelection } from "@/components/workspace/selection";
import { ShellContext } from "@/lib/workspace";
import type { Timeline } from "@/db/records/timeline";
import {
  wikiArticle,
  type WikiArticle,
  type WikiArticleId,
  defaultPanel,
  maximumPanelWidth,
  minPanelWidth,
  type PanelState,
  type PanelTab,
} from "@/components/panel/data";
import { categories } from "./tool-directory";
import { ToolsPanel } from "./tools";
import { AskPanel } from "./ask";
import { WikiPanel, TimelineHistory } from "@/components/panel/tabs";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegments } from "next/navigation";

const chooserId = "side-panel-choose-timeline";
const tabId = (id: number) => `side-panel-tab-${id}`;

function subscribeToViewport(onResize: () => void) {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}

const serverPanelMaximum = () => minPanelWidth;

const panelChoices = [
  { type: "timeline", label: "Timeline", icon: History },
  { type: "wiki", label: "Wiki", icon: BookOpen },
  { type: "tools", label: "Tools", icon: Wrench },
  { type: "ask", label: "Ask", icon: MessageCircle },
] as const;

async function readMarkdown(slug: string) {
  const { data } = await readRecord<{ markdown?: unknown }>(`/api/wiki/${slug}`, AbortSignal.timeout(8000));
  return typeof data?.markdown === "string" ? data.markdown : null;
}

function wikiTab(id: number, entry: WikiArticle | null): PanelTab {
  return { id, type: "wiki", article: entry && { ...entry, markdown: readMarkdown(entry.slug) } };
}

export function SidePanelLayout({
  children,
  wiki,
  headerActions,
  sidebar,
}: {
  children: ReactNode;
  wiki: readonly WikiArticle[];
  headerActions: ReactNode;
  sidebar: ReactNode;
}) {
  const [state, setPanel] = useState<PanelState>(defaultPanel);
  const [selections, setSelections] = useState<readonly ItemSelection[]>([]);
  const router = useRouter();

  useEffect(() => {
    function refreshWorkspace() {
      router.refresh();
    }
    window.addEventListener("focus", refreshWorkspace);
    window.addEventListener("online", refreshWorkspace);
    return () => {
      window.removeEventListener("focus", refreshWorkspace);
      window.removeEventListener("online", refreshWorkspace);
    };
  }, [router]);

  function resize(next: number) {
    const width = Math.max(minPanelWidth, Math.min(maximumPanelWidth(), Math.round(next)));
    setPanel((current) => ({ ...current, width }));
  }

  const pendingFocus = useRef<number | "chooser" | null>(null);

  useEffect(() => {
    if (!state.open || pendingFocus.current === null) return;
    document.getElementById(pendingFocus.current === "chooser" ? chooserId : tabId(pendingFocus.current))?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [state.open, state.active, state.tabs]);

  function closePanel() {
    setPanel((current) => ({ ...current, open: false }));
    requestAnimationFrame(() => document.getElementById("side-panel-toggle")?.focus({ preventScroll: true }));
  }

  const { open, active, tabs } = state;
  const currentTab = tabs.find(tab => tab.id === active);
  const timelineUrl = open && currentTab?.type === "timeline"
    ? "/api/timeline?" + new URLSearchParams(currentTab.selections.map(id => ["item", id]))
    : undefined;
  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof readRecord<Timeline>>>>();
  useEffect(() => {
    if (!timelineUrl) return;
    const controller = new AbortController();
    readRecord<Timeline>(timelineUrl, controller.signal).then(result => {
      if (!controller.signal.aborted) setTimeline(result);
    });
    return () => controller.abort();
  }, [timelineUrl, children]);

  function togglePanel() {
    if (open) {
      closePanel();
      return;
    }
    pendingFocus.current = active ?? "chooser";
    setPanel((current) => ({ ...current, open: true }));
  }
  function showTab(tab: PanelTab, focusTab = true) {
    if (focusTab) pendingFocus.current = tab.id;
    setPanel((current) => {
      const tabs = [...current.tabs];
      const index = tabs.findIndex(({ id }) => id === tab.id);
      tabs[index < 0 ? tabs.length : index] = tab;
      if (index < 0) {
        const order = (t: PanelTab) => panelChoices.findIndex(choice => choice.type === t.type);
        tabs.sort((a, b) => order(a) - order(b));
      }
      return { ...current, open: true, active: tab.id, tabs };
    });
  }

  const timelines = tabs.filter(tab => tab.type === "timeline");
  const nextId = Math.max(0, ...tabs.map(({ id }) => id)) + 1;
  const existingWiki =
    currentTab?.type === "wiki" ? currentTab : tabs.findLast((tab) => tab.type === "wiki");
  function openWiki(article: WikiArticleId) {
    showTab(wikiTab(existingWiki?.id ?? nextId, wikiArticle(wiki, article) ?? null));
  }
  function addTab(type: PanelTab["type"]) {
    if (type === "timeline") showTab({ id: nextId, type, selections: [] });
    if (type === "wiki") showTab({ id: nextId, type, article: null });
    if (type === "tools") showTab({ id: nextId, type, tool: null });
    if (type === "ask") showTab({ id: nextId, type });
  }

  function closeTab(id: number) {
    const closed = state.tabs.findIndex((tab) => tab.id === id);
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    const active = state.active === id ? (tabs[Math.min(closed, tabs.length - 1)]?.id ?? null) : state.active;
    pendingFocus.current = active;
    setPanel({ ...state, open: tabs.length > 0, tabs, active });
    if (!tabs.length) document.getElementById("side-panel-toggle")?.focus({ preventScroll: true });
  }

  const panelToggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            id="side-panel-toggle"
            className="fixed top-[calc((var(--header)-2rem)/2)] right-3.5 bg-popover transition-colors max-[630px]:top-[7px]"
            variant="outline"
            size="icon"
            type="button"
            aria-label="Side panel"
            aria-expanded={open}
            aria-controls="workspace-side-panel"
            onClick={togglePanel}
            onKeyDown={(event) => {
              if (open && event.key === "Escape") togglePanel();
            }}
          />
        }
      >
        <PanelRight aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        Side panel
      </TooltipContent>
    </Tooltip>
  );
  return (
    <ShellContext value={{ openWiki, wiki, selections, setSelections }}>
      <div
        className={`group/shell grid min-h-svh grid-cols-[var(--rail)_minmax(0,1fr)] grid-rows-[var(--header)_1fr] [--header:57px]
          [--rail:62px] max-[641px]:[--header:49px] max-[630px]:[--header:91px] max-[641px]:[--rail:49px]
          min-[761px]:data-side-panel-open:grid-cols-[var(--rail)_minmax(0,1fr)_min(var(--side-panel-width),calc(100%-450px))]`}
        data-side-panel-open={state.open || undefined}
        style={{ "--side-panel-width": `${state.width}px` } as CSSProperties}
      >
        <a className="fixed top-2.5 left-(--rail) z-60 -translate-y-[160%] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:translate-y-0 max-[761px]:group-data-side-panel-open/shell:invisible" href="#main-content">
          Skip to content
        </a>
        <header className="min-[762px]:@container/header sticky top-0 z-20 col-span-2 flex items-center justify-between gap-3 border-b bg-popover pr-[55px] pl-[21px] max-[630px]:pb-[44px] max-[641px]:pl-3.5 min-[761px]:group-data-side-panel-open/shell:pr-[29px]">
          <Link className="whitespace-nowrap text-xl font-bold leading-none tracking-[-.035em]" href="/">Dawn to Earth</Link>
          <div className="flex items-center gap-[9px]">
            {headerActions}
            {panelToggle}
          </div>
        </header>
        {sidebar}
        <main id="main-content" className={`col-start-2 mx-auto w-full max-w-[1320px] min-w-0 px-[34px] pt-[39px] pb-14 max-[641px]:px-[13px]
          max-[641px]:pt-[25px] max-[641px]:pb-[38px] max-[761px]:group-data-side-panel-open/shell:invisible
          [&_h1]:text-[33px] [&_h1]:leading-[1.15] [&_h1]:font-[690] [&_h1]:tracking-[-.045em]
          max-[641px]:[&_h1]:text-[27px]`} tabIndex={-1}>
          {children}
        </main>
        <aside
          id="workspace-side-panel"
          className="sticky top-0 col-start-3 row-span-2 row-start-1 flex h-dvh min-w-0 self-start border-l bg-background hidden:hidden
            max-[761px]:fixed max-[761px]:inset-x-0 max-[761px]:top-(--header) max-[761px]:z-10
            max-[761px]:h-[calc(100dvh-var(--header))] max-[761px]:border-0"
          aria-label="Side panel"
          hidden={!state.open}
          onClick={(event) => {
            const link = event.target instanceof Element && event.target.closest<HTMLAnchorElement>("a[href]");
            if (link && !link.target && link.origin === location.origin && window.matchMedia("(width < 761px)").matches &&
                !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
              setPanel(current => ({ ...current, open: false }));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node))
              closePanel();
          }}
        >
          {(open || tabs.length > 0) && (
            <Suspense fallback={<div className="px-[15px]"><Loading /></div>}>
              <PanelResizeHandle width={state.width} onResize={resize} onClose={closePanel} />
              {tabs.length ? (
                <Tabs
                  value={state.active}
                  onValueChange={(active) => setPanel((current) => ({ ...current, active }))}
                  className="min-h-0 min-w-0 flex-1 gap-0"
                >
                  <div className="flex h-(--header) min-w-0 shrink-0 items-center border-b bg-muted pr-[50px] pl-[9px] max-[761px]:h-[43px] max-[761px]:pr-3.5">
                    <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
                      <TabsList className="shrink-0 justify-start group-data-horizontal/tabs:h-auto" aria-label="Side panel tabs" variant="line" activateOnFocus>
                        {tabs.map((tab) => (
                          <SidePanelTab
                            key={tab.id}
                            tab={tab}
                            catalog={timeline?.data?.catalog}
                            selected={active === tab.id}
                            onClose={closeTab}
                          />
                        ))}
                      </TabsList>
                      <NewPanelTab onChoose={addTab} />
                    </div>
                  </div>
                  {tabs.map((tab) => (
                    <TabsContent
                      key={tab.id}
                      value={tab.id}
                      className="flex min-h-0 flex-col"
                      keepMounted={tab.type === "ask"}
                      hidden={active !== tab.id}
                    >
                      {tab.type === "ask" ? <AskPanel
                        panelContext={{ timelineScope: timelines.length === 1 ? timelines[0].selections : undefined, wikiId: existingWiki?.article?.id }}
                        openPanelSource={source => {
                          if (source.panel === "Timeline") {
                            showTab(timelines.length === 1 ? timelines[0] : { id: nextId, type: "timeline", selections });
                          } else {
                            const tool = categories.flatMap(category => [...category.tools]).find(entry => entry.slug === source.id);
                            if (tool) showTab({ id: tabs.findLast(t => t.type === "tools")?.id ?? nextId, type: "tools", tool });
                          }
                        }}
                      /> : open && active === tab.id && (
                        tab.type === "timeline" ? (
                          <TimelineHistory
                            catalog={timeline?.data?.catalog}
                            timeline={timeline && timeline.url === timelineUrl ? timeline.data ?? null : undefined}
                            selections={tab.selections}
                            onChange={(selections) => showTab({ ...tab, selections }, false)}
                          />
                        ) : tab.type === "tools" ? (
                          <ToolsPanel tool={tab.tool} onSelect={tool => showTab({ ...tab, tool }, false)} />
                        ) : (
                          <WikiPanel
                            index={wiki}
                            article={tab.article}
                            onArticle={(article) => showTab(wikiTab(tab.id, article), false)}
                          />
                        ))}
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <section aria-labelledby="side-panel-chooser-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="flex h-(--header) shrink-0 items-center justify-between gap-2 border-b bg-muted px-3.5 max-[761px]:h-[43px]">
                    <h2 id="side-panel-chooser-title" className="text-base font-semibold">Open Tab</h2>
                  </div>
                  <NewPanelTab initial onChoose={addTab} />
                </section>
              )}
            </Suspense>
          )}
        </aside>
      </div>
    </ShellContext>
  );
}

function NewPanelTab({ initial = false, onChoose }: {
  initial?: boolean;
  onChoose: (type: PanelTab["type"]) => void;
}) {
  const choices = panelChoices.map(({ type, label, icon: Icon }) => {
    const choose = () => onChoose(type);
    return initial ? (
      <Button key={type} id={type === "timeline" ? chooserId : undefined} type="button"
        variant="outline" aria-label={label} onClick={choose}
        className="h-auto min-h-10 justify-start gap-2.5 px-[11px] py-[9px] text-start whitespace-normal">
        <Icon data-icon="inline-start" aria-hidden="true" />
        {label}
      </Button>
    ) : (
      <Menu.Item key={type} onClick={choose}
        className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-highlighted:bg-muted">
        <Icon size={15} aria-hidden="true" /> {label}
      </Menu.Item>
    );
  });
  if (initial) return (
    <div className="grid content-start gap-2.5 overflow-y-auto p-3.5">{choices}</div>
  );
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger render={<Button type="button" variant="outline" size="icon-sm" className="shrink-0 bg-popover" aria-label="Add tab" title="Add tab" />}>
        <Plus aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={5} align="end" className="z-50">
          <Menu.Popup className="min-w-32 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            {choices}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SidePanelTab({ tab, catalog, selected, onClose }: {
  catalog?: Timeline["catalog"];
  tab: PanelTab;
  selected: boolean;
  onClose: (id: number) => void;
}) {
  const scope = tab.type === "timeline" && catalog
    ? selectionSummary(catalog, tab.selections)
    : undefined;
  const type = panelChoices.find((choice) => choice.type === tab.type)?.label;
  const article = tab.type === "wiki" ? tab.article?.title : undefined;
  const detail = article ?? scope?.label;
  const compact = scope?.shortLabel ?? detail;
  const name = `${type} ${tab.id}${detail ? `, ${detail}` : ""}`;
  return (
    <div className="flex h-8 min-w-[76px] max-w-[174px] items-center rounded-lg border border-border pr-px pl-[5px] data-selected:bg-background" data-selected={selected || undefined}>
      <TabsTrigger
        className="min-w-0 justify-start px-1 text-[13px] after:hidden"
        value={tab.id}
        id={tabId(tab.id)}
        aria-label={name}
        title={detail ? `${type} · ${detail}` : type}
        onKeyDown={(event) => {
          if (event.key !== "Delete") return;
          event.preventDefault();
          onClose(tab.id);
        }}
      >
        <span className="truncate">{compact ? `${type} · ${compact}` : type}</span>
      </TabsTrigger>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Close ${name}`}
        className="size-[26px]"
        title="Close tab"
        tabIndex={-1}
        onClick={() => onClose(tab.id)}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

function PanelResizeHandle({
  width,
  onResize,
  onClose,
}: {
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
}) {
  const maximum = useSyncExternalStore(subscribeToViewport, maximumPanelWidth, serverPanelMaximum);
  const drag = useRef<{ x: number; width: number; pointerId: number }>(null);
  const actual = Math.min(width, maximum);
  return (
    <div
      className={`absolute inset-y-0 -left-[5px] z-21 w-[9px] cursor-col-resize touch-none before:absolute before:inset-y-0
        before:left-[4px] before:w-[3px] hover:before:bg-ring active:before:bg-ring focus-visible:outline-none
        focus-visible:before:bg-ring max-[761px]:hidden`}
      role="separator"
      tabIndex={0}
      aria-label="Resize side panel"
      aria-orientation="vertical"
      aria-controls="workspace-side-panel"
      aria-valuenow={actual}
      aria-valuemin={minPanelWidth}
      aria-valuemax={maximum}
      aria-valuetext={`${actual} pixels`}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        drag.current = {
          x: event.clientX,
          width: actual,
          pointerId: event.pointerId,
        };
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) onResize(start.width + start.x - event.clientX);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onClose();
          return;
        }
        const sizes: Record<string, number> = {
          ArrowLeft: actual + 24,
          ArrowRight: actual - 24,
          Home: minPanelWidth,
          End: maximum,
        };
        const next = sizes[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onResize(next);
      }}
    />
  );
}

const sidebarGroups = [
  { label: "Workspace sections", destinations: [
    { label: "Home", href: "/", icon: House },
    { label: "Catalog", href: "/catalog", icon: Boxes },
    { label: "Engineering", href: "/engineering", icon: Workflow },
    { label: "Production", href: "/production", icon: Factory },
    { label: "Verification", href: "/verification", icon: ClipboardCheck },
    { label: "Operations", href: "/operations", icon: Activity },
  ] },
  { label: "Local services", destinations: [
    { label: "Grafana", href: "/api/local-service?open=grafana", icon: "/service-icons/grafana.svg" },
    { label: "InfluxDB", href: "/api/local-service?open=influxdb", icon: "/service-icons/influxdb.png" },
  ] },
];

export function Sidebar({ showInflux = false }: { showInflux?: boolean }) {
  const segments = useSelectedLayoutSegments();
  const activeSection = "/" + (segments[0] ?? "");
  const current = segments.length > 1 ? "location" : "page";

  return (
    <aside className="sticky top-(--header) z-10 h-[calc(100dvh-var(--header))] overflow-auto border-r bg-popover [scrollbar-width:thin] max-[761px]:group-data-side-panel-open/shell:invisible">
      {sidebarGroups.map(({ label, destinations }, index) => (
        <Fragment key={label}>
          {index > 0 && <hr className="mx-auto w-[23px] border-t" aria-hidden="true" />}
          <nav className="grid justify-items-center gap-[7px] py-3.5 first-of-type:pb-[9px] last-of-type:pt-[9px] max-[641px]:gap-1.5 max-[641px]:first-of-type:pt-3" aria-label={label}>
            {destinations.filter(link => showInflux || link.href !== "/api/local-service?open=influxdb").map(({ href, label, icon: Icon }) => (
              <Tooltip key={href}>
                <TooltipTrigger
                  className={`grid size-[39px] place-items-center rounded-lg border border-transparent text-muted-foreground hover:bg-muted
                    hover:text-foreground aria-[current]:border-primary/15 aria-[current]:bg-secondary aria-[current]:text-primary
                    max-[641px]:h-9 max-[641px]:w-[34px]`}
                  render={
                    typeof Icon === "string" ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        aria-description="Opens in a new tab"
                      />
                    ) : (
                      <Link
                        href={href === "/operations" ? "/operations/fleet" : href}
                        aria-label={label}
                        aria-current={href === activeSection ? current : undefined}
                      />
                    )
                  }
                >
                  {typeof Icon === "string" ? (
                    <Image className="size-5 object-contain" src={Icon} width={20} height={20} alt="" unoptimized />
                  ) : (
                    <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                  )}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {label}
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>
        </Fragment>
      ))}
    </aside>
  );
}
