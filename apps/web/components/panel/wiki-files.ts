import { glob, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { WikiArticle } from "@/components/panel/data";

const directory = resolve(process.cwd(), "../../wiki");
const segment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function readWikiArticle(parts: readonly string[]) {
  "use cache";
  if (parts.length !== 2 || !parts.every((part) => segment.test(part))) return null;
  const slug = parts.join("/");
  let source: string;
  try {
    source = await readFile(resolve(directory, `${slug}.md`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!frontmatter) throw new Error(`Missing Wiki metadata: ${slug}`);
  const fields = new Map(frontmatter[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  const title = fields.get("title");
  const summary = fields.get("summary");
  const id = fields.get("id") ?? slug;
  if (!title || !summary || (id !== slug && !segment.test(id))) throw new Error(`Invalid Wiki metadata: ${slug}`);
  return {
    meta: { id, slug, title, summary, tags: fields.get("tags") ?? "" } satisfies WikiArticle,
    markdown: source.slice(frontmatter[0].length).trim(),
  };
}

export async function loadWikiIndex(): Promise<WikiArticle[]> {
  "use cache";
  const files: string[][] = [];
  for await (const file of glob("*/*.md", { cwd: directory, withFileTypes: true })) {
    if (file.isFile()) files.push([basename(file.parentPath), basename(file.name, ".md")]);
  }
  const articles = (await Promise.all(files.map(readWikiArticle))).flatMap(article => article ? [article.meta] : []);
  if (new Set(articles.map(({ id }) => id)).size !== articles.length) throw new Error("Duplicate Wiki article IDs");
  return articles.toSorted((first, second) => first.slug.localeCompare(second.slug));
}
