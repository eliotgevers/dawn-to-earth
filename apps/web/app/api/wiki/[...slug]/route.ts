import { loadWikiIndex, readWikiArticle } from "@/components/panel/wiki-files";

export async function generateStaticParams() {
  return (await loadWikiIndex()).map(({ slug }) => ({ slug: slug.split("/") }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const article = await readWikiArticle(slug);
  return article ? Response.json({ markdown: article.markdown }) : new Response(null, { status: 404 });
}
