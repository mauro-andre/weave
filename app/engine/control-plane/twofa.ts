import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import qrcode from "qrcode-generator";
import { db } from "./db.js";
import { base32Decode, generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";
import type { WeaveUser } from "./users.js";

// 2FA do operador do painel: TOTP (RFC 6238) + códigos de recuperação. O secret
// NÃO fica em claro no banco — cifrado em repouso com AES-256-GCM, chave derivada
// do SESSION_SECRET por HKDF (nenhuma env nova; rotacionar a env invalida os
// secrets cifrados — a nota operacional do card de Settings avisa). Os códigos
// de recuperação guardam apenas hashes sha256, comparados em tempo constante.

// ── cifra do secret (AES-256-GCM, chave HKDF do SESSION_SECRET) ───────────────

function twofaKey(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error(
      "weave: SESSION_SECRET is not set. It signs the dashboard session and encrypts the 2FA " +
        "secrets — without it no 2FA secret can be stored. Set it to a long random string.",
    );
  }
  // Salt/info fixos versionam a derivação: trocar aqui (v2…) invalida os blobs v1.
  return Buffer.from(hkdfSync("sha256", s, "weave-twofa-v1", "totp-secret-encryption", 32));
}

/** Formato: `v1.<iv>.<tag>.<ciphertext>` em base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", twofaKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("weave: malformed 2FA secret blob.");
  const decipher = createDecipheriv("aes-256-gcm", twofaKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

// ── códigos de recuperação ────────────────────────────────────────────────────

// Alfabeto sem ambíguos (sem 0/O/1/I): 31 caracteres, ~5 bits por char.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;

function recoveryCode(): string {
  const group = () =>
    Array.from({ length: 4 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return `${group()}-${group()}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
}

/** Normaliza (maiúsculas, sem espaços) e devolve o sha256 hex — é o que guarda o banco. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replace(/\s+/g, "").toUpperCase()).digest("hex");
}

function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ── QR ────────────────────────────────────────────────────────────────────────

/**
 * QR da URI otpauth como SVG inline (JS puro, zero binding nativo — a imagem de
 * container não ganha build step). As cores são as do padrão do formato QR
 * (módulos escuros sobre fundo claro), conteúdo da IMAGEM gerada server-side —
 * o estilo da moldura em volta é que usa os tokens do tema.
 */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag(4, 4);
}

// ── fluxos (enable em duas fases · login · disable) ───────────────────────────

export interface TwoFaPending {
  secret: string;
  otpauth: string;
  qrSvg: string;
}

/**
 * Fase 1 do enable: gera um secret novo, grava como PENDENTE (twofa_enabled
 * continua false — o login não muda) e devolve o que a UI mostra: QR, secret e
 * URI otpauth. Re-begin sobrescreve qualquer pendência anterior.
 */
export async function beginTwoFa(user: Pick<WeaveUser, "id" | "username">): Promise<TwoFaPending> {
  const secret = generateTotpSecret();
  const otpauth = otpauthUri(user.username, secret);
  await db()`UPDATE weave_users SET twofa_secret = ${encryptSecret(secret)}, twofa_enabled = false, updated_at = now() WHERE id = ${user.id}`;
  return { secret, otpauth, qrSvg: qrSvg(otpauth) };
}

/**
 * Fase 2 do enable: um código válido contra o secret PENDENTE ativa o fator,
 * grava o passo consumido (anti-replay já vale do 1º login) e gera 10 códigos
 * de recuperação — o plaintext é devolvido UMA única vez; o banco guarda hashes.
 */
export async function confirmTwoFa(
  userId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const user = await findTwoFaUser(userId);
  if (!user?.twofa_secret) return { ok: false, error: "Start by generating a secret (Enable)." };
  if (user.twofa_enabled) return { ok: false, error: "Two-factor authentication is already enabled." };

  const secret = base32Decode(decryptSecret(user.twofa_secret));
  const step = verifyTotp(secret, code, user.twofa_last_step);
  if (step === null) return { ok: false, error: "Invalid verification code." };

  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodes.map(hashRecoveryCode);
  // Tagged template com o array: o driver serializa como jsonb ARRAY (param
  // string + ::jsonb viraria jsonb string — dupla codificação).
  await db()`UPDATE weave_users SET twofa_enabled = true, twofa_last_step = ${step}, twofa_recovery = ${hashes}, updated_at = now() WHERE id = ${userId}`;
  return { ok: true, recoveryCodes };
}

/** Verifica o código da etapa do login (TOTP primeiro, recovery depois). Consome o que aceitar. */
export async function verifyLoginCode(
  user: WeaveUser,
  code: string,
): Promise<{ ok: true; kind: "totp" | "recovery" } | { ok: false }> {
  if (!user.twofa_enabled || !user.twofa_secret) return { ok: false };

  // 1) TOTP: janela ±1, passos já consumidos rejeitados (anti-replay).
  const step = verifyTotp(base32Decode(decryptSecret(user.twofa_secret)), code, user.twofa_last_step);
  if (step !== null) {
    await db()`UPDATE weave_users SET twofa_last_step = ${step}, updated_at = now() WHERE id = ${user.id} AND (twofa_last_step IS NULL OR twofa_last_step < ${step})`;
    return { ok: true, kind: "totp" };
  }

  // 2) Recovery: hash casa com algum não-consumido → remove DA LISTA (uso único).
  const hash = hashRecoveryCode(code);
  const consumed = await consumeRecoveryCode(user.id, hash);
  return consumed ? { ok: true, kind: "recovery" } : { ok: false };
}

/** Remove o hash da lista jsonb ATOMICAMENTE — só vence quem o consumiu de fato. */
async function consumeRecoveryCode(userId: string, hash: string): Promise<boolean> {
  const rows = await db()`
    UPDATE weave_users
    SET twofa_recovery = (
      SELECT COALESCE(jsonb_agg(h), '[]'::jsonb)
      FROM jsonb_array_elements(twofa_recovery) h
      WHERE h <> to_jsonb(${hash}::text)
    ), updated_at = now()
    WHERE id = ${userId} AND twofa_recovery @> to_jsonb(${hash}::text)
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Desliga o 2FA — EXIGE um código válido (TOTP ou recovery não consumido); a
 * sessão autenticada sozinha não desliga o fator. Limpa secret, passo e códigos.
 */
export async function disableTwoFa(
  userId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await findTwoFaUser(userId);
  if (!user?.twofa_enabled) return { ok: false, error: "Two-factor authentication is not enabled." };

  const verified = await verifyLoginCode(user, code);
  if (!verified.ok) return { ok: false, error: "Invalid verification code." };

  await db()`UPDATE weave_users SET twofa_secret = NULL, twofa_enabled = false, twofa_last_step = NULL, twofa_recovery = NULL, updated_at = now() WHERE id = ${userId}`;
  return { ok: true };
}

async function findTwoFaUser(userId: string): Promise<WeaveUser | null> {
  const rows = await db()<WeaveUser[]>`
    SELECT id, username, password_hash, twofa_secret, twofa_enabled, twofa_last_step, twofa_recovery
    FROM weave_users WHERE id = ${userId}
  `;
  return rows[0] ?? null;
}
