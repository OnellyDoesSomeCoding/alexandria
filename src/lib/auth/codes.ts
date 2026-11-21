import { createHash, randomBytes, randomInt } from "node:crypto";

// No 0/O, 1/I/L, so codes survive being read aloud or typed from a screenshot.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 8 characters, stored without the dash. */
export function newFriendCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "abcd-2345" or "ABCD 2345" -> "ABCD2345". Returns null if it can't be a friend code. */
export function normalizeFriendCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === 8 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export function formatFriendCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Sessions are stored by token hash, so the database never holds a usable cookie value. */
export function sessionIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
