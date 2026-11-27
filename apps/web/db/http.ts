import { connection } from "next/server";
import { db, fail, type WorkspaceDatabase } from "./connection";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const unavailable = "Database is unavailable";

export async function readForRequest<T>(read: (database: WorkspaceDatabase) => PromiseLike<T>) {
  await connection();

  try {
    if (db) return await read(db);
  } catch {
    // Fall through to the same unavailable response as a missing connection.
  }

  return null;
}

export async function readDatabase(read: (database: WorkspaceDatabase) => Promise<object>) {
  const result = await readForRequest(read);
  if (result === null) return json({ error: unavailable }, 503);

  return json(result, "error" in result && "status" in result && typeof result.status === "number" ? result.status : 200);
}

// Expected conflicts come from the operation. A thrown write has no confirmed result.
export async function writeForRequest<T extends object>(write: (database: WorkspaceDatabase) => Promise<T>) {
  if (!db) return fail(unavailable, 503);

  try {
    return await write(db);
  } catch {
    return fail("The workspace change could not be confirmed. Check the database connection before retrying.", 503);
  }
}

export async function writeDatabase(
  request: Request,
  write: (database: WorkspaceDatabase, input: Record<string, unknown>) => Promise<{ status?: number } & object>,
) {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  if (origin && origin !== `${url.protocol}//${request.headers.get("Host") ?? url.host}`)
    return json({ error: "Invalid origin." }, 403);

  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "Invalid workspace request." }, 400);

  const { status = 201, ...body } = await writeForRequest(db => write(db, input as Record<string, unknown>));

  return json(body, status);
}
