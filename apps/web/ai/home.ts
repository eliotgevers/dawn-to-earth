import { db } from "@/db/connection";
import { readHome } from "@/db/records/work";
import { homeItems, viewingPerson, type HomeData, type QueueGroup } from "@/lib/home-queue";
import type { AskSource } from "./sources";

export type Turn = { role: "user" | "assistant"; content: string };

export async function readQueue() {
  if (!db) throw new Error("Home is unavailable");
  return readHome(db);
}

function namedPerson(users: HomeData["users"], text: string) {
  const words = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  return users.filter(user => [user.id, user.name, user.role].some(name =>
    words.includes(" " + name.toLowerCase().replace(/-/g, " ") + " ")));
}

export function queueAnswer(home: HomeData, person: HomeData["users"][number], group: QueueGroup) {
  const items = homeItems(home.items, person.id, group);
  const sources: AskSource[] = items.slice(0, 8).flatMap(item => {
    if (!/^\/(verification|engineering|production|operations|catalog)(?:[/?#]|$)/.test(item.href)) return [];
    const owner = home.users.find(user => user.id === item.assigneeId);
    const excerpt = [group === "waiting" && owner ? "Waiting on " + owner.name : "", item.reason, item.location].filter(Boolean).join(" · ");
    return [{ kind: "Home" as const, title: item.title, excerpt, href: item.href }];
  });
  const count = items.length;
  const quantity = count ? `${count} Home ${count === 1 ? "item" : "items"}` : "no Home items";
  const text = group === "assigned"
    ? `${person.name} has ${quantity} needing action.`
    : `${person.name} has ${quantity} waiting on others.`;

  return { text: count > 8 ? text + " Showing the first eight." : text, sources };
}

const queueTopic = /\b(action|assigned|assignments?|tasks?|to-?dos?|queue|waiting|needs? to do|workload)\b/i;
const followUp = /^(what|what do you mean|why|which ones?|tell me more|what about .+|how about .+|and .+)[?! .]*$/i;

export async function homeReply(messages: Turn[], currentPerson: string | undefined, load: typeof readQueue) {
  const questions = messages.filter(m => m.role === "user").map(m => m.content);
  const question = questions.at(-1)!;
  const clarification = /^(what|why|which ones?|what do you mean|tell me more)[?! .]*$/i.test(question);
  const previous = messages.at(-2);
  const choosing = previous?.role === "assistant" && previous.content.startsWith("Whose Home queue");
  const recent = [];
  for (const q of questions.toReversed()) {
    if (!queueTopic.test(q) && !followUp.test(q.trim()) && !(choosing && q === question)) break;
    recent.push(q);
  }
  if (!recent.some(q => queueTopic.test(q)) && !choosing) return;

  const home = await load();
  let person: HomeData["users"][number] | undefined;
  for (const q of recent) {
    const names = namedPerson(home.users, q);
    if (names.length === 1) { person = names[0]; break; }
    if (names.length || /\b(about|for|from|and)\s+(?!me\b|my\b)/i.test(q)) break;
    if (/\b(my|for me|from me|viewing as)\b/i.test(q) || /^(what needs action|needs your action|home queue)[?! .]*$/i.test(q.trim())) {
      person = viewingPerson(home.users, currentPerson);
      break;
    }
  }
  if (!person) return { text: "Whose Home queue should I open? Choose " + home.users.map(u => u.name).join(", ") + ".", sources: [] };

  const topic = recent.find(q => queueTopic.test(q)) ?? "";
  const result = queueAnswer(home, person, /\bwaiting\b/i.test(topic) ? "waiting" : "assigned");
  if (clarification && result.sources.length) {
    const details = result.sources.map(source => source.title + " — " + source.excerpt.split(" · ")[0]);
    return { ...result, text: result.text + "\n" + details.join("\n") };
  }
  return result;
}
