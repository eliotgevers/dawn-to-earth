"use client";

import { Streamdown, defaultRehypePlugins } from "streamdown";

// Only the separately validated Sources list supplies links in an Ask answer.
const textElements = ["p", "br", "strong", "em", "del", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6"];
const rehypePlugins = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden];

export default function AskMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      allowedElements={textElements}
      unwrapDisallowed
      skipHtml
      rehypePlugins={rehypePlugins}
      controls={false}
      className="space-y-2 whitespace-normal [&_ol]:list-decimal [&_ul]:list-disc [&_:is(ol,ul)]:ps-5 [&_pre]:whitespace-pre-wrap"
    >
      {text}
    </Streamdown>
  );
}
