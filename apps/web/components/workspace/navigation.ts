"use client";

import type { MouseEvent } from "react";
import { combinedItemDetails, parseSelections, type ItemSelection } from "@/components/workspace/selection";
import { useSearchParams } from "next/navigation";
import type { Catalog } from "@/components/catalog/store";
import { useShell } from "@/lib/workspace";
import { appendSelections, sectionLabels, isToolDestination, withSelections } from "@/lib/workspace-routes";

export function useItemSelection(catalog?: Catalog) {
  const params = useSearchParams();
  const { selections: previous, setSelections } = useShell();
  const url = params.toString();
  const linked = parseSelections(params.getAll("item"));
  const selections = linked.length ? linked : previous;

  function selectItems(next: readonly ItemSelection[]) {
    const selected = [...new Set(next)];
    setSelections(selected);
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    for (const item of selected) url.searchParams.append("item", item);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  return { item: combinedItemDetails(catalog, selections), selections, selectItems, selectionUrl: url };
}

export function plainLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function openRecordHash(hash: string) {
  const oldURL = window.location.href;
  // Next tracks native pushState for refresh and Back. Notify the section that its record changed.
  if (window.location.hash !== hash) {
    const url = new URL(oldURL);
    url.hash = hash;
    window.history.pushState(null, "", url);
  }
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }));
}

export function setListLocation(view: string | undefined, key: string, value: string | null) {
  const url = new URL(window.location.href);
  url.hash = "";
  if (view) url.searchParams.set("view", view);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
}

export function recordDestination(href: string, selections: readonly ItemSelection[]) {
  if (href.startsWith("#")) return href;
  const target = new URL(href, "http://localhost");
  const workflow = isToolDestination(target.pathname);
  const record = target.hash && sectionLabels[target.pathname];
  return withSelections(target, workflow || record ? selections : []);
}

export function followRecordLink(
  event: MouseEvent<HTMLAnchorElement>, sourceId: string | undefined, selections: readonly ItemSelection[],
  returnParams?: Record<string, string>,
) {
  if (!plainLinkClick(event)) return;
  const source = new URL(window.location.href);
  const target = new URL(event.currentTarget.href);
  const nativeEntry = window.history.state === null;
  if (sourceId) source.hash = sourceId;
  for (const [key, value] of Object.entries(returnParams ?? {})) source.searchParams.set(key, value);
  if (source.pathname !== "/catalog" && sectionLabels[source.pathname]) appendSelections(source, selections);
  if (source.href !== window.location.href) window.history.replaceState(window.history.state, "", source);
  if (target.pathname === source.pathname && target.search === source.search && (target.hash || source.hash)) {
    event.preventDefault();
    openRecordHash(target.hash);
  } else if (nativeEntry) {
    // An address-bar fragment can create a browser entry without router state. Keep Back native for that entry.
    event.preventDefault();
    window.location.assign(target.href);
  }
}

export function focusRelatedRecord(id: string) {
  const record = document.getElementById(id);
  if (!record || record.closest("[hidden]")) return false;
  for (let parent = record.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }

  if (!record.getClientRects().length) return false;
  if (record instanceof HTMLDetailsElement) record.open = true;
  if (!record.hasAttribute("tabindex") && record.tabIndex < 0) record.tabIndex = -1;
  record.focus({ preventScroll: true });
  record.scrollIntoView({ block: "start" });
  return true;
}

export function replaceRecordHash(id: string) {
  const hash = `#${id}`;
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
}

export function watchRecordLinks(follow: (id: string, event?: Event) => void) {
  const events = ["hashchange", "popstate"];
  const listener = (event?: Event) => {
    const hash = window.location.hash.slice(1);
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
    follow(id, event);
  };
  listener();
  events.forEach((name) => window.addEventListener(name, listener));
  return () => events.forEach((name) => window.removeEventListener(name, listener));
}

// Record-only destinations can focus a native disclosure directly. Section tabs handle their own routing.
export function watchRecordFocus(prefix?: RegExp, onMissing?: (id: string) => void) {
  return watchRecordLinks(id => {
    const requested = id && (!prefix || prefix.test(id));
    const missing = requested && !focusRelatedRecord(id);
    onMissing?.(missing ? id : "");
  });
}

export function clearRecordHash(id?: string) {
  if (window.location.hash && (!id || window.location.hash === `#${id}`)) {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }
}

export function focusRecordToolbar() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(
    'main [role="tabpanel"]:not([hidden]) :is([data-record-toolbar], .section-primary-actions) button',
  )?.focus());
}
