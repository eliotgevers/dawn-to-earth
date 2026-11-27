import { z } from "zod";
import { prepareProposal } from "@/ai/proposals";
import { workspaceReader } from "@/ai/workspace";
import { answer } from "@/ai/assistant";
import { isToolId, tools } from "@/lib/workspace-routes";
import { parseSelections } from "@/components/workspace/selection";

const scope = z.array(z.string().max(160).regex(/^(project|system|revision):[\w.-]+$|^unit:[\w.-]+(?:@[\w.-]+)?$/)).max(8);
const id = z.string().regex(/^[\w.-]{1,160}$/);
const path = z.string().max(120).refine(path => {
  if (["/", "/catalog", "/engineering", "/production", "/verification", "/operations", "/operations/fleet", "/operations/aurora"].includes(path)) return true;
  const tool = path.split("/")[2];
  return !!tool && isToolId(tool) && path === `/${tools[tool].section}/${tool}`;
});
const context = z.strictObject({
  pair: id.optional(), align: id.optional(), record: id.optional(),
  feature: id.optional(), compare: id.optional(), finding: id.optional(), document: id.optional(),
  path, view: id.optional(), part: id.optional(), id: id.optional(), case: id.optional(), flight: id.optional(), sat: id.optional(),
  program: id.optional(), scenario: id.optional(), month: id.optional(), day: id.optional(), files: id.optional(), revisions: id.optional(),
  project: id.or(z.literal("")).optional(), system: id.optional(), revision: id.optional(), batch: z.string().max(160).optional(),
  archived: z.enum(["0","1"]).optional(), q: z.string().max(160).optional(), status: z.string().max(100).optional(), type: z.string().max(100).optional(),
  timelineScope: scope.optional(), wikiId: z.string().max(160).optional(),
});
const userText = z.string().trim().min(1).max(700);
const turn = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), content: userText }),
  z.strictObject({ role: z.literal("assistant"), content: z.string().max(1200) }),
]);
const conversation = z.strictObject({
  messages: z.array(turn).min(1).max(7).refine(turns => turns.at(-1)?.role === "user" &&
    turns.every((item, index) => !index || item.role !== turns[index - 1].role)),
  context: context.optional(),
  openRecord: z.strictObject({ section: z.enum(["engineering", "production"]), id: z.string().regex(/^[\w.-]{1,160}$/) }).optional(),
  scope, person: z.string().max(80).optional(), evidence: z.string().regex(/^[\w.-]{1,160}$/).optional(),
});

export async function POST(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const local = !process.env.VERCEL && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host ?? "");
  const hosted = process.env.VERCEL === "1" && url.protocol === "https:" && (host === "dawn2.earth" || host === process.env.VERCEL_URL);
  if ((!local && !hosted) || request.headers.get("origin") !== `${url.protocol}//${host}` ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("Open Ask from the workspace to search its sources.", { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return new Response("Send a JSON question.", { status: 415 });
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 1 || length > 16384)
    return new Response("The question is too large or has no declared length.", { status: 413 });

  const body = conversation.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response("Send a question of up to 700 characters with valid Catalog selections.", { status: 400 });
  const { messages, scope, person } = body.data;
  const selections = parseSelections(scope);
  const page = body.data.context;
  const prior = body.data.openRecord;
  const reader = workspaceReader(selections, page ? { ...page, timelineScope: page.timelineScope && parseSelections(page.timelineScope) }
    : prior ? { path: "/" + prior.section, id: prior.id } : {});
  const proposal = await prepareProposal(messages.at(-1)!.content, scope, body.data.evidence)
    .catch(() => ({ message: "Changes are unavailable. Try again later." }));
  return answer(messages, request.signal, local, reader, person, proposal);
}
