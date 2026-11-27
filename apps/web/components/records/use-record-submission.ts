import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

async function postRecord(url: string, payload: Record<string, unknown>, id: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, requestId: id }),
    });
    if (!response.ok) {
      const failure = await response.json();
      return String(failure.error ?? "The save could not be confirmed.");
    }
    const result = await response.json();
    if (result.id !== id) return "The save could not be confirmed.";
  } catch {
    return "Unable to confirm the save. Retry to check the same submission.";
  }
}

// These record endpoints return the persisted ID. A retry after a lost response reuses the same request.
type RecordWriter = (payload: Record<string, unknown>, requestId: string) => Promise<string | undefined>;

export function useRecordSubmission(destination: string | RecordWriter, onSaved: (id: string) => void, successMessage = "") {
  const attempt = useRef<{ body: string; id: string; pending: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function submit(payload: Record<string, unknown>) {
    if (attempt.current?.pending) return;
    const body = JSON.stringify(payload);
    const id = attempt.current?.body === body ? attempt.current.id : crypto.randomUUID();
    attempt.current = { body, id, pending: true };
    setBusy(true);
    setFeedback("");
    const write = typeof destination === "string" ? postRecord(destination, payload, id) : destination(payload, id);
    const error = await write.finally(() => {
      if (attempt.current) attempt.current.pending = false;
      setBusy(false);
    });
    if (error) {
      setFeedback(error);
      return;
    }
    attempt.current = null;
    setFeedback(successMessage);
    onSaved(id);
  }
  return { busy, feedback, submit };
}

// The archive viewer supplies the exact source and destination. Drafts belong to the inspected subject.
export function useFindingDraft(
  writer: string | RecordWriter, target: Record<string, unknown> | undefined,
  onSaved?: (id: string) => void, message = "", subject = "",
) {
  const [actor, setActor] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState("");
  const text = notes[subject] ?? "";
  const { busy, feedback, submit } = useRecordSubmission(writer, id => {
    setNotes(previous => previous[subject] === text ? { ...previous, [subject]: "" } : previous);
    onSaved?.(id);
  }, message);

  const ready = Boolean(target && actor && text.trim());
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !ready || busy) return;
    setSubmitted(subject);
    void submit({ ...target, actor, observation: text.trim() });
  }
  return {
    person: { value: actor, onChange: setActor },
    observation: {
      required: true, maxLength: 1000, value: text,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setNotes({ ...notes, [subject]: event.target.value }),
    },
    save, busy, disabled: busy || !ready, feedback: submitted === subject ? feedback : "",
  };
}
