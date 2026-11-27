import type { UIMessage } from "ai";
import type { AskProposal } from "./proposals";
import type { ItemSelection } from "@/components/workspace/selection";

export type AskContext = Partial<Record<
  "path" | "view" | "id" | "case" | "flight" | "scenario" | "day" | "month" | "sat" | "program" | "part" |
  "pair" | "align" | "record" | "method" | "type" | "feature" | "compare" | "finding" | "document" | "q" | "status" | "project" | "system" | "revision" | "batch" | "archived" | "files" | "revisions" | "wikiId",
  string
>> & { timelineScope?: readonly ItemSelection[] };

export type AskSource = {
  kind: "Engineering" | "Production" | "Verification" | "Operations" | "Home" | "Timeline" | "Compare" | "Wiki" | "Catalog" | "Tools";
  id?: string; ref?: string; handoff?: boolean; title: string; excerpt: string;
} & (
  { href: string; wikiId?: never; panel?: never } |
  { wikiId: string; href?: never; panel?: never } |
  { panel: "Tools" | "Timeline"; href?: never; wikiId?: never }
);
export type AskMessage = UIMessage<unknown, { sources: AskSource[]; mode: "source-lookup" | "model"; proposal: AskProposal }>;

export function matchingSources(rows: AskSource[], query: string | null) {
  const key = query?.trim().toLowerCase();
  if (!key) return rows;
  const exact = rows.filter(s => [s.id, s.ref, s.wikiId, s.title].some(value => value?.toLowerCase() === key));
  if (exact.length) return exact;
  const terms = key.split(/\s+/);
  return rows.filter(s => {
    const text = [s.id, s.ref, s.title, s.excerpt].join(" ").toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
