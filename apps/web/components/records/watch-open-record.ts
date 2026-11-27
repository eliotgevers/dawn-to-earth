import { useCallback, useRef, useState } from "react";

// A single unit can be constrained in SQL; a mixed selection shares one read and filters by exact members.
export function editionUrl(path: string, record: Record<string, string>, units: readonly { serial: string; revisionId: string }[]) {
  if (!units.length) return;
  const query = new URLSearchParams(record);
  if (units.length === 1) {
    query.set("serial", units[0].serial);
    query.set("revisionId", units[0].revisionId);
  }
  return path + "?" + query;
}

export async function readRecord<T>(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (response.ok) return { url, data: await response.json() as T };
  } catch {
    // The disclosure handles a network failure just like an unavailable HTTP response.
  }
  return { url, failed: true };
}

// Native disclosures fetch on open. Conditionally mounted record bodies fetch on mount.
export function useOpenRecord<T>(url?: string) {
  const [result, setResult] = useState<{ url: string; data?: T; failed?: boolean }>();
  const refresh = useRef<() => Promise<void>>(undefined);
  const watch = useCallback((node: HTMLElement | null) => {
    const row = node?.closest("details");
    if (!node || !url) return;
    let request: AbortController | undefined;
    const load = async () => {
      request?.abort();
      if (row && !row.open) return;
      const current = new AbortController();
      request = current;
      const result = await readRecord<T>(url, current.signal);
      if (!current.signal.aborted) setResult(result);
    };
    // A deep-linked row can already be open when its first toggle arrives.
    let open = row?.open;
    const toggle = () => {
      if (!row || open === row.open) return;
      open = row.open;
      void load();
    };
    refresh.current = load;
    void load();
    row?.addEventListener("toggle", toggle);
    return () => {
      row?.removeEventListener("toggle", toggle);
      request?.abort();
      refresh.current = undefined;
    };
  }, [url]);
  const current = result?.url === url ? result : undefined;
  return { data: current?.data, failed: current?.failed, watch, reload: () => refresh.current?.() };
}
