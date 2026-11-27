import { registers, type WorkspaceReader } from "./workspace";
import { tool } from "ai";
import { z } from "zod";
import type { AskSource } from "./sources";
import { methodIds } from "@/components/verification/model";

import { queueAnswer, type readQueue } from "./home";
import { viewingPerson } from "@/lib/home-queue";

export function sourceTools(cite: (matches: AskSource[]) => void, loadHome: typeof readQueue, readWorkspace: WorkspaceReader, currentPerson?: string) {
  function records(summary: string, matches: AskSource[]) {
    if (matches.length) cite(matches);
    return { summary, records: matches.map(({ id, ref, wikiId, title, excerpt }) => ({ id: wikiId ?? id, ref, title, excerpt })) };
  }

  return {
    readWorkspace: tool({
      description: "Read a workspace view. To list records for the selected item, pass query=null. The server already applies the Catalog selection. Use a search only to narrow that list by record title, status or reference. Use current only for an individual open record. Read the full Wiki article by its exact title/ID. Use method only for Verification. Use offset for the next eight entries and before for Timeline events earlier than an ISO UTC date or a returned event ID. Tools opens educational references. Research=campaign, Stock=inventory, Lot trace=containment. For other UI actions, cite the record to open.",
      inputSchema: z.strictObject({
        view: z.enum(registers), query: z.string().max(160).nullable(), method: z.enum(methodIds).nullable().optional(),
        before: z.string().min(1).max(240).nullable().optional(),
        offset: z.number().int().min(0).max(10000).nullable().optional(),
      }),
      execute: async ({ view, query, method, offset, before }) => {
        const result = await readWorkspace.read(view, query, method, offset ?? 0,before);
        return { ...records(result.summary, result.sources), ...("article" in result && result.article ? { article: result.article } : {}) };
      },
    }),
    homeQueue: tool({
      description: "Read open Home work for a person. Pass null for the current Viewing as persona.",
      inputSchema: z.strictObject({ name: z.string().max(80).nullable(), group: z.enum(["assigned", "waiting"]) }),
      execute: async ({ name, group }) => {
        const home = await loadHome();
        const person = name ? home.users.find(user => user.name.toLowerCase() === name.trim().toLowerCase())
          : viewingPerson(home.users, currentPerson);
        if (!person) return { people: home.users.map(user => user.name) };
        const { text, sources } = queueAnswer(home, person, group);
        return records(text, sources);
      },
    }),
  };
}

export function draftChangeTool(maxLength: number, present: (description: string) => void) {
  let offered = false;
  return tool({
    description: "Draft text for the shared evidence note or documentary review explicitly requested on the open evidence. Only the user can confirm it.",
    inputSchema: z.strictObject({ description: z.string().trim().min(1).max(maxLength) }),
    execute: async ({ description }) => {
      if (!offered) { present(description); offered = true; }
      return "Draft shown for confirmation.";
    },
  });
}
