"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getSessionSecret,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
} from "@/lib/auth";

type RoleName = "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE";

function safeReturnTo(raw: string) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("/admin") && !v.startsWith("/me")) return null;
  return v;
}

function requestIsHttps(h: Headers) {
  const rawHost = (h.get("x-forwarded-host") ?? h.get("host") ?? "").trim().toLowerCase();
  const host = (rawHost.split(",")[0]?.trim() ?? "").split(":")[0] ?? "";
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export async function ensureBootstrapAdmin() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_BOOTSTRAP_ADMIN !== "1") {
    return;
  }

  const resetFlag = String(process.env.RESET_ADMIN_PASSWORD ?? "").trim() === "1";
  const resetIdentifier = String(process.env.RESET_ADMIN_IDENTIFIER ?? "")
    .trim()
    .toLowerCase();
  const newPasswordRaw = String(process.env.RESET_ADMIN_NEW_PASSWORD ?? "").trim();
  const newPassword = newPasswordRaw || "Admin123456!";

  if (resetFlag) {
    if (newPassword.length < 8) {
      throw new Error("RESET_ADMIN_NEW_PASSWORD_TOO_SHORT");
    }
    type ResetTarget = { id: string; sessionVersion: number };
    const target = resetIdentifier
      ? ((await prisma.user.findFirst({
          where: {
            OR: [
              { account: resetIdentifier },
              ...(resetIdentifier.includes("@") ? [{ email: resetIdentifier }] : []),
            ],
          } as never,
          select: { id: true, sessionVersion: true } as never,
        } as never)) as unknown as ResetTarget | null)
      : ((await prisma.user.findFirst({
          where: { role: "SUPER_ADMIN" },
          orderBy: { createdAt: "asc" },
          select: { id: true, sessionVersion: true } as never,
        } as never)) as unknown as ResetTarget | null);

    if (target) {
      await prisma.user.update({
        where: { id: target.id },
        data: {
          passwordHash: hashPassword(newPassword),
          sessionVersion: (target.sessionVersion ?? 0) + 1,
        },
      });
      return;
    }
  }

  const existingAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (existingAdmin) return;

  const account = "admin";
  const email = "admin@esop.local";
  const password = newPassword;

  await prisma.user.upsert({
    where: { account } as never,
    create: {
      account,
      email,
      role: "SUPER_ADMIN",
      passwordHash: hashPassword(password),
    } as never,
    update: {},
  });

  const financeAccount = "finance";
  const financeEmail = "finance@esop.local";
  const financePassword = "Finance123456!";
  await prisma.user.upsert({
    where: { account: financeAccount } as never,
    create: {
      account: financeAccount,
      email: financeEmail,
      role: "FINANCE",
      passwordHash: hashPassword(financePassword),
    } as never,
    update: {},
  });
}

