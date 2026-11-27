"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { postFlightComment } from "@/app/(sections)/operations/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FlightEntry } from "@/db/operations/aurora";
import { formatUtcDateTime } from "@/lib/utc-time";

export default function FlightDebrief({flightId, items, entries, canPost}: {canPost: boolean; flightId: string; items: string[]; entries: FlightEntry[] | null}) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [posted, setPosted] = useState(false);
  const pending = useRef<{id:string; body:string} | null>(null);

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) { setWriteError("Enter a comment."); return; }
    if (pending.current?.body !== body) pending.current = {id: crypto.randomUUID(), body};
    setSaving(true);
    setWriteError("");
    setPosted(false);
    const result = await postFlightComment(flightId, items, pending.current)
      .catch(() => ({ error: "Posting could not be confirmed. Your draft is ready to retry." }));
    setSaving(false);
    if ("error" in result) { setWriteError(result.error); return; }
    const field = form.elements.namedItem("body");
    if (field instanceof HTMLTextAreaElement) field.value = "";
    pending.current = null;
    setPosted(true);
  }

  return <section id="flight-debrief" aria-labelledby="flight-debrief-heading" className="grid max-w-3xl gap-4 border-t pt-5">
    <h3 id="flight-debrief-heading" className="text-lg font-semibold">Flight debrief</h3>
    {entries === null ? <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      Flight comments are unavailable. <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={() => startTransition(() => router.refresh())}>{retrying ? "Retrying…" : "Retry"}</Button>
    </p> : <>
      {entries.length ? <ol className="divide-y">{entries.map(entry => <li key={entry.id} className="grid gap-1 py-3 first:pt-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {entry.author && <span className="wrap-anywhere text-sm font-semibold text-foreground">{entry.author}</span>}
          {entry.example && <span>Demo comment</span>}
          <time dateTime={entry.recordedAt}>{formatUtcDateTime(entry.recordedAt)}</time>
        </div>
        <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-6">{entry.body}</p>
      </li>)}</ol> : <p className="text-sm text-muted-foreground">No comments yet.</p>}
      {canPost ? <form aria-label="Add flight comment" onSubmit={post} className="grid gap-3 text-sm">
        <label className="grid gap-1 font-medium">Comment<Textarea name="body" maxLength={1000} required readOnly={saving}/></label>
        {writeError && <p role="alert" className="text-destructive">{writeError}</p>}
        <Button type="submit" disabled={saving} className="w-fit">{saving ? "Posting…" : "Post"}</Button>
        <span role="status" className="sr-only">{posted ? "Comment posted." : ""}</span>
      </form> : <p className="text-sm text-muted-foreground">To post a comment, open this flight in a writable workspace.</p>}
    </>}
  </section>;
}
