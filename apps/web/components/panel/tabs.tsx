"use client";

import { Loading } from "@/components/records/empty";
import { ConnectionList, ContentLinkLabel, ConnectionLink } from "@/components/records/links";
import { ItemPicker } from "@/components/workspace/item-picker";
import { type ItemSelection } from "@/components/workspace/selection";
import type { Timeline } from "@/db/records/timeline";
import { formatUtcDateTime } from "@/lib/utc-time";
import type { OpenArticle, WikiArticle } from "./data";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const articleLoading = <Loading />;
const WikiArticleBody = lazy(() => import("./wiki-article"));

export function TimelineHistory({
  catalog,
  timeline,
  selections,
  onChange,
}: {
  catalog?: Timeline["catalog"];
  timeline?: Timeline | null;
  selections: readonly ItemSelection[];
  onChange: (selections: readonly ItemSelection[]) => void;
}) {
  const groups = timeline?.groups;

  return (
    <>
      <div className="shrink-0 border-b px-[15px] py-3">
        <ItemPicker catalog={catalog} selections={selections} onChange={onChange} />
      </div>
      {timeline === undefined ? (
        <div className="px-[15px]"><Loading /></div>
      ) : timeline === null ? (
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground" role="status">Timeline is unavailable.</p>
      ) : timeline.events.length > 0 ? (
        <div className="min-h-0 overflow-auto overscroll-contain px-[15px] pt-3.5 pb-5" tabIndex={0} aria-label="Timeline history" role="region">
          {groups?.map(group => (
            <div key={group.id} className="mb-3">
              <p className="text-sm font-medium">{group.title}</p>
              <span className="block mt-0.5 text-xs text-muted-foreground">
                {group.covered} of {group.total} serials
              </span>
              {group.missing.map(serial => (
                <p key={serial} className="mt-1 text-[13px] leading-normal text-muted-foreground">{serial} · Unavailable</p>
              ))}
            </div>
          ))}
          <ol aria-label="Scoped events">
            {timeline.events.map((event) => {
              const links = event.links;
              const single = links.length === 1 ? links[0] : undefined;
              const destination = single && (
                <ConnectionLink className="mt-[3px]" connection={single} scope={selections} />
              );
              const linkedTitle = single?.label === event.title;
              return (
                <li className="relative border-l pb-[15px] pl-[13px] wrap-anywhere before:absolute before:top-1.5 before:-left-1 before:size-[7px] before:rounded-full before:bg-primary" key={event.key}>
                  <time className="block text-xs text-muted-foreground" dateTime={event.at}>{formatUtcDateTime(event.at)}</time>
                  <strong className="mt-px block text-sm font-[620]">{linkedTitle ? destination : event.title}</strong>
                  <span className="block mt-0.5 text-xs text-muted-foreground">{event.actor}</span>
                  {groups &&
                    event.coverage.map(({ groupId, title, serials, total }) => (
                      <div key={groupId} className="mt-0.5 text-xs text-muted-foreground">
                        {title} · {serials.length ? serials.join(", ") : "Revision record"}
                        {serials.length > 1 && (
                          <>
                            {" "}
                            ·{" "}
                            <span className="block mt-0.5 text-xs text-muted-foreground">
                              {serials.length} of {total} serials
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  {event.label && <p className="mt-0.5 text-xs text-muted-foreground">{event.label}</p>}
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{event.note}</p>
                  {!linkedTitle && destination}
                  {links.length > 1 && <ConnectionList links={links} scope={selections} />}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        groups !== undefined && <p className="mx-[15px] my-3 text-[13px] text-muted-foreground">Unavailable</p>
      )}
    </>
  );
}

const wikiTopics = [
  { folder: "space", title: "Spacecraft and orbits" },
  { folder: "systems", title: "Systems engineering" },
  { folder: "integration", title: "Assembly and integration" },
  { folder: "evidence", title: "Verification and evidence" },
  { folder: "methods", title: "Measurement and analysis" },
] as const;

export function WikiPanel({
  index,
  article,
  onArticle,
}: {
  index: readonly WikiArticle[];
  article: OpenArticle | null;
  onArticle: (entry: WikiArticle | null) => void;
}) {
  const [query, setQuery] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);

  const articleId = article?.id;
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
    if (!moveFocus.current) return;
    (articleId ? heading.current : search.current)?.focus();
    moveFocus.current = false;
  }, [articleId]);

  function navigate(article: WikiArticle | null) {
    moveFocus.current = true;
    onArticle(article);
  }

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = wikiTopics.flatMap(({ folder, title }) => {
    const entries = index.filter(
      (entry) =>
        entry.slug.startsWith(`${folder}/`) &&
        terms.every((term) =>
          `${entry.title} ${entry.summary} ${entry.tags} ${entry.slug} ${title}`.toLowerCase().includes(term),
        ),
    );
    return entries.length ? [{ folder, title, entries }] : [];
  });

  return (
    <div ref={scroll} className="min-h-0 overflow-auto overscroll-contain p-[15px] [&_h2]:text-[17px] [&_h2]:leading-[1.3] [&_h2]:font-[650]">
      {article ? (
        <article className={`grid gap-3 [&_h3]:mt-1 [&_h3]:text-[13px] [&_h3]:font-[650] [&_p]:wrap-anywhere [&_p]:leading-[1.6]
          [&_li+li]:mt-1.5 [&_ul]:list-disc [&_ol]:list-decimal [&_:is(ol,ul)]:ps-4 [&_math[display=block]]:max-w-full
          [&_math[display=block]]:overflow-x-auto`}>
          <Button type="button" variant="ghost" size="sm" className="-ms-[7px] justify-self-start" onClick={() => navigate(null)}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" /> Back to Wiki
          </Button>
          <h2 ref={heading} tabIndex={-1}>
            {article.title}
          </h2>
          <Suspense fallback={articleLoading}>
            <WikiArticleBody article={article} index={index} onArticle={navigate} />
          </Suspense>
        </article>
      ) : (
        <section className="grid gap-3" aria-label="Wiki index">
          <Input
            ref={search}
            type="search"
            aria-label="Search Wiki"
            placeholder="Search articles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {results.length ? (
            <div className="divide-y" key={terms.length ? "results" : "topics"}>
              {results.map(({ folder, title, entries }) => (
                <details className="group/topic" key={folder} open={terms.length > 0 || undefined}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 font-[620] [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="-rotate-90 group-open/topic:rotate-0" size={15} aria-hidden="true" />
                    <span>{title}</span>
                  </summary>
                  <ul className="divide-y ps-[19px]" aria-label={title}>
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <button className="grid w-full gap-[3px] px-1 py-[9px] text-start hover:bg-muted" type="button" onClick={() => navigate(entry)}>
                          <strong className="font-[620] text-primary">
                            <ContentLinkLabel kind="wiki">{entry.title}</ContentLinkLabel>
                          </strong>
                          <span className="text-[13px] leading-[1.45] text-muted-foreground">{entry.summary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[13px] leading-normal text-muted-foreground" role="status">
              No articles found
            </p>
          )}
        </section>
      )}
    </div>
  );
}