function homeUrl(params: { err?: string; lang?: string }) {
  const p = new URLSearchParams();
  const lang = (params.lang ?? "").trim();
  if (params.err) p.set("err", params.err);
  if (lang && lang !== "zh-CN") p.set("lang", lang);
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

function adminUrl(params: { lang?: string; focus?: string }) {
  const p = new URLSearchParams();
  const lang = (params.lang ?? "").trim();
  const focus = (params.focus ?? "").trim();
  if (lang && lang !== "zh-CN") p.set("lang", lang);
  if (focus) p.set("focus", focus);
  const qs = p.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

export async function logout(formData: FormData) {
  const langRaw = String(formData.get("lang") ?? "").trim();
  const lang = langRaw === "zh-TW" || langRaw === "en" || langRaw === "zh-CN" ? langRaw : "zh-CN";
  const next = homeUrl({ lang });
  redirect(`/logout?next=${encodeURIComponent(next)}`);
}

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const langRaw = String(formData.get("lang") ?? "").trim();
  const lang = langRaw === "zh-TW" || langRaw === "en" || langRaw === "zh-CN" ? langRaw : "zh-CN";

  try {
    if (password.length < 6) {
      redirect(homeUrl({ err: "INVALID_PASSWORD", lang }));
    }

    const cookieStore = await cookies();
    const secret = getSessionSecret();

    const identifierRaw = String(formData.get("email") ?? "").trim();
    const identifier = identifierRaw.toLowerCase();
    if (!identifierRaw) redirect(homeUrl({ err: "INVALID_EMAIL", lang }));

    type LoginUser = {
      id: string;
      role: RoleName;
      passwordHash: string;
      sessionVersion: number;
      employee: { id: string } | null;
    };
    let user: LoginUser | null = null;

    const userSelect = {
      id: true,
      role: true,
      passwordHash: true,
      sessionVersion: true,
      employee: { select: { id: true } },
    } as const;

    const directCandidates = (await prisma.user.findMany({
      where: { OR: [{ account: identifier }, ...(identifier.includes("@") ? [{ email: identifier }] : [])] } as never,
      select: userSelect,
      take: 2,
    })) as unknown as LoginUser[];
    if (directCandidates.length === 1) user = directCandidates[0];
    if (directCandidates.length > 1) redirect(homeUrl({ err: "AMBIGUOUS_USERNAME", lang }));

    if (!user && !identifier.includes("@")) {
      const legacyCandidates = (await prisma.user.findMany({
        where: {
          OR: [{ email: { startsWith: `${identifier}@` } }, { employee: { is: { name: identifierRaw } } }, { employee: { is: { name: identifier } } }],
        },
        select: userSelect,
        take: 2,
      })) as unknown as LoginUser[];
      if (legacyCandidates.length === 1) user = legacyCandidates[0];
      if (legacyCandidates.length > 1) redirect(homeUrl({ err: "AMBIGUOUS_USERNAME", lang }));
    }

    if (!user) redirect(homeUrl({ err: "BAD_CREDENTIALS", lang }));
    if (!verifyPassword(password, user.passwordHash)) redirect(homeUrl({ err: "BAD_CREDENTIALS", lang }));

    if (user.role === "EMPLOYEE" && !user.employee?.id) {
      redirect(homeUrl({ err: "NO_EMPLOYEE_ACCOUNT", lang }));
    }
    const token =
      user.role === "EMPLOYEE"
        ? signSession(
            {
              uid: user.id,
              role: "EMPLOYEE",
              eid: user.employee?.id ?? "",
              sv: user.sessionVersion,
              exp: Date.now() + 1000 * 60 * 60 * 24 * 14,
            },
            secret,
          )
        : signSession(
            { uid: user.id, role: user.role, sv: user.sessionVersion, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 },
            secret,
          );

    const h = await headers();
    cookieStore.set("esop_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: requestIsHttps(h),
      maxAge: 60 * 60 * 24 * 14,
    });
    cookieStore.delete("esop_role");
    cookieStore.delete("esop_user_id");
    cookieStore.delete("esop_employee_id");
    if (user.role === "EMPLOYEE") redirect(lang && lang !== "zh-CN" ? `/me?lang=${encodeURIComponent(lang)}` : "/me");
    const focus = user.role === "FINANCE" ? "ledger" : user.role === "SUPER_ADMIN" ? "approvals" : "";
    redirect(adminUrl({ lang, focus }));
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) {
      throw e;
    }
    const code = e instanceof Error ? e.message : "";
    if (code === "SESSION_SECRET_MISSING") redirect(homeUrl({ err: "SESSION_SECRET_MISSING", lang }));
    redirect(homeUrl({ err: "LOGIN_FAILED", lang }));
  }
}

export async function changePassword(formData: FormData) {
  const langRaw = String(formData.get("lang") ?? "").trim();
  const lang = langRaw === "zh-TW" || langRaw === "en" || langRaw === "zh-CN" ? langRaw : "zh-CN";
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? `/admin${lang && lang !== "zh-CN" ? `?lang=${encodeURIComponent(lang)}` : ""}`;

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  try {
    if (newPassword.length < 8) redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=PASSWORD_TOO_SHORT`);
    if (newPassword !== confirmPassword) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=PASSWORD_MISMATCH`);
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("esop_session")?.value ?? "";
    const payload = token ? verifySession(token, getSessionSecret()) : null;
    if (!payload?.uid) {
      const next = homeUrl({ err: "SESSION_EXPIRED", lang });
      redirect(`/logout?next=${encodeURIComponent(next)}`);
    }

    const user = (await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, passwordHash: true, sessionVersion: true } as unknown as {
        id: true;
        passwordHash: true;
        sessionVersion: true;
      },
    })) as unknown as { id: string; passwordHash: string; sessionVersion: number } | null;
    if (!user) {
      const next = homeUrl({ err: "SESSION_EXPIRED", lang });
      redirect(`/logout?next=${encodeURIComponent(next)}`);
    }

    const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
    if (payloadSv !== user.sessionVersion) {
      const next = homeUrl({ err: "SESSION_EXPIRED", lang });
      redirect(`/logout?next=${encodeURIComponent(next)}`);
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=BAD_CURRENT_PASSWORD`);
    }

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(newPassword),
            sessionVersion: { increment: 1 },
          } as unknown as { passwordHash: string; sessionVersion: { increment: number } },
        } as unknown as Parameters<typeof prisma.user.update>[0]);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        const locked = msg.includes("database is locked") || msg.includes("SQLITE_BUSY");
        if (!locked || attempt === 2) throw e;
        await sleep(120 * (attempt + 1));
      }
    }

    const next = homeUrl({ err: "PASSWORD_UPDATED", lang });
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) {
      throw e;
    }
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=CHANGE_PASSWORD_FAILED`);
  }
}
