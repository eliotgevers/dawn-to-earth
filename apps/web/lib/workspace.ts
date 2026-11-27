"use client";

import { createContext, use } from "react";
import type { AssemblyWorkspace } from "@/db/records/assembly";
import type { readVerificationWorkspace } from "@/db/verification/evidence";
import type { ItemSelection } from "@/components/workspace/selection";
import type { WikiArticle, WikiArticleId } from "@/components/panel/data";
import type { RecordEntry } from "./records/journal";
import { saveWorkspaceAction } from "@/app/(sections)/actions";

export const AssemblyData = createContext<AssemblyWorkspace | null>(null);
export const VerificationData = createContext<Awaited<ReturnType<typeof readVerificationWorkspace>> | null>(null);

export function useAssembly() { return use(AssemblyData)!; }
export function useVerification() { return use(VerificationData)!; }

// The persistent layout owns only navigation and side-panel interactions.
export const ShellContext = createContext<{
  selections: readonly ItemSelection[];
  setSelections: (selections: readonly ItemSelection[]) => void;
  wiki: readonly WikiArticle[];
  openWiki: (article: WikiArticleId) => void;
} | null>(null);

export function useShell() {
  return use(ShellContext)!;
}

export async function saveWorkspace(...args: Parameters<typeof saveWorkspaceAction>): ReturnType<typeof saveWorkspaceAction> {
  try {
    return await saveWorkspaceAction(...args);
  } catch {
    return { error: "Connection lost while saving. Check the workspace before trying again." };
  }
}

export function addRecord(record: Omit<RecordEntry, "id" | "recordedAt">) {
  return saveWorkspace({ operation: "record", record });
}


export function downloadJson(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
