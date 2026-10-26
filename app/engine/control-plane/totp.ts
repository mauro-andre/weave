import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 (TOTP) sobre RFC 4226 (HOTP) — HMAC-SHA1, 6 dígitos, passo de 30s.
// Zero dependência: só o node:crypto que a casa já usa em crypto.ts. O algoritmo
// vive AQUI puro (sem banco, sem HTTP) para o teste gerar códigos com o MESMO
// código que o login verifica — a prova do critério 1 é simétrica.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Janela de tolerância a drift de relógio: aceita o passo atual e os adjacentes. */
export const TOTP_WINDOW = 1;

// ── base32 (RFC 4648, sem padding) ─────────────────────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`weave: invalid base32 character '${ch}'`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── RFC 4226 / RFC 6238 ───────────────────────────────────────────────────────

/** HOTP de 6 dígitos com truncamento dinâmico (RFC 4226 §5.3). */
export function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** O código TOTP de um passo específico (counter = passo de 30s). */
export function totpAt(secret: Buffer, step: number): string {
  return hotp(secret, step);
}

/** O passo atual do relógio (epoch / 30s). */
export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

function codeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Verifica um código de 6 dígitos contra a janela ±TOTP_WINDOW. Retorna o passo
 * casado (para o anti-replay registrar) ou `null`. Passos <= `lastUsedStep` são
 * rejeitados — o mesmo código não vale duas vezes enquanto a janela o cobre.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  lastUsedStep: number | null = null,
  now: number = Date.now(),
): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = currentStep(now);
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (step < 0) continue;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (codeEquals(totpAt(secret, step), normalized)) return step;
  }
  return null;
}

// ── provisionamento ───────────────────────────────────────────────────────────

/** Secret TOTP de 160 bits (20 bytes → 32 caracteres base32), o que qualquer gerador importa. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * URI otpauth (formato key-uri do Google): `otpauth://totp/Weave:<username>?secret=<base32>&issuer=Weave`.
 * O label `issuer:account` é o que o gerador mostra na entrada.
 */
export function otpauthUri(username: string, secret: string): string {
  // `:` do label fica literal (formato canônico `issuer:account`); só o username é codificado.
  const label = `Weave:${encodeURIComponent(username)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Weave")}`;
}
