import { recordLink } from "@/components/records/presentation";
import { useId, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useShell } from "@/lib/workspace";
import { distinctConnections, type RecordConnection } from "@/lib/records/links";
import { wikiArticle, type WikiArticleId } from "@/components/panel/data";
import type { ItemSelection } from "@/components/workspace/selection";
import { recordDestination, followRecordLink, plainLinkClick, useItemSelection } from "@/components/workspace/navigation";
import { ArrowRight, BookOpen, ExternalLink } from "lucide-react";

type ConnectionProps = {
  id?: string;
  connection: RecordConnection;
  sourceId?: string;
  returnParams?: Record<string, string>;
  scope?: readonly ItemSelection[];
  onFollow?: () => void;
  className?: string;
  primary?: boolean;
  scroll?: boolean;
};

export function ConnectionLink({ connection, sourceId, returnParams, scope, onFollow, className, primary, scroll, id }: ConnectionProps) {
  const { selections } = useItemSelection();
  if (connection.unavailable) return <span className="text-[13px] text-muted-foreground">{connection.role && connection.role + " · "}Record unavailable</span>;
  const linkProps = {
    id, href: recordDestination(connection.href, scope ?? selections), scroll,
    title: connection.identity,
    "aria-description": [primary && connection.location, connection.identity].filter(Boolean).join(" · ") || undefined,
    onClick(event) {
      if (!plainLinkClick(event)) return;
      followRecordLink(event, sourceId, selections, returnParams);
      onFollow?.();
    },
  } satisfies ComponentProps<typeof Link>;

  if (primary) return (
    <Button size="sm" variant="outline" nativeButton={false} role="link"
      className={`h-auto min-h-7 w-fit max-w-full whitespace-normal bg-popover ${className ?? ""}`} render={<Link {...linkProps} />}>
      <ArrowRight data-icon="inline-start" aria-hidden="true" />
      {connection.label}
    </Button>
  );

  return (
    <Link {...linkProps} className={`text-[13px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className ?? ""}`}>
      {connection.role && <span className="font-normal">{connection.role} · </span>}{connection.label}
      {connection.location && <span className="text-xs font-normal text-muted-foreground"> · {connection.location}</span>}
    </Link>
  );
}

export function ConnectionList({
  sourceId, links, primary, article, scope, onFollow, title = "Links",
}: {
  sourceId?: string;
  onFollow?: () => void;
  links: readonly RecordConnection[];
  scope?: readonly ItemSelection[];
  primary?: RecordConnection;
  article?: WikiArticleId;
  title?: string;
}) {
  const headingId = useId();
  const { selections } = useItemSelection();
  const primaryHref = primary && recordDestination(primary.href, scope ?? selections);
  const destinations = distinctConnections(links.map(link => ({ ...link, href: recordDestination(link.href, scope ?? selections) })))
    .filter(link => link.href !== primaryHref);
  const { wiki, openWiki } = useShell();
  const reference = article ? wikiArticle(wiki, article) : undefined;
  if (!destinations.length && !reference) return null;

  return (
    <nav aria-labelledby={headingId}>
      <h3 className="mb-1 text-[13px] font-semibold" id={headingId}>{title}</h3>
      <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {destinations.map(link => (
          <li key={link.href} className="min-w-0">
            <ConnectionLink connection={link} sourceId={sourceId} scope={scope} className="wrap-break-word" onFollow={onFollow} />
            {link.detail && <span className="block text-xs text-muted-foreground">{link.detail}</span>}
          </li>
        ))}
        {reference && (
          <li className="min-w-0">
            <button className={recordLink} type="button" onClick={() => openWiki(reference.id)}>
              <ContentLinkLabel kind="wiki">{reference.title} <span className="text-xs font-normal text-muted-foreground">· Wiki</span></ContentLinkLabel>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

const icons = { internal: ArrowRight, wiki: BookOpen, external: ExternalLink };

export function ContentLinkLabel({ kind, children }: { kind: keyof typeof icons; children: ReactNode }) {
  const Icon = icons[kind];
  return (
    <span>
      <Icon className="me-[.38em] inline-block size-[1em] align-[-.12em]" aria-hidden="true" focusable="false" />
      {children}
      {kind === "external" && <span className="sr-only"> (opens in a new tab)</span>}
    </span>
  );
}

export function InternalLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={[recordLink, className].filter(Boolean).join(" ")}>
    <ContentLinkLabel kind="internal">{children}</ContentLinkLabel>
  </Link>;
}

export function SourceLink({ href, children, className }: {
  href: string; children: ReactNode; className?: string;
}) {
  return <a className={className ?? `${recordLink} underline underline-offset-2`} href={href} target="_blank" rel="noopener noreferrer">
    <ContentLinkLabel kind="external">{children}</ContentLinkLabel>
  </a>;
}
