import { timingSafeEqual } from "node:crypto";
import type { AuthConfig, Scope } from "../config/load";

/** Service tokens are high-entropy random strings, so a plain sha256 digest is enough to store them. */
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return `asm_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
}

export type AuthDecision = { ok: true } | { ok: false; status: 401 | 403 };

export function authorize(auth: AuthConfig, header: string | null, scope: Scope): AuthDecision {
  if (auth.mode === "none") return { ok: true };
  const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  if (!token) return { ok: false, status: 401 };

  const digest = Buffer.from(hashToken(token), "hex");
  const match = auth.tokens.find((t) => timingSafeEqual(Buffer.from(t.sha256, "hex"), digest));
  if (!match) return { ok: false, status: 401 };
  return match.scopes.includes(scope) ? { ok: true } : { ok: false, status: 403 };
}
