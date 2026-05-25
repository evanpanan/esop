import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeNext(raw: string) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  if (v.includes("://")) return null;
  return v;
}

function appendClearCookie(res: NextResponse, name: string, path: string, secure: boolean, domain?: string) {
  const parts = [
    `${name}=`,
    `Path=${path}`,
    ...(domain ? [`Domain=${domain}`] : []),
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.headers.append("Set-Cookie", parts.join("; "));
}

function clearCookieAllPaths(res: NextResponse, name: string, secure: boolean, domains: Array<string | undefined>) {
  const paths = ["/", "/me", "/admin"];
  for (const domain of domains) for (const path of paths) appendClearCookie(res, name, path, secure, domain);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawHost = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]?.trim() ?? "";
  const host = (rawHost.split(":")[0] ?? "").trim();
  const domains: Array<string | undefined> = [undefined];
  if (host) domains.push(host);
  if (host && !host.startsWith(".")) domains.push(`.${host}`);
  const nextRaw = String(url.searchParams.get("next") ?? "");
  const next = safeNext(nextRaw) ?? "/";
  const res = NextResponse.redirect(new URL(next, url), 302);
  for (const name of ["esop_session", "esop_role", "esop_user_id", "esop_employee_id", "esop_sensitive_reveal"]) {
    clearCookieAllPaths(res, name, false, domains);
    clearCookieAllPaths(res, name, true, domains);
  }
  return res;
}
