import "server-only";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { visitorBinding } from "./visitor-session";

export type VisitorTarget = { recordId: string; serial: string; revisionId: string };
const url = process.env.VISITOR_DATABASE_URL;
const client = url ? postgres(url, {
  max: 1, connect_timeout: 3, idle_timeout: 5,
  ...(process.env.DATABASE_CA_CERT ? { ssl: { ca: process.env.DATABASE_CA_CERT, rejectUnauthorized: true } } : {}),
}) : undefined;

// Keep the existing owner's decision checks and the public append under the same
// workspace lock. The check uses the ordinary read-only workspace connection.
export async function appendDemoEvidence(
  kind: "note" | "review", requestId: string, body: string,
  check: () => Promise<{ target: VisitorTarget } | { error: string }>,
): Promise<{ saved: true; id: string } | { error: string }> {
  if (!client) return { error: "Demo contributions are unavailable." };
  const binding = await visitorBinding(true);
  if (!binding) return { error: "Demo contributions are unavailable." };
  const actor = createHash("sha256").update("entries:" + binding).digest("hex");

  return client.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext('dawn-workspace-write'))`;
    const verified = await check();
    if ("error" in verified) return verified;

    const { recordId, serial, revisionId } = verified.target;
    const [result] = await tx<{ error: string | null }[]>`
      select visitor_demo.append_evidence(${actor},${kind},${requestId}::uuid,${recordId},${serial},${revisionId},${body}) as error`;

    return result.error ? { error: result.error } : { saved: true as const, id: requestId };
  });
}
