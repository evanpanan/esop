import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type SessionRole = "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE";

export type SessionPayload = {
  uid: string;
  role: SessionRole;
  eid?: string;
  sv?: number;
  exp: number;
};

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET_MISSING");
  }
  return "dev-insecure-session-secret";
}

function base64UrlEncode(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecodeToBuffer(input: string) {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

export function signSession(payload: SessionPayload, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = base64UrlEncode(createHmac("sha256", secret).update(body).digest());
  try {
    if (
      !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const json = base64UrlDecodeToBuffer(body).toString("utf8");
    const parsed = JSON.parse(json) as SessionPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.uid !== "string" || !parsed.uid) return null;
    if (
      parsed.role !== "SUPER_ADMIN" &&
      parsed.role !== "FINANCE" &&
      parsed.role !== "EMPLOYEE"
    ) {
      return null;
    }
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    if (Date.now() > parsed.exp) return null;
    if (parsed.role === "EMPLOYEE" && (!parsed.eid || typeof parsed.eid !== "string")) {
      return null;
    }
    if (typeof parsed.sv !== "undefined") {
      if (typeof parsed.sv !== "number" || !Number.isFinite(parsed.sv) || parsed.sv < 0) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const parts = passwordHash.split("$");
  if (parts.length !== 3) return false;
  const [algo, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;
  const salt = base64UrlDecodeToBuffer(saltB64);
  const expected = base64UrlDecodeToBuffer(hashB64);
  const actual = scryptSync(password, salt, expected.length);
  try {
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
