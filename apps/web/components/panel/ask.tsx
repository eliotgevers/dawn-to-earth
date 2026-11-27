"use client";

import { AskConfirmation } from "./ask-confirmation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { AskContext, AskMessage, AskSource } from "@/ai/sources";
import { followRecordLink, useItemSelection } from "@/components/workspace/navigation";
import type { ItemSelection } from "@/components/workspace/selection";
import { useShell } from "@/lib/workspace";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import { MessageScroller, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";

const transport = new DefaultChatTransport<AskMessage>({
  api: "/api/ask",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: { ...body, messages: messages.slice(-7).map(message => ({
      role: message.role,
      content: message.parts.flatMap(part => part.type === "text" ? [part.text] : []).join(" ").slice(0, message.role === "user" ? 700 : 1200),
    })) },
  }),
});

const AskMarkdown = dynamic(() => import("./ask-markdown"));

type PanelContext = Pick<AskContext, "timelineScope" | "wikiId">;
type PanelSource = Extract<AskSource, { panel: string }>;
type PanelProps = { panelContext: PanelContext; openPanelSource: (source: PanelSource) => void };

export function AskPanel(props: PanelProps) {
  const { selections } = useItemSelection();
  return <Conversation key={selections.join("|")} scope={selections} {...props} />;
}

function Conversation({ scope, panelContext, openPanelSource }: PanelProps & { scope: readonly ItemSelection[] }) {
  const { openWiki } = useShell();
  const [draft, setDraft] = useState("");
  const { messages, sendMessage, stop, status, error } = useChat<AskMessage>({ transport });
  const busy = status === "streaming" || status === "submitted";
  useEffect(() => () => { void stop(); }, [stop]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const url = new URL(window.location.href);
    const { pathname: path, searchParams: params } = url;
    const id = /^[\w.-]{1,160}$/.test(url.hash.slice(1)) ? url.hash.slice(1) : undefined;
    const view = params.get("view") ?? undefined;
    const context: AskContext = { path, view, id, ...panelContext };
    for (const key of ["pair", "align", "record", "compare", "feature", "finding", "document", "case", "flight", "sat", "program", "part", "scenario", "day", "month", "files", "revisions", "q", "status", "type"] as const) {
      const value = params.get(key);
      if (value) context[key] = value.slice(0,160);
    }
    if (path === "/catalog") {
      for (const key of ["project","system","revision","batch","q","archived"] as const) {
        const value = params.get((view || "projects") + "." + key);
        if (value !== null) context[key] = value.slice(0,160);
      }
    }
    void sendMessage({ text }, { body: { scope, person: params.get("person") ?? undefined, context,
      evidence: path === "/verification" ? id : undefined } });
    setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent aria-label="Ask messages" className="gap-3 p-3">
              {messages.map(m => (
                <MessageScrollerItem key={m.id} messageId={m.id}>
                  <Message align={m.role === "user" ? "end" : "start"}>
                    <MessageContent>
                      <span className="sr-only">{m.role === "user" ? "You" : "Ask"}</span>
                      <Bubble variant="muted"><BubbleContent className="space-y-2 wrap-anywhere whitespace-pre-wrap">
                        {m.parts.map((part, i) => part.type === "text" ? (
                          m.role === "assistant" ? <AskMarkdown key={i} text={part.text} /> : <p key={i}>{part.text}</p>
                        ) :
                          part.type === "data-proposal" ? <AskConfirmation key={i} proposal={part.data} /> :
                          part.type === "data-sources" && part.data.length > 0 ? (
                            <ul key={i} aria-label="Sources" className="grid gap-2">
                              {part.data.map(s => <li key={[s.id, s.href, s.wikiId].join("|")}>
                                {s.panel ? <button type="button" className="text-left text-primary underline" onClick={() => openPanelSource(s)}>{s.kind} · {s.title}</button> : s.href ? <Link className="text-primary underline" href={s.href} onClick={event => followRecordLink(event, undefined, scope)}>{s.kind} · {s.title}</Link> :
                                  <button type="button" className="text-left text-primary underline" onClick={() => s.wikiId && openWiki(s.wikiId)}>Wiki · {s.title}</button>}
                                <p className="text-xs text-muted-foreground">{s.excerpt}</p>
                              </li>)}
                            </ul>
                          ) : null)}
                      </BubbleContent></Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {error && <p role="alert" className="text-sm">{error.message}</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <form onSubmit={submit} className="shrink-0 p-3">
        {messages.at(-1)?.parts.some(part => part.type === "data-mode" && part.data === "source-lookup") && (
          <p className="mb-1.5 text-xs text-muted-foreground">Source lookup · AI response unavailable.</p>
        )}
        <InputGroup>
          <InputGroupTextarea aria-label="Ask a question" placeholder="Ask a question" maxLength={700}
            value={draft} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }} />
          <InputGroupAddon align="block-end" className="justify-end">
            {busy ? <InputGroupButton type="button" size="icon-sm" aria-label="Stop answer" onClick={() => void stop()}><Square /></InputGroupButton> :
              <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send" disabled={!draft.trim()}><ArrowUp /></InputGroupButton>}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
