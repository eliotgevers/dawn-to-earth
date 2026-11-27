"use client";
import { recordLink } from "@/components/records/presentation";

import { use } from "react";
import Image from "next/image";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { ContentLinkLabel, SourceLink } from "@/components/records/links";
import type { OpenArticle, WikiArticle } from "./data";

export default function WikiArticleBody({ article, index, onArticle }: {
  article: OpenArticle;
  index: readonly WikiArticle[];
  onArticle: (entry: WikiArticle) => void;
}) {
  const markdown = use(article.markdown);
  if (markdown === null) return <p className="mt-1 text-[13px] leading-normal text-muted-foreground" role="status">Unavailable</p>;

  return (
    <Markdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, output: "mathml", maxExpand: 1000 }]]}
      components={{
        img: ({ src, alt }) =>
          typeof src === "string" && /^\/wiki-diagrams\/[a-z0-9-]+\.svg$/.test(src) && alt ? (
            <Image className="h-auto w-full rounded-md" src={src} alt={alt} width={480} height={180} unoptimized />
          ) : null,
        table: ({ children }) => (
          <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Article table">
            <table className="w-full border-collapse text-[13px] [&_:is(th,td)]:border [&_:is(th,td)]:px-[9px] [&_:is(th,td)]:py-[7px] [&_:is(th,td)]:text-start [&_th]:bg-muted [&_th]:font-[620]">{children}</table>
          </div>
        ),
        a: ({ href, children }) => {
          if (!href) return children;
          let target: URL;
          try {
            target = new URL(href, `https://wiki.invalid/${article.slug}.md`);
          } catch {
            return children;
          }
          if (target.origin === "https://wiki.invalid") {
            const entry = index.find(entry => `/${entry.slug}.md` === target.pathname);
            return entry ? (
              <button className={`${recordLink} text-start underline underline-offset-2`} type="button" onClick={() => onArticle(entry)}>
                <ContentLinkLabel kind="wiki">{children}</ContentLinkLabel>
              </button>
            ) : children;
          }
          return target.protocol === "https:" ? <SourceLink href={target.href}>{children}</SourceLink> : children;
        },
      }}
    >
      {markdown}
    </Markdown>
  );
}
