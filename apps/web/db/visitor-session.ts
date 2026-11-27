import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const name = "__Host-dawn-visitor";
const month = 30 * 24 * 60 * 60;

// The web client sees only a signed, opaque, HttpOnly cookie. Database IDs and
// proposal keys use separate derivations of the authenticated session.
export async function visitorBinding(create = false): Promise<string | undefined> {
  const secret = process.env.DAWN_VISITOR_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || !process.env.VISITOR_DATABASE_URL) return;
  const mac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const jar = await cookies();
  const raw = jar.get(name)?.value ?? "";
  const [nonce, until, signature] = raw.split(".");
  const now = Math.floor(Date.now() / 1000);
  let token = `${nonce}.${until}`;
  const valid = /^[0-9a-f]{64}\.\d{10}\.[0-9a-f]{64}$/.test(raw) &&
    Number(until) > now && Number(until) <= now + month &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(mac("cookie:" + token)));

  if (!valid) {
    if (!create) return;

    token = randomBytes(32).toString("hex") + "." + (now + month);
    jar.set(name, token + "." + mac("cookie:" + token), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: month,
    });
  }

  return mac("binding:" + token);
}
