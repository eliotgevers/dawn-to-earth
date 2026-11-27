import type { ItemSelection } from "@/components/workspace/selection";

import type { AeroViaTool } from "./tool-directory";

export type PanelTab =
  | { id: number; type: "timeline"; selections: readonly ItemSelection[] }
  | { id: number; type: "wiki"; article: OpenArticle | null }
  | { id: number; type: "tools"; tool: AeroViaTool | null }
  | { id: number; type: "ask" };
export type PanelState = { open: boolean; width: number; active: number | null; tabs: PanelTab[] };

export const minPanelWidth = 280;
const workspaceMinimum = 450;

export const defaultPanel: PanelState = { open: false, width: 365, active: null, tabs: [] };

export function maximumPanelWidth() {
  return Math.max(minPanelWidth, document.documentElement.clientWidth - workspaceMinimum);
}

export type WikiArticleId = string;

export type WikiArticle = {
  id: WikiArticleId;
  slug: string;
  title: string;
  summary: string;
  tags: string;
};

export type OpenArticle = WikiArticle & { markdown: Promise<string | null> };

export function wikiArticle(index: readonly WikiArticle[], id: unknown) {
  return index.find((entry) => entry.id === id);
}
