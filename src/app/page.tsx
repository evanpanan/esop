import { ensureBootstrapAdmin, login } from "@/app/actions/session";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionSecret, verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Lang = "zh-CN" | "zh-TW" | "en";
function parseLang(v: string | undefined): Lang {
  if (v === "zh-TW" || v === "en" || v === "zh-CN") return v;
  return "zh-CN";
}

const TEXT = {
  "zh-CN": {
    title: "ESOP 期权管理系统",
    subtitle: "员工端与管理端统一入口",
    feature1Title: "角色自动分流",
    feature1Desc: "登录后自动进入管理端或员工端。",
    feature2Title: "审批与留痕",
    feature2Desc: "关键变更走流程，结果可追溯。",
    feature3Title: "口径一致",
    feature3Desc: "币种、股价、期权池水位统一展示。",
    err: "登录/操作失败",
    loginTitle: "登录系统",
    loginDesc: "输入账号/邮箱与密码登录。",
    email: "用户名/邮箱",
    password: "密码",
    login: "登录",
    help: "忘记密码请联系管理员重置。",
    passwordUpdated: "密码已更新，请重新登录。",
    sessionExpired: "登录态已失效，请重新登录。",
    ambiguousUsername: "该用户名对应多个账号，请使用邮箱登录。",
    loginFailed: "登录失败，请重试。",
    badCredentials: "账号或密码不正确。",
    invalidEmail: "请输入正确的邮箱或用户名。",
    invalidPassword: "密码格式不正确。",
    noEmployeeAccount: "该员工未开通登录账号，请联系管理员开通/重置密码。",
    sessionSecretMissing: "服务端未配置 SESSION_SECRET，无法登录。",
  },
  "zh-TW": {
    title: "ESOP 期權管理系統",
    subtitle: "員工端與管理端統一入口",
    feature1Title: "角色自動分流",
    feature1Desc: "登入後自動進入管理端或員工端。",
    feature2Title: "審批與留痕",
    feature2Desc: "關鍵變更走流程，結果可追溯。",
    feature3Title: "口徑一致",
    feature3Desc: "幣種、股價、期權池水位一致展示。",
    err: "登入/操作失敗",
    loginTitle: "登入系統",
    loginDesc: "輸入帳號/郵箱與密碼登入。",
    email: "用戶名/郵箱",
    password: "密碼",
    login: "登入",
    help: "忘記密碼請聯繫管理員重置。",
    passwordUpdated: "密碼已更新，請重新登入。",
    sessionExpired: "登入態已失效，請重新登入。",
    ambiguousUsername: "該用戶名對應多個帳號，請使用郵箱登入。",
    loginFailed: "登入失敗，請再試一次。",
    badCredentials: "帳號或密碼不正確。",
    invalidEmail: "請輸入正確的郵箱或用戶名。",
    invalidPassword: "密碼格式不正確。",
    noEmployeeAccount: "該員工未開通登入帳號，請聯繫管理員開通/重置密碼。",
    sessionSecretMissing: "服務端未配置 SESSION_SECRET，無法登入。",
  },
  en: {
    title: "ESOP System",
    subtitle: "Unified entry for Employee/Admin",
    feature1Title: "Role-based routing",
    feature1Desc: "You will be redirected based on your role after login.",
    feature2Title: "Approvals & audit",
    feature2Desc: "Key changes are reviewable and traceable.",
    feature3Title: "Consistent pricing",
    feature3Desc: "Unified view for currency, price, and pool health.",
    err: "Login/Action failed",
    loginTitle: "Sign in",
    loginDesc: "Enter account/email and password.",
    email: "Username / Email",
    password: "Password",
    login: "Login",
    help: "Forgot password? Contact your admin.",
    passwordUpdated: "Password updated. Please log in again.",
    sessionExpired: "Session expired. Please log in again.",
    ambiguousUsername: "This username matches multiple accounts. Please log in with email.",
    loginFailed: "Login failed. Please try again.",
    badCredentials: "Incorrect username/email or password.",
    invalidEmail: "Please enter a valid email or username.",
    invalidPassword: "Invalid password.",
    noEmployeeAccount: "This employee doesn't have an account. Ask an admin to enable/reset it.",
    sessionSecretMissing: "Server is missing SESSION_SECRET. Login is disabled.",
  },
} as const;

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ err?: string; lang?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const err = (sp.err ?? "").trim();
  const lang = parseLang((sp.lang ?? "").trim() || undefined);
  const t = TEXT[lang];

  await ensureBootstrapAdmin();
  const settings = (await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: { brandLogoDataUrl: true } as never,
  })) as unknown as { brandLogoDataUrl: string | null } | null;
  const brandLogoDataUrl = String(settings?.brandLogoDataUrl ?? "").trim();
  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const dbUser = payload?.uid
    ? ((await prisma.user.findUnique({
        where: { id: payload.uid },
        select: { id: true, role: true, sessionVersion: true, employee: { select: { id: true } } } as unknown as {
          id: true;
          role: true;
          sessionVersion: true;
          employee: { select: { id: true } };
        },
      })) as unknown as { id: string; role: string; sessionVersion: number; employee: { id: string } | null } | null)
    : null;
  const payloadSv = typeof payload?.sv === "number" ? payload?.sv : 0;
  const effectivePayload =
    payload && dbUser && payloadSv === dbUser.sessionVersion ? payload : null;

  const role = effectivePayload?.role ?? null;
  if (err === "SESSION_EXPIRED" && token) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }
  if (role === "EMPLOYEE") {
    const payloadEid = String(effectivePayload?.eid ?? "").trim();
    const dbEid = String(dbUser?.employee?.id ?? "").trim();
    if (!payloadEid || !dbEid || payloadEid !== dbEid) {
      const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
      redirect(`/logout?next=${encodeURIComponent(next)}`);
    }
  }
  if (role === "EMPLOYEE") redirect("/me");
  if (role) redirect("/admin");

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#f8fafc] px-6 py-14">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-[-120px] h-[520px] w-[520px] rounded-full bg-emerald-200/25 blur-3xl" />

      <main className="relative w-full max-w-5xl">
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          <section className="ui-card hidden p-7 lg:order-1 lg:block">
            <div className="flex items-start gap-4">
              {brandLogoDataUrl ? (
                <img
                  src={brandLogoDataUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-2xl border border-black/5 bg-white object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white">
                  E
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t.title}</h1>
                <p className="mt-1 text-sm leading-6 text-zinc-600">{t.subtitle}</p>
              </div>
            </div>

            <div className="mt-7 grid grid-cols-1 gap-3">
              <div className="flex items-start gap-3 rounded-2xl bg-[#f8fafc] px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-white text-zinc-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900">{t.feature1Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature1Desc}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-[#f8fafc] px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-white text-zinc-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 2 20 6v6c0 5-3.5 9.4-8 10-4.5-.6-8-5-8-10V6l8-4Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path d="m9 12 2 2 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900">{t.feature2Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature2Desc}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-[#f8fafc] px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-white text-zinc-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4 19h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M7 15l4-4 3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900">{t.feature3Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature3Desc}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="ui-card order-1 p-7 lg:order-2">
            <div>
              <div className="mb-5 flex items-center gap-3 lg:hidden">
                {brandLogoDataUrl ? (
                  <img
                    src={brandLogoDataUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-2xl border border-black/5 bg-white object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white">
                    E
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold tracking-tight text-zinc-900">{t.title}</div>
                  <div className="mt-0.5 truncate text-xs text-zinc-600">{t.subtitle}</div>
                </div>
              </div>
              <h2 className="text-lg font-semibold text-zinc-900">{t.loginTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">{t.loginDesc}</p>
            </div>

            {err ? (
              <div
                className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
                  err === "PASSWORD_UPDATED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {err === "PASSWORD_UPDATED"
                  ? t.passwordUpdated
                  : err === "SESSION_EXPIRED"
                    ? t.sessionExpired
                    : err === "AMBIGUOUS_USERNAME"
                      ? t.ambiguousUsername
                      : err === "BAD_CREDENTIALS"
                        ? t.badCredentials
                        : err === "INVALID_EMAIL"
                          ? t.invalidEmail
                          : err === "INVALID_PASSWORD"
                            ? t.invalidPassword
                            : err === "NO_EMPLOYEE_ACCOUNT"
                              ? t.noEmployeeAccount
                              : err === "SESSION_SECRET_MISSING"
                                ? t.sessionSecretMissing
                                : err === "LOGIN_FAILED"
                                  ? t.loginFailed
                    : `${t.err}：${err}`}
              </div>
            ) : null}

            <form action={login} className="mt-6 flex flex-col gap-4">
              <input type="hidden" name="lang" value={lang} />
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium text-zinc-600">{t.email}</span>
                <input
                  name="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  className="h-11 w-full rounded-2xl border border-black/5 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-black/10"
                  required
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium text-zinc-600">{t.password}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-11 w-full rounded-2xl border border-black/5 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-black/10"
                  required
                />
              </label>
              <button className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
                {t.login}
              </button>
              <div className="text-xs text-zinc-500">{t.help}</div>
            </form>

            <details className="mt-5 rounded-2xl bg-[#f8fafc] px-4 py-3 lg:hidden shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900">
                {lang === "en" ? "Product highlights" : lang === "zh-TW" ? "產品亮點" : "产品亮点"}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                  <div className="text-sm font-medium text-zinc-900">{t.feature1Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature1Desc}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                  <div className="text-sm font-medium text-zinc-900">{t.feature2Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature2Desc}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                  <div className="text-sm font-medium text-zinc-900">{t.feature3Title}</div>
                  <div className="mt-0.5 text-sm leading-6 text-zinc-600">{t.feature3Desc}</div>
                </div>
              </div>
            </details>
          </section>
        </div>
      </main>
    </div>
  );
}
