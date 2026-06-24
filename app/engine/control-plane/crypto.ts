import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

// Hash de senha (scrypt, zero-dependência). Formato: "<salt hex>:<hash hex>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-me";
}

// Token de sessão assinado por HMAC. É só a sessão do operador do painel (estilo
// pgAdmin), não auth de usuário de app. Formato: "<payload>.<sig>".
export function createToken(user: { id: string }): string {
  const payload = Buffer.from(JSON.stringify({ id: user.id })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined | null): { id: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { id?: unknown };
    return typeof parsed.id === "string" ? { id: parsed.id } : null;
  } catch {
    return null;
  }
}
