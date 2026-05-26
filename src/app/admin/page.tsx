import { prisma } from "@/lib/prisma";
import { createGrantWithVesting, matureVestingRecords, setEmployeeStatus, verifyUsdtPaymentByTxHash } from "@/lib/esop";
import { Prisma, Role } from "@prisma/client";
import { DebouncedSearch } from "@/app/DebouncedSearch";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSessionSecret, hashPassword, verifyPassword, verifySession } from "@/lib/auth";
import { cookies, headers } from "next/headers";
import { changePassword, logout } from "@/app/actions/session";
import VestingConfigurator from "./VestingConfigurator";
import { OptionPoolDonut } from "./OptionPoolDonut";
import { GrantSharesValueInput } from "./GrantSharesValueInput";
import { StrikePriceDiscountInput } from "./StrikePriceDiscountInput";
import { AnimatedProgressBar, BackButton, ErrorToast, LiveCompanySharePrice, LiveSharePriceAvg30, SuccessToast } from "@/app/ClientAnimations";
import AdminFocusScroll from "./AdminFocusScroll";
import AdminHeader from "./AdminHeader";
import AdminTopNav from "./AdminTopNav";
import AdminCurrencyLangSwitch from "./AdminCurrencyLangSwitch";
import EmployeePicker from "./EmployeePicker";
import { FileText, PencilLine, Trash2 } from "lucide-react";
import { BUSINESS_TIMEZONE, ymdInTimeZone } from "@/lib/datetime";
import { fileToImageDataUrl, readImageFileFromFormData } from "@/lib/imageDataUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleName = "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE";
type Currency = "USD" | "HKD" | "CNY";
type Lang = "zh-CN" | "zh-TW" | "en";

function parseLang(v: string | undefined): Lang {
  if (v === "zh-TW" || v === "en" || v === "zh-CN") return v;
  return "zh-CN";
}

function adminUrl(params: { err?: string; lang?: Lang; modal?: string }) {
  const p = new URLSearchParams();
  if (params.err) p.set("err", params.err);
  if (params.lang && params.lang !== "zh-CN") p.set("lang", params.lang);
  if (params.modal) p.set("modal", params.modal);
  const qs = p.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

function withErr(url: string, err: string) {
  const raw = url.trim() || "/admin";
  const [path, qs = ""] = raw.split("?");
  const p = new URLSearchParams(qs);
  p.set("err", err);
  const out = p.toString();
  return out ? `${path}?${out}` : path;
}

function withOk(url: string, ok: string, extra: Record<string, string>) {
  const raw = url.trim() || "/admin";
  const [path, qs = ""] = raw.split("?");
  const p = new URLSearchParams(qs);
  p.delete("err");
  p.set("ok", ok);
  for (const [k, v] of Object.entries(extra)) {
    if (v) p.set(k, v);
  }
  const out = p.toString();
  return out ? `${path}?${out}` : path;
}

function withParam(url: string, key: string, value: string) {
  const raw = url.trim() || "/admin";
  const [path, qs = ""] = raw.split("?");
  const p = new URLSearchParams(qs);
  if (value) p.set(key, value);
  const out = p.toString();
  return out ? `${path}?${out}` : path;
}

function withModal(url: string, modal: string) {
  return withParam(url, "modal", modal);
}

function maskSensitive(input: string) {
  const v = String(input ?? "").trim();
  if (!v) return "—";
  if (v.length <= 10) return v;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function watermarkSvgDataUrl(text: string) {
  const t = String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280"><g fill="rgba(15,23,42,0.12)" font-family="ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace" font-size="14"><text x="16" y="40">${t}</text><text x="86" y="120">${t}</text><text x="16" y="200">${t}</text><text x="156" y="260">${t}</text></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function safeReturnTo(raw: string) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("/admin")) return null;
  return v;
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="img"
        aria-label="说明"
        title="说明"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[10px] font-semibold text-zinc-700 outline-none group-hover:bg-white group-focus-within:border-zinc-300"
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-5 z-[80] hidden w-64 -translate-x-1/2 rounded-xl border border-black/5 bg-white/80 px-2.5 py-2 text-[11px] leading-4 text-zinc-700 shadow-xl backdrop-blur-md group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

function formatInt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function parseCurrency(v: string | undefined): Currency {
  if (v === "HKD" || v === "CNY" || v === "USD") return v;
  return "USD";
}

function currencyToUsdRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

function convertMoney(amount: Prisma.Decimal, from: Currency, to: Currency) {
  if (from === to) return amount;
  const fromRate = currencyToUsdRate(from);
  const usd = from === "USD" ? amount : amount.div(fromRate);
  const toRate = currencyToUsdRate(to);
  return to === "USD" ? usd : usd.mul(toRate);
}

function formatMoney(d: Prisma.Decimal, currency: Currency, baseCurrency: Currency) {
  const converted = convertMoney(d, baseCurrency, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(converted.toFixed(2)));
}

function dateLocale(lang: Lang) {
  if (lang === "en") return "en-GB";
  if (lang === "zh-TW") return "zh-TW";
  return "zh-CN";
}

function formatDate(d: Date, lang: Lang) {
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatDateTime(d: Date, lang: Lang) {
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function addMonths(base: Date, months: number) {
  const m = Math.floor(Number(months));
  if (!Number.isFinite(m) || m <= 0) return new Date(base);

  const baseYear = base.getFullYear();
  const baseMonth = base.getMonth();
  const baseDay = base.getDate();

  const totalMonths = baseMonth + m;
  const targetYear = baseYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(baseDay, lastDayOfTargetMonth);

  return new Date(
    targetYear,
    targetMonth,
    targetDay,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds(),
  );
}

function changeRequestTypeLabel(t: string) {
  if (t === "EMPLOYEE_UPDATE") return "员工修改";
  if (t === "EMPLOYEE_DELETE") return "员工删除";
  if (t === "GRANT_CREATE") return "授予协议创建";
  if (t === "GRANT_UPDATE") return "协议修改";
  if (t === "GRANT_DELETE") return "协议删除";
  if (t === "DEPARTMENT_UPDATE") return "部门修改";
  if (t === "DEPARTMENT_DELETE") return "部门删除";
  return t;
}

function changeRequestStatusLabel(s: string) {
  if (s === "PENDING") return "待审批";
  if (s === "APPROVED") return "已批准";
  if (s === "REJECTED") return "已驳回";
  if (s === "APPLIED") return "已生效";
  return s;
}

function changeRequestEventActionLabel(a: string) {
  if (a === "SUBMITTED") return "提交";
  if (a === "APPROVED") return "批准";
  if (a === "REJECTED") return "驳回";
  if (a === "APPLIED") return "生效";
  return a;
}

function RenderPayload({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return (
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-black/5 bg-white px-3 py-2 text-xs text-zinc-800">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  const p = payload as Record<string, unknown>;
  const dict: Record<string, string> = {
    agreementNo: "协议编号",
    employeeId: "员工 ID",
    totalShares: "授予股数",
    grantDate: "授予日期",
    strikePrice: "行权价",
    lockupPeriodMonths: "锁定期（月）",
    vestingType: "成熟方式",
    totalVestingDurationMonths: "总成熟期（月）",
    vestingInstallments: "分期数",
    vestingRecordCount: "成熟记录数",
    name: "姓名",
    department: "部门",
    status: "状态",
    startDate: "入职日期",
    email: "邮箱",
  };

  const valFormat = (k: string, v: unknown) => {
    if (v === null || v === undefined) return "—";
    if (k.toLowerCase().includes("date") && typeof v === "string") {
      try {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return ymdInTimeZone(d, BUSINESS_TIMEZONE);
      } catch {}
    }
    if (k === "vestingType") {
      return v === "CUSTOM_INSTALLMENTS" ? "分期成熟" : v === "IMMEDIATE" ? "立即成熟" : String(v);
    }
    if (k === "status") {
      return v === "ACTIVE" ? "在职" : v === "TERMINATED" ? "离职" : String(v);
    }
    if (typeof v === "boolean") return v ? "是" : "否";
    if (k === "strikePrice" && typeof v === "number") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(v);
    }
    if (k === "totalShares" && typeof v === "number") return new Intl.NumberFormat("en-US").format(v);
    return String(v);
  };

  return (
    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 rounded-lg border border-black/5 bg-white px-4 py-3">
      {Object.entries(p).map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11px] font-medium text-zinc-500">{dict[k] || k}</span>
          <span className="break-all text-sm font-medium text-zinc-900" title={String(v)}>
            {valFormat(k, v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function jsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function readAllocationFromPaymentRaw(v: unknown) {
  const root = jsonObject(v);
  const alloc = root["allocation"];
  if (!Array.isArray(alloc)) return [] as Array<{ grantId: string; shares: number; lockupPeriodMonths?: number }>;
  const out: Array<{ grantId: string; shares: number; lockupPeriodMonths?: number }> = [];
  for (const it of alloc) {
    const o = jsonObject(it);
    const grantId = String(o["grantId"] ?? o["id"] ?? "").trim();
    const shares = Math.floor(Number(o["shares"]));
    const lmRaw = Number(o["lockupPeriodMonths"]);
    const lockupPeriodMonths = Number.isFinite(lmRaw) ? Math.max(0, Math.floor(lmRaw)) : undefined;
    if (!grantId || !Number.isFinite(shares) || shares <= 0) continue;
    out.push({ grantId, shares, ...(typeof lockupPeriodMonths === "number" ? { lockupPeriodMonths } : {}) });
  }
  return out;
}

function jsonString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function recordOrEmpty(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function extractUsdtReceivedFromRaw(input: {
  chain: "BNB" | "TRX";
  toAddress: string;
  raw: Prisma.InputJsonValue | null | undefined;
}) {
  const { chain, toAddress } = input;
  const raw = input.raw ?? null;
  if (!raw) return null;

  if (chain === "TRX") {
    const json = recordOrEmpty(raw);
    const trigger = recordOrEmpty((json["trigger_info"] ?? json["triggerInfo"]) as unknown);
    const params = recordOrEmpty((trigger["parameter"] ?? trigger["params"]) as unknown);
    const valueRaw = typeof params["_value"] === "string" ? params["_value"] : typeof params["value"] === "string" ? params["value"] : "";
    if (!valueRaw || !/^[0-9]+$/.test(valueRaw)) return null;
    try {
      const minor = BigInt(valueRaw);
      return new Prisma.Decimal(minor.toString()).div(new Prisma.Decimal("1000000"));
    } catch {
      return null;
    }
  }

  const root = recordOrEmpty(raw);
  const receipt = root["result"] as unknown;
  const receiptObj = recordOrEmpty(receipt);
  const logsUnknown = receiptObj["logs"];
  const logs = Array.isArray(logsUnknown) ? logsUnknown : [];
  const usdtContract = "0x55d398326f99059ff775485246999027b3197955";
  const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const toNorm = toAddress.toLowerCase().replace(/^0x/, "");

  let max: bigint = BigInt(0);
  for (const lUnknown of logs) {
    const l = recordOrEmpty(lUnknown);
    const addr = typeof l["address"] === "string" ? String(l["address"]).toLowerCase() : "";
    if (!addr || addr !== usdtContract) continue;
    const topicsUnknown = l["topics"];
    const topics = Array.isArray(topicsUnknown) ? topicsUnknown : [];
    const topic0 = typeof topics[0] === "string" ? String(topics[0]).toLowerCase() : "";
    if (!topic0 || topic0 !== transferSig) continue;
    const topic2 = typeof topics[2] === "string" ? String(topics[2]).toLowerCase() : "";
    const toTopic = topic2.replace(/^0x/, "");
    const toHex = toTopic.slice(toTopic.length - 40);
    if (!toHex || toHex !== toNorm) continue;
    const dataHex = typeof l["data"] === "string" ? String(l["data"]) : "0x0";
    try {
      const amount = BigInt(dataHex);
      if (amount > max) max = amount;
    } catch {
      continue;
    }
  }
  if (max <= 0) return null;
  return new Prisma.Decimal(max.toString()).div(new Prisma.Decimal("1000000000000000000"));
}

function requestRiskLevel(input: {
  r: {
    status: unknown;
    createdAt: Date;
    paymentChain: unknown;
    paymentToAddress: unknown;
    paymentTxHash: unknown;
    paymentProofDataUrl?: unknown;
    paymentAmountUsdt: unknown;
    paymentCheckError: unknown;
    paymentReceivedUsdt?: unknown;
  };
  settings: { usdtBnbAddress?: unknown; usdtTrxAddress?: unknown } | null;
}) {
  const { r, settings } = input;
  const chain = String(r.paymentChain ?? "").trim();
  const toAddr = String(r.paymentToAddress ?? "").trim();
  const tx = String(r.paymentTxHash ?? "").trim();
  const proof = String(r.paymentProofDataUrl ?? "").trim();
  const expected =
    chain === "BNB"
      ? String(settings?.usdtBnbAddress ?? "").trim()
      : chain === "TRX"
        ? String(settings?.usdtTrxAddress ?? "").trim()
        : "";

  const expectedUsdt = (r.paymentAmountUsdt ?? null) as Prisma.Decimal | null;
  const needPay = Boolean(expectedUsdt && expectedUsdt.gt(0));
  const missing = needPay ? !chain || !toAddr : false;
  const mismatch = needPay ? Boolean(expected && toAddr && expected !== toAddr) : false;
  const receivedUsdt = (r.paymentReceivedUsdt ?? null) as unknown as Prisma.Decimal | null;
  const hasDiff =
    expectedUsdt && expectedUsdt.gt(0) && receivedUsdt && receivedUsdt.gt(0)
      ? Number(receivedUsdt.sub(expectedUsdt).div(expectedUsdt).mul(100).toFixed(1))
      : null;
  const absDiff = typeof hasDiff === "number" ? Math.abs(hasDiff) : 0;

  const ageHours = (Date.now() - new Date(r.createdAt).getTime()) / (60 * 60 * 1000);
  const checkError = String(r.paymentCheckError ?? "").trim();

  if (missing || mismatch || absDiff >= 1 || ageHours >= 168) return "high" as const;
  if (absDiff >= 0.2 || checkError || ageHours >= 48) return "warn" as const;
  return "clean" as const;
}

function requestTags(input: {
  r: {
    createdAt: Date;
    paymentChain: unknown;
    paymentToAddress: unknown;
    paymentTxHash: unknown;
    paymentProofDataUrl?: unknown;
    paymentProofConfirmedAt?: unknown;
    paymentAmountUsdt: unknown;
    paymentCheckError: unknown;
    paymentCheckedAt?: unknown;
    paymentReceivedUsdt?: unknown;
  };
  settings: { usdtBnbAddress?: unknown; usdtTrxAddress?: unknown } | null;
}) {
  const { r, settings } = input;
  const chain = String(r.paymentChain ?? "").trim();
  const toAddr = String(r.paymentToAddress ?? "").trim();
  const tx = String(r.paymentTxHash ?? "").trim();
  const proof = String(r.paymentProofDataUrl ?? "").trim();
  const proofConfirmedAt = String(r.paymentProofConfirmedAt ?? "").trim();
  const expectedAddr =
    chain === "BNB"
      ? String(settings?.usdtBnbAddress ?? "").trim()
      : chain === "TRX"
        ? String(settings?.usdtTrxAddress ?? "").trim()
        : "";

  const tags: string[] = [];
  const expectedUsdt = (r.paymentAmountUsdt ?? null) as Prisma.Decimal | null;
  const needPay = Boolean(expectedUsdt && expectedUsdt.gt(0));
  if (needPay && expectedAddr && toAddr && expectedAddr !== toAddr) tags.push("addr_mismatch");
  if (proof && !proofConfirmedAt) tags.push("proof_pending");

  const receivedUsdt = (r.paymentReceivedUsdt ?? null) as unknown as Prisma.Decimal | null;
  if (needPay && receivedUsdt && receivedUsdt.gt(0)) {
    const exp = expectedUsdt as Prisma.Decimal;
    const diffPct = Number(receivedUsdt.sub(exp).div(exp).mul(100).toFixed(1));
    if (Math.abs(diffPct) >= 1) tags.push("diff_1");
  }

  if (needPay) {
    const ageHours = (Date.now() - new Date(r.createdAt).getTime()) / (60 * 60 * 1000);
    if (ageHours >= 48) tags.push("stale");
  }

  const checkError = String(r.paymentCheckError ?? "").trim();
  const checkedAt = r.paymentCheckedAt ? new Date(String(r.paymentCheckedAt)).getTime() : 0;
  if (needPay && checkedAt && checkError) tags.push("check_failed");

  return tags;
}

async function requireAdminRoles(allowed: RoleName[]) {
  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const role = (payload?.role ?? "") as RoleName;
  const userId = payload?.uid ?? "";
  if (!payload || !userId || !allowed.includes(role)) {
    redirect("/admin?err=FORBIDDEN");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, sessionVersion: true } });
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!user || user.role !== role) {
    redirect("/admin?err=FORBIDDEN");
  }
  if (payloadSv !== user.sessionVersion) {
    redirect("/logout?next=%2F%3Ferr%3DSESSION_EXPIRED");
  }
  return { userId, role };
}

async function enableSensitiveReveal(formData: FormData) {
  "use server";
  const { userId } = await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const password = String(formData.get("password") ?? "");
  if (password.trim().length < 8) redirect(withErr(returnTo, "PASSWORD_TOO_SHORT"));
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !verifyPassword(password, String(user.passwordHash ?? ""))) {
    redirect(withErr(returnTo, "BAD_CURRENT_PASSWORD"));
  }
  const cookieStore = await cookies();
  const proto = String((await headers()).get("x-forwarded-proto") ?? "").toLowerCase();
  const secure = proto === "https";
  cookieStore.set("esop_sensitive_reveal", "1", { httpOnly: true, sameSite: "lax", secure, maxAge: 5 * 60, path: "/admin" });
  redirect(withOk(returnTo, "SENSITIVE_REVEAL_ENABLED", {}));
}

async function disableSensitiveReveal(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const cookieStore = await cookies();
  cookieStore.delete("esop_sensitive_reveal");
  redirect(withOk(returnTo, "SENSITIVE_REVEAL_DISABLED", {}));
}

async function updateExerciseStatus(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  if (!id) redirect(withErr(returnTo, "INVALID_REQUEST"));
  if (status !== "COMPLETED") redirect(withErr(returnTo, "INVALID_REQUEST"));

  const existing = await prisma.exerciseRequest.findUnique({
    where: { id },
    select: {
      status: true,
      isBuybackOrCancel: true,
      grantId: true,
      paymentRaw: true,
      paymentAmountUsdt: true,
      paymentVerifiedAt: true,
      paymentCheckError: true,
    },
  });
  if (!existing) redirect(adminUrl({ err: "NO_REQUEST", lang }));

  const expectedUsdt = (existing.paymentAmountUsdt ?? null) as Prisma.Decimal | null;
  const needPay = Boolean(expectedUsdt && expectedUsdt.gt(0));

  if (String(existing.status ?? "") === status) {
    redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: status }));
  }
  if (needPay) {
    if (existing.status !== "FUNDED") {
      if (existing.status === "PENDING") redirect(withErr(returnTo, "MUST_FUND_BEFORE_COMPLETE"));
      redirect(withErr(returnTo, "INVALID_STATUS_FLOW"));
    }
    if (!existing.paymentVerifiedAt || String(existing.paymentCheckError ?? "").trim()) {
      redirect(withErr(returnTo, "PAYMENT_NOT_VERIFIED"));
    }
  }

  const now = new Date();
  const data: { status: "COMPLETED"; lockupUntil?: Date | null; completedAt?: Date | null; paymentCheckedAt?: Date | null; paymentVerifiedAt?: Date | null; paymentCheckError?: string | null } =
    {
    status: "COMPLETED",
  };

  const alloc = readAllocationFromPaymentRaw(existing.paymentRaw);
  const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
  const lockupMonths =
    !existing.isBuybackOrCancel && allocLockupMax > 0
      ? allocLockupMax
      : !existing.isBuybackOrCancel && existing.grantId
        ? Number(((await prisma.grant.findUnique({ where: { id: existing.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
        : 0;

  if (!existing.isBuybackOrCancel && lockupMonths > 0) {
    data.lockupUntil = addMonths(now, lockupMonths);
  } else {
    data.lockupUntil = null;
  }
  data.completedAt = now;
  if (!needPay) {
    data.paymentCheckedAt = now;
    data.paymentVerifiedAt = now;
    data.paymentCheckError = null;
  }

  await prisma.exerciseRequest.update({ where: { id }, data });

  redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
}

async function checkExercisePayment(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  if (!id) redirect(withErr(returnTo, "INVALID_REQUEST"));

  const r = await prisma.exerciseRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isBuybackOrCancel: true,
      grantId: true,
      paymentRaw: true,
      paymentChain: true,
      paymentToAddress: true,
      paymentTxHash: true,
      paymentAmountUsdt: true,
      paymentVerifiedAt: true,
      paymentCheckError: true,
    },
  });
  if (!r) redirect(withErr(returnTo, "NO_REQUEST"));
  if (r.status === "COMPLETED") {
    redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
  }

  if (r.status === "FUNDED" && r.paymentVerifiedAt && !String(r.paymentCheckError ?? "").trim()) {
    const now = new Date();
    const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
    const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
    const lockupMonths =
      !r.isBuybackOrCancel && allocLockupMax > 0
        ? allocLockupMax
        : !r.isBuybackOrCancel && r.grantId
          ? Number(((await prisma.grant.findUnique({ where: { id: r.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
          : 0;
    await prisma.exerciseRequest.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        lockupUntil: !r.isBuybackOrCancel && lockupMonths > 0 ? addMonths(now, lockupMonths) : null,
      },
    });
    redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
  }

  const chain = (r.paymentChain ?? "") as "BNB" | "TRX" | "";
  const toAddress = String(r.paymentToAddress ?? "").trim();
  const txHash = String(r.paymentTxHash ?? "").trim();
  const expectedUsdt = r.paymentAmountUsdt ?? null;
  if (expectedUsdt && expectedUsdt.lte(0)) {
    const now = new Date();
    const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
    const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
    const lockupMonths =
      !r.isBuybackOrCancel && allocLockupMax > 0
        ? allocLockupMax
        : !r.isBuybackOrCancel && r.grantId
          ? Number(((await prisma.grant.findUnique({ where: { id: r.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
          : 0;
    await prisma.exerciseRequest.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        lockupUntil: !r.isBuybackOrCancel && lockupMonths > 0 ? addMonths(now, lockupMonths) : null,
        paymentCheckedAt: now,
        paymentVerifiedAt: now,
        paymentCheckError: null,
      },
    });
    redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
  }
  if (!chain || (chain !== "BNB" && chain !== "TRX") || !toAddress || !txHash || !expectedUsdt) {
    await prisma.exerciseRequest.update({
      where: { id },
      data: { paymentCheckedAt: new Date(), paymentCheckError: "MISSING_PAYMENT_DATA" },
    });
    redirect(withErr(returnTo, "MISSING_PAYMENT_DATA"));
  }

  const check = await verifyUsdtPaymentByTxHash({ chain, txHash, toAddress, expectedUsdt });
  const received = extractUsdtReceivedFromRaw({ chain, toAddress, raw: check.raw ?? null });

  const mergedRaw = { ...jsonObject(r.paymentRaw), paymentCheck: check.raw ?? null } as unknown as Prisma.JsonObject;
  const data: Prisma.ExerciseRequestUncheckedUpdateInput = {
    status: check.ok ? "COMPLETED" : "PENDING",
    completedAt: check.ok ? check.checkedAt : null,
    paymentCheckedAt: check.checkedAt,
    paymentVerifiedAt: check.ok ? check.checkedAt : null,
    paymentCheckError: check.ok ? null : check.error,
    paymentRaw: mergedRaw,
    paymentReceivedUsdt: received,
    lockupUntil: null,
  };
  if (check.ok && !r.isBuybackOrCancel) {
    const alloc = readAllocationFromPaymentRaw((r as unknown as { paymentRaw?: unknown } | null)?.paymentRaw);
    const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
    const lockupMonths =
      allocLockupMax > 0
        ? allocLockupMax
        : r.grantId
          ? Number(((await prisma.grant.findUnique({ where: { id: r.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
          : 0;
    if (lockupMonths > 0) data.lockupUntil = addMonths(check.checkedAt, lockupMonths);
  }
  await prisma.exerciseRequest.update({ where: { id }, data });

  if (check.ok) {
    redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
  }
  redirect(withErr(returnTo, check.error));
}

async function completeExerciseByProof(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  if (!id) redirect(withErr(returnTo, "INVALID_REQUEST"));

  const r = await prisma.exerciseRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isBuybackOrCancel: true,
      grantId: true,
      paymentRaw: true,
      paymentProofDataUrl: true,
      paymentProofUploadedByRole: true,
    },
  });
  if (!r || r.isBuybackOrCancel) redirect(withErr(returnTo, "NO_REQUEST"));
  if (r.status === "COMPLETED") redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));

  const proof = String(r.paymentProofDataUrl ?? "").trim();
  const uploader = String(r.paymentProofUploadedByRole ?? "").trim();
  if (!proof || uploader !== "EMPLOYEE") redirect(withErr(returnTo, "MISSING_PAYMENT_PROOF"));

  const now = new Date();
  const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
  const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
  const lockupMonths =
    allocLockupMax > 0
      ? allocLockupMax
      : r.grantId
        ? Number(((await prisma.grant.findUnique({ where: { id: r.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
        : 0;
  const lockupUntil = lockupMonths > 0 ? addMonths(now, lockupMonths) : null;

  await prisma.exerciseRequest.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: now,
      lockupUntil,
      paymentCheckedAt: now,
      paymentVerifiedAt: now,
      paymentCheckError: null,
      paymentProofConfirmedAt: now,
      paymentProofConfirmedByRole: "SUPER_ADMIN",
    },
  });
  redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));
}

async function updateExercisePaymentMeta(formData: FormData) {
  "use server";
  const { userId, role } = await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const op = String(formData.get("op") ?? "").trim();
  if (!id) redirect(withErr(returnTo, "INVALID_REQUEST"));

  const existing = await prisma.exerciseRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isBuybackOrCancel: true,
      paymentRaw: true,
      paymentChain: true,
      paymentTxHash: true,
      paymentToAddress: true,
      paymentProofDataUrl: true,
      paymentProofUploadedAt: true,
      paymentProofUploadedByRole: true,
      paymentProofConfirmedAt: true,
      paymentProofConfirmedByRole: true,
    },
  });
  if (!existing || existing.isBuybackOrCancel) redirect(withErr(returnTo, "NO_REQUEST"));
  if (existing.status === "COMPLETED") redirect(withErr(returnTo, "INVALID_STATUS_FLOW"));

  const now = new Date();
  const chainRaw = String(formData.get("chain") ?? "").trim();
  const chain =
    chainRaw === "BNB" || chainRaw === "TRX"
      ? (chainRaw as "BNB" | "TRX")
      : ((String(existing.paymentChain ?? "").trim() as "BNB" | "TRX" | "") || "BNB");
  const txHash = String(formData.get("txHash") ?? "").trim();

  const assertTxHash = (c: "BNB" | "TRX", v: string) => {
    if (!v) return;
    if (c === "BNB") {
      if (!/^0x[a-fA-F0-9]{64}$/.test(v)) throw new Error("INVALID_TXHASH");
      return;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(v)) throw new Error("INVALID_TXHASH");
  };

  const settings = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: { usdtBnbAddress: true, usdtTrxAddress: true },
  });
  const toAddress =
    chain === "BNB"
      ? String(settings?.usdtBnbAddress ?? "").trim()
      : String(settings?.usdtTrxAddress ?? "").trim();

  let nextTx: string | null = existing.paymentTxHash ? String(existing.paymentTxHash) : null;
  let nextChain: "BNB" | "TRX" | null = existing.paymentChain ? (String(existing.paymentChain) as "BNB" | "TRX") : null;
  let nextTo: string | null = existing.paymentToAddress ? String(existing.paymentToAddress) : null;
  let nextProof: string | null = existing.paymentProofDataUrl ? String(existing.paymentProofDataUrl) : null;
  let nextProofUploadedAt: Date | null = existing.paymentProofUploadedAt ? new Date(existing.paymentProofUploadedAt) : null;
  let nextProofUploadedByRole: RoleName | null = existing.paymentProofUploadedByRole ? (String(existing.paymentProofUploadedByRole) as RoleName) : null;
  let nextProofConfirmedAt: Date | null = existing.paymentProofConfirmedAt ? new Date(existing.paymentProofConfirmedAt) : null;
  let nextProofConfirmedByRole: RoleName | null = existing.paymentProofConfirmedByRole ? (String(existing.paymentProofConfirmedByRole) as RoleName) : null;

  if (op === "clear_tx") {
    nextTx = null;
  } else if (op === "save_tx") {
    if (txHash) {
      try {
        assertTxHash(chain, txHash);
      } catch {
        redirect(withErr(returnTo, "INVALID_TXHASH"));
      }
      nextTx = txHash;
      nextChain = chain;
      nextTo = toAddress || null;
    } else {
      nextTx = null;
    }
  } else if (op === "clear_proof") {
    nextProof = null;
    nextProofUploadedAt = null;
    nextProofUploadedByRole = null;
    nextProofConfirmedAt = null;
    nextProofConfirmedByRole = null;
  } else if (op === "upload_proof") {
    const file = readImageFileFromFormData(formData, "paymentProof");
    if (!file) redirect(withErr(returnTo, "MISSING_PAYMENT_PROOF"));
    const paymentProofDataUrl = await fileToImageDataUrl(file, { maxBytes: 900 * 1024 });
    nextProof = paymentProofDataUrl;
    nextProofUploadedAt = now;
    nextProofUploadedByRole = role;
    nextProofConfirmedAt = null;
    nextProofConfirmedByRole = null;
  } else {
    redirect(withErr(returnTo, "INVALID_REQUEST"));
  }

  const raw = jsonObject(existing.paymentRaw);
  const adminEditsRaw = raw["adminEdits"];
  const adminEdits = Array.isArray(adminEditsRaw) ? adminEditsRaw.slice(0, 50) : [];
  adminEdits.push({
    at: now.toISOString(),
    uid: userId,
    role,
    op,
    txBefore: String(existing.paymentTxHash ?? "") || null,
    txAfter: nextTx,
    proofBefore: Boolean(String(existing.paymentProofDataUrl ?? "").trim()),
    proofAfter: Boolean(String(nextProof ?? "").trim()),
  });

  await prisma.exerciseRequest.update({
    where: { id },
    data: {
      paymentChain: nextChain,
      paymentToAddress: nextTo,
      paymentTxHash: nextTx,
      paymentProofDataUrl: nextProof,
      paymentProofUploadedAt: nextProofUploadedAt,
      paymentProofUploadedByRole: nextProofUploadedByRole as unknown as Role | null,
      paymentProofConfirmedAt: nextProofConfirmedAt,
      paymentProofConfirmedByRole: nextProofConfirmedByRole as unknown as Role | null,
      paymentCheckedAt: null,
      paymentVerifiedAt: null,
      paymentCheckError: null,
      paymentReceivedUsdt: null,
      status: "PENDING",
      paymentRaw: { ...raw, adminEdits } as unknown as Prisma.JsonObject,
    },
  });
  redirect(withOk(returnTo, "EXERCISE_PAYMENT_UPDATED", { rid: id }));
}

async function uploadBuybackProof(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  if (!id) redirect(withErr(returnTo, "INVALID_REQUEST"));

  const file = readImageFileFromFormData(formData, "paymentProof");
  if (!file) redirect(withErr(returnTo, "MISSING_PAYMENT_PROOF"));
  const paymentProofDataUrl = await fileToImageDataUrl(file, { maxBytes: 900 * 1024 });

  const r = await prisma.exerciseRequest.findUnique({
    where: { id },
    select: { id: true, status: true, isBuybackOrCancel: true, employeeId: true },
  });
  if (!r || !r.isBuybackOrCancel) redirect(withErr(returnTo, "NO_REQUEST"));
  if (r.status === "COMPLETED") redirect(withOk(returnTo, "EXERCISE_STATUS_UPDATED", { rid: id, nst: "COMPLETED" }));

  const now = new Date();
  await prisma.exerciseRequest.update({
    where: { id },
    data: {
      status: "FUNDED",
      paymentProofDataUrl,
      paymentProofUploadedAt: now,
      paymentProofUploadedByRole: "SUPER_ADMIN",
      paymentCheckedAt: now,
      paymentCheckError: null,
      paymentVerifiedAt: null,
      paymentProofConfirmedAt: null,
      paymentProofConfirmedByRole: null,
    },
  });
  redirect(withOk(returnTo, "BUYBACK_PROOF_UPLOADED", { rid: id }));
}

async function bulkExerciseAction(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const op = String(formData.get("op") ?? "").trim();
  const ids = formData.getAll("ids").map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) redirect(withErr(returnTo, "NO_SELECTION"));

  if (op === "check") {
    const rows = await prisma.exerciseRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        isBuybackOrCancel: true,
        grantId: true,
        paymentRaw: true,
        paymentChain: true,
        paymentToAddress: true,
        paymentTxHash: true,
        paymentAmountUsdt: true,
      },
    });

    let okCount = 0;
    let failCount = 0;
    const now = new Date();

    async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
      const out: R[] = new Array(items.length);
      let next = 0;
      const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (true) {
          const i = next;
          next += 1;
          if (i >= items.length) break;
          out[i] = await fn(items[i]);
        }
      });
      await Promise.all(workers);
      return out;
    }

    const missingRows: typeof rows = [];
    const checkRows: Array<{
      id: string;
      status: (typeof rows)[number]["status"];
      isBuybackOrCancel: boolean;
      grantId: string | null;
      paymentRaw: unknown;
      chain: "BNB" | "TRX";
      toAddress: string;
      txHash: string;
      expectedUsdt: Prisma.Decimal;
    }> = [];

    const grantIdSet = new Set<string>();
    for (const r of rows) {
      const chain = (r.paymentChain ?? "") as "BNB" | "TRX" | "";
      const toAddress = String(r.paymentToAddress ?? "").trim();
      const txHash = String(r.paymentTxHash ?? "").trim();
      const expectedUsdt = r.paymentAmountUsdt ?? null;
      if (!chain || (chain !== "BNB" && chain !== "TRX") || !toAddress || !txHash || !expectedUsdt) {
        missingRows.push(r);
        continue;
      }
      if (!r.isBuybackOrCancel && r.grantId) grantIdSet.add(r.grantId);
      checkRows.push({
        id: r.id,
        status: r.status,
        isBuybackOrCancel: Boolean(r.isBuybackOrCancel),
        grantId: r.grantId ?? null,
        paymentRaw: r.paymentRaw,
        chain,
        toAddress,
        txHash,
        expectedUsdt,
      });
    }

    const grants =
      grantIdSet.size > 0
        ? await prisma.grant.findMany({ where: { id: { in: Array.from(grantIdSet) } }, select: { id: true, lockupPeriodMonths: true } })
        : [];
    const grantLockupMap = new Map<string, number>(grants.map((g) => [g.id, Number((g as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)]));

    const results = await mapWithConcurrency(checkRows, 4, async (r) => {
      try {
        const check = await verifyUsdtPaymentByTxHash({
          chain: r.chain,
          txHash: r.txHash,
          toAddress: r.toAddress,
          expectedUsdt: r.expectedUsdt,
        });
        const received = extractUsdtReceivedFromRaw({ chain: r.chain, toAddress: r.toAddress, raw: check.raw ?? null });
        return { ...r, ok: check.ok, checkedAt: check.checkedAt, error: check.error, raw: check.raw ?? null, received };
      } catch {
        return { ...r, ok: false, checkedAt: now, error: "PAYMENT_CHECK_FAILED", raw: null, received: null };
      }
    });

    const updates: Array<ReturnType<typeof prisma.exerciseRequest.update>> = [];
    for (const r of missingRows) {
      failCount += 1;
      updates.push(
        prisma.exerciseRequest.update({
          where: { id: r.id },
          data: { paymentCheckedAt: now, paymentCheckError: "MISSING_PAYMENT_DATA" },
        }),
      );
    }

    for (const r of results) {
      if (r.ok) okCount += 1;
      else failCount += 1;
      const mergedRaw = { ...jsonObject(r.paymentRaw), paymentCheck: r.raw ?? null } as unknown as Prisma.JsonObject;
      let lockupUntil: Date | null = null;
      if (r.ok && !r.isBuybackOrCancel) {
        const alloc = readAllocationFromPaymentRaw((r as unknown as { paymentRaw?: unknown } | null)?.paymentRaw);
        const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
        const lockupMonths = allocLockupMax > 0 ? allocLockupMax : r.grantId ? Number(grantLockupMap.get(r.grantId) ?? 0) : 0;
        if (lockupMonths > 0) lockupUntil = addMonths(r.checkedAt, lockupMonths);
      }
      updates.push(
        prisma.exerciseRequest.update({
          where: { id: r.id },
          data: {
            status: r.ok ? "COMPLETED" : "PENDING",
            completedAt: r.ok ? r.checkedAt : null,
            lockupUntil,
            paymentCheckedAt: r.checkedAt,
            paymentVerifiedAt: r.ok ? r.checkedAt : null,
            paymentCheckError: r.ok ? null : r.error,
            paymentRaw: mergedRaw,
            paymentReceivedUsdt: r.received,
          } as Prisma.ExerciseRequestUncheckedUpdateInput,
        }),
      );
    }

    for (let i = 0; i < updates.length; i += 25) {
      await prisma.$transaction(updates.slice(i, i + 25));
    }

    redirect(withOk(returnTo, "BULK_STATUS_UPDATED", { nst: "COMPLETED", okc: String(okCount), failc: String(failCount) }));
  }

  if (op !== "complete") redirect(withErr(returnTo, "NO_BULK_OP"));

  const targetStatus = "COMPLETED";
  const rows = await prisma.exerciseRequest.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, isBuybackOrCancel: true, grantId: true, paymentRaw: true, paymentCheckError: true, paymentVerifiedAt: true },
  });
  let okCount = 0;
  let failCount = 0;
  let failNotFunded = 0;
  let failRisky = 0;
  for (const r of rows) {
    if (String(r.status ?? "") === targetStatus) {
      okCount += 1;
      continue;
    }
    if (targetStatus === "COMPLETED") {
      if (r.status !== "FUNDED") {
        failNotFunded += 1;
        failCount += 1;
        continue;
      }
      if (!r.paymentVerifiedAt || String(r.paymentCheckError ?? "").trim()) {
        failRisky += 1;
        failCount += 1;
        continue;
      }
    }

    const data: { status: "FUNDED" | "COMPLETED"; lockupUntil?: Date | null } = {
      status: targetStatus as "FUNDED" | "COMPLETED",
    };
    if (targetStatus === "COMPLETED") {
      const alloc = readAllocationFromPaymentRaw((r as unknown as { paymentRaw?: unknown } | null)?.paymentRaw);
      const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
      const lockupMonths =
        !r.isBuybackOrCancel && allocLockupMax > 0
          ? allocLockupMax
          : !r.isBuybackOrCancel && r.grantId
            ? Number(((await prisma.grant.findUnique({ where: { id: r.grantId } })) as unknown as { lockupPeriodMonths?: number } | null)?.lockupPeriodMonths ?? 0)
            : 0;
      if (!r.isBuybackOrCancel && lockupMonths > 0) {
        data.lockupUntil = addMonths(new Date(), lockupMonths);
      } else {
        data.lockupUntil = null;
      }
    }

    await prisma.exerciseRequest.update({ where: { id: r.id }, data });
    okCount += 1;
  }

  redirect(
    withOk(returnTo, "BULK_STATUS_UPDATED", {
      nst: targetStatus,
      okc: String(okCount),
      failc: String(failCount),
      fnf: failNotFunded ? String(failNotFunded) : "",
      frk: failRisky ? String(failRisky) : "",
    }),
  );
}

async function createEmployee(formData: FormData) {
  "use server";
  const { role: actorRole } = await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const roleRaw = String(formData.get("role") ?? "").trim();
  const targetRole: RoleName =
    roleRaw === "SUPER_ADMIN" ? "SUPER_ADMIN" : roleRaw === "FINANCE" ? "FINANCE" : "EMPLOYEE";
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();
  const startDateRaw = String(formData.get("startDate") ?? "").trim();
  const startDate = startDateRaw ? new Date(startDateRaw) : null;
  const accountRaw = String(formData.get("account") ?? "").trim();
  const account = accountRaw.toLowerCase();
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = emailRaw ? emailRaw : undefined;
  const initialPassword = String(formData.get("initialPassword") ?? "");
  const wantsAccount = Boolean(initialPassword.trim() || accountRaw.trim() || emailRaw.trim());

  if (targetRole !== "EMPLOYEE") {
    if (actorRole !== "SUPER_ADMIN") {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }
    if (!account || account.length > 80) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    if (email && (!email.includes("@") || email.length > 120)) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    if (!initialPassword.trim() || initialPassword.length < 8) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    try {
      const dupAccount = await prisma.user.findUnique({ where: { account } as never, select: { id: true } });
      if (dupAccount) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
      if (email) {
        const dupEmail = await prisma.user.findUnique({ where: { email } as never, select: { id: true } });
        if (dupEmail) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
      }
      const created = await prisma.user.create({
        data: { account, email, role: targetRole as never, passwordHash: hashPassword(initialPassword) } as never,
        select: { id: true },
      });
      redirect(withOk(returnTo, "BACKOFFICE_USER_CREATED", { uid: created.id }));
    } catch (e) {
      if (isRedirectError(e)) {
        throw e;
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
      }
      redirect(withErr(returnTo, "CREATE_USER_FAILED"));
    }
  }

  if (actorRole === "FINANCE" && wantsAccount) {
    redirect(withErr(returnTo, "FORBIDDEN"));
  }

  if (!name || !department || !startDate || Number.isNaN(startDate.getTime())) {
    redirect(withErr(returnTo, "INVALID_EMPLOYEE"));
  }

  let createdId = "";
  try {
    const exists = await prisma.department.findUnique({ where: { name: department }, select: { id: true } });
    if (!exists) {
      redirect(withErr(returnTo, "INVALID_DEPARTMENT"));
    }

    if (email && (!email.includes("@") || email.length > 120)) {
      redirect(withErr(returnTo, "INVALID_EMAIL"));
    }
    if (wantsAccount && (!account || account.length > 80)) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    if (wantsAccount && initialPassword.trim().length < 8) {
      redirect(withErr(returnTo, "PASSWORD_TOO_SHORT"));
    }
    if (wantsAccount) {
      const dupAccount = await prisma.user.findUnique({ where: { account } as never, select: { id: true } });
      if (dupAccount) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
      if (email) {
        const dupEmail = await prisma.user.findUnique({ where: { email } as never, select: { id: true } });
        if (dupEmail) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
      }
    }

    if (wantsAccount) {
      const created = await prisma.employee.create({
        data: {
          name,
          department,
          startDate,
          status: "ACTIVE",
          user: {
            create: {
              account,
              email,
              role: "EMPLOYEE",
              passwordHash: hashPassword(initialPassword),
            } as never,
          },
        },
        select: { id: true },
      });
      createdId = created.id;
    } else {
      const created = await prisma.employee.create({
        data: {
          name,
          department,
          startDate,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      createdId = created.id;
    }
  } catch (e) {
    if (isRedirectError(e)) {
      throw e;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const metaTarget = (e.meta as { target?: unknown } | null)?.target;
      const keys = Array.isArray(metaTarget)
        ? (metaTarget as unknown[]).map((x: unknown) => String(x))
        : [];
      if (keys.includes("account")) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
      if (keys.includes("email")) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
      redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
    }
    redirect(withErr(returnTo, "CREATE_EMPLOYEE_FAILED"));
  }

  if (createdId) {
    redirect(withOk(returnTo, "EMP_CREATED", { eid: createdId }));
  }
  redirect(returnTo);
}

async function createDepartment(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const name = String(formData.get("departmentName") ?? "").trim();
  if (!name) redirect(withErr(returnTo ?? adminUrl({ lang }), "INVALID_DEPARTMENT"));
  try {
    await prisma.department.create({ data: { name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(withErr(returnTo ?? adminUrl({ lang }), "DUPLICATE_DEPARTMENT"));
    }
    redirect(withErr(returnTo ?? adminUrl({ lang }), "CREATE_DEPARTMENT_FAILED"));
  }
  redirect(withOk(returnTo ?? adminUrl({ lang }), "DEPT_CREATED", { dn: name }));
}

async function renameDepartment(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const departmentId = String(formData.get("departmentId") ?? "").trim();
  const newName = String(formData.get("newDepartmentName") ?? "").trim();
  if (!departmentId || !newName) {
    redirect(withErr(returnTo ?? adminUrl({ lang }), "INVALID_DEPARTMENT"));
  }
  const existing = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true },
  });
  if (!existing) redirect(withErr(returnTo ?? adminUrl({ lang }), "INVALID_DEPARTMENT"));
  if (existing.name === newName) {
    redirect(returnTo ?? adminUrl({ lang }));
  }
  const dup = await prisma.department.findUnique({ where: { name: newName }, select: { id: true } });
  if (dup && dup.id !== departmentId) {
    redirect(withErr(returnTo ?? adminUrl({ lang }), "DUPLICATE_DEPARTMENT"));
  }
  try {
    await prisma.$transaction([
      prisma.department.update({ where: { id: departmentId }, data: { name: newName } }),
      prisma.employee.updateMany({
        where: { department: existing.name },
        data: { department: newName },
      }),
    ]);
  } catch {
    redirect(withErr(returnTo ?? adminUrl({ lang }), "RENAME_DEPARTMENT_FAILED"));
  }
  redirect(withOk(returnTo ?? adminUrl({ lang }), "DEPT_RENAMED", { dn: newName }));
}

async function deleteDepartment(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const departmentId = String(formData.get("departmentId") ?? "").trim();
  if (!departmentId) redirect(withErr(returnTo ?? adminUrl({ lang }), "INVALID_DEPARTMENT"));
  const existing = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true },
  });
  if (!existing) redirect(withErr(returnTo ?? adminUrl({ lang }), "INVALID_DEPARTMENT"));
  const count = await prisma.employee.count({ where: { department: existing.name } });
  if (count > 0) {
    redirect(withErr(returnTo ?? adminUrl({ lang }), "DEPARTMENT_IN_USE"));
  }
  try {
    await prisma.department.delete({ where: { id: departmentId } });
  } catch {
    redirect(withErr(returnTo ?? adminUrl({ lang }), "DELETE_DEPARTMENT_FAILED"));
  }
  redirect(withOk(returnTo ?? adminUrl({ lang }), "DEPT_DELETED", { dn: existing.name }));
}

async function createGrant(formData: FormData) {
  "use server";
  const { userId, role } = await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const errorTo = withModal(returnTo, "error");
  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const totalShares = Number(formData.get("totalShares"));
  const grantDateRaw = String(formData.get("grantDate") ?? "").trim();
  const grantDate = grantDateRaw ? new Date(grantDateRaw) : null;
  const strikePrice = Number(formData.get("strikePrice"));
  const lockupPeriodMonths = Math.floor(Number(formData.get("lockup_period_months")));
  const vestingTypeRaw = String(formData.get("vesting_type") ?? "").trim();
  const vestingType =
    vestingTypeRaw === "IMMEDIATE"
      ? "IMMEDIATE"
      : vestingTypeRaw === "CUSTOM_INSTALLMENTS"
        ? "CUSTOM_INSTALLMENTS"
        : "CUSTOM_INSTALLMENTS";
  const totalVestingDurationMonths = Math.floor(Number(formData.get("total_vesting_duration")));
  const vestingInstallments = Math.floor(Number(formData.get("vesting_installments")));

  if (
    !employeeId ||
    !Number.isFinite(totalShares) ||
    totalShares <= 0 ||
    !grantDate ||
    Number.isNaN(grantDate.getTime()) ||
    !Number.isFinite(strikePrice) ||
    strikePrice < 0 ||
    !Number.isFinite(lockupPeriodMonths) ||
    lockupPeriodMonths < 0
  ) {
    redirect(withErr(errorTo, "INVALID_GRANT"));
  }

  if (vestingType === "CUSTOM_INSTALLMENTS") {
    if (
      !Number.isFinite(totalVestingDurationMonths) ||
      totalVestingDurationMonths <= 0 ||
      !Number.isFinite(vestingInstallments) ||
      vestingInstallments <= 0 ||
      totalVestingDurationMonths % vestingInstallments !== 0 ||
      totalShares < vestingInstallments
    ) {
      redirect(withErr(errorTo, "INVALID_VESTING"));
    }
  }

  if (role === "FINANCE") {
    const [settings2, grantAgg2, forfeitedAgg2, buybackCompletedAgg2] = await Promise.all([
      prisma.globalSettings.findFirst({
        orderBy: { createdAt: "desc" },
        select: { totalOptionPoolShares: true } as unknown as { totalOptionPoolShares: true },
      }),
      prisma.grant.aggregate({ _sum: { totalShares: true } }),
      prisma.vestingRecord.aggregate({
        where: { status: "FORFEITED" },
        _sum: { shares: true },
      }),
      prisma.exerciseRequest.aggregate({
        where: { status: "COMPLETED", isBuybackOrCancel: true },
        _sum: { requestedShares: true },
      }),
    ]);
    const totalPool = settings2?.totalOptionPoolShares ?? 0;
    const granted = grantAgg2._sum.totalShares ?? 0;
    const forfeited = forfeitedAgg2._sum.shares ?? 0;
    const buybackReturned = buybackCompletedAgg2._sum.requestedShares ?? 0;
    const used = Math.max(granted - forfeited - buybackReturned, 0);
    const remaining = Math.max(totalPool - used, 0);
    if (remaining < Math.floor(totalShares)) {
      redirect(withErr(errorTo, "POOL_EXCEEDED"));
    }

    const submitted = await prisma.changeRequest.create({
      data: {
        type: "GRANT_CREATE" as never,
        status: "PENDING",
        targetEmployeeId: employeeId,
        payload: {
          employeeId,
          totalShares: Math.floor(totalShares),
          grantDate: grantDate.toISOString(),
          strikePrice: Number(new Prisma.Decimal(strikePrice).toFixed(8)),
          lockupPeriodMonths,
          vestingType,
          totalVestingDurationMonths:
            vestingType === "CUSTOM_INSTALLMENTS" ? totalVestingDurationMonths : null,
          vestingInstallments:
            vestingType === "CUSTOM_INSTALLMENTS" ? vestingInstallments : null,
        },
        requestedByUserId: userId,
        events: { create: { action: "SUBMITTED", createdByUserId: userId } },
      },
      select: { id: true },
    });
    redirect(withOk(returnTo, "GRANT_SUBMITTED", { cr: submitted.id }));
  }

  try {
    const [settings2, grantAgg2, forfeitedAgg2, buybackCompletedAgg2] = await Promise.all([
      prisma.globalSettings.findFirst({
        orderBy: { createdAt: "desc" },
        select: { totalOptionPoolShares: true } as unknown as { totalOptionPoolShares: true },
      }),
      prisma.grant.aggregate({ _sum: { totalShares: true } }),
      prisma.vestingRecord.aggregate({
        where: { status: "FORFEITED" },
        _sum: { shares: true },
      }),
      prisma.exerciseRequest.aggregate({
        where: { status: "COMPLETED", isBuybackOrCancel: true },
        _sum: { requestedShares: true },
      }),
    ]);
    const totalPool = settings2?.totalOptionPoolShares ?? 0;
    const granted = grantAgg2._sum.totalShares ?? 0;
    const forfeited = forfeitedAgg2._sum.shares ?? 0;
    const buybackReturned = buybackCompletedAgg2._sum.requestedShares ?? 0;
    const used = Math.max(granted - forfeited - buybackReturned, 0);
    const remaining = Math.max(totalPool - used, 0);
    if (remaining < Math.floor(totalShares)) {
      redirect(withErr(errorTo, "POOL_EXCEEDED"));
    }

    const created = await createGrantWithVesting({
      employeeId,
      totalShares,
      grantDate,
      strikePrice,
      lockupPeriodMonths,
      vestingType,
      totalVestingDurationMonths:
        vestingType === "CUSTOM_INSTALLMENTS" ? totalVestingDurationMonths : undefined,
      vestingInstallments:
        vestingType === "CUSTOM_INSTALLMENTS" ? vestingInstallments : undefined,
    });

    await prisma.changeRequest.create({
      data: {
        type: "GRANT_CREATE" as never,
        status: "APPLIED",
        targetEmployeeId: employeeId,
        targetGrantId: created.id,
        payload: {
          agreementNo: created.agreementNo,
          employeeId,
          totalShares: Math.floor(totalShares),
          grantDate: grantDate.toISOString(),
          strikePrice: Number(new Prisma.Decimal(strikePrice).toFixed(8)),
          lockupPeriodMonths,
          vestingType,
          totalVestingDurationMonths:
            vestingType === "CUSTOM_INSTALLMENTS" ? totalVestingDurationMonths : null,
          vestingInstallments:
            vestingType === "CUSTOM_INSTALLMENTS" ? vestingInstallments : null,
          vestingRecordCount: created.vestingRecords.length,
        },
        requestedByUserId: userId,
        decidedByUserId: userId,
        decidedAt: new Date(),
        events: {
          create: [
            { action: "SUBMITTED", createdByUserId: userId },
            { action: "APPLIED", createdByUserId: userId },
          ],
        },
      },
    });
    redirect(withOk(returnTo, "GRANT_CREATED", { gid: created.id }));
  } catch (e) {
    if (isRedirectError(e)) {
      throw e;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2003") redirect(withErr(errorTo, "INVALID_EMPLOYEE"));
      if (e.code === "P2002") redirect(withErr(errorTo, "DUPLICATE_AGREEMENT_NO"));
      if (e.code === "P2025") redirect(withErr(errorTo, "INVALID_EMPLOYEE"));
    }
    if (e instanceof Prisma.PrismaClientValidationError) {
      redirect(withErr(errorTo, "INVALID_GRANT"));
    }
    if (e instanceof Prisma.PrismaClientInitializationError) {
      redirect(withErr(errorTo, "DB_INIT_FAILED"));
    }
    if (e instanceof Prisma.PrismaClientRustPanicError) {
      redirect(withErr(errorTo, "DB_PANIC"));
    }
    if (e instanceof Prisma.PrismaClientUnknownRequestError) {
      redirect(withErr(errorTo, "DB_REQUEST_FAILED"));
    }
    if (e instanceof Error) {
      if (e.message === "INVALID_VESTING_CONFIG") redirect(withErr(errorTo, "INVALID_VESTING"));
      if (e.message === "AGREEMENT_NO_GENERATION_FAILED") redirect(withErr(errorTo, "AGREEMENT_NO_GENERATION_FAILED"));

      const msg = String(e.message ?? "").replaceAll("\n", " ").replaceAll("\r", " ").trim();
      if (msg.includes("FOREIGN KEY constraint failed")) redirect(withErr(errorTo, "INVALID_EMPLOYEE"));
      if (msg.includes("UNIQUE constraint failed: Grant.agreementNo")) redirect(withErr(errorTo, "DUPLICATE_AGREEMENT_NO"));
      if (msg.includes("UNIQUE constraint failed: VestingRecord.grantId, VestingRecord.vestDate")) {
        redirect(withErr(errorTo, "DUPLICATE_VESTING_DATE"));
      }

      if (process.env.NODE_ENV !== "production") {
        const devMsg = msg.slice(0, 160);
        redirect(withErr(withParam(errorTo, "em", devMsg), "GRANT_FAILED_UNKNOWN"));
      }
    }
    redirect(withErr(errorTo, "CREATE_GRANT_FAILED"));
  }
}

async function runVestingNow(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  await matureVestingRecords(new Date());
  redirect(withOk(adminUrl({ lang }), "VESTING_RUN_OK", {}));
}

async function upsertSettings(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const companyName = String(formData.get("companyName") ?? "").trim();
  const sharePriceTicker = String(formData.get("sharePriceTicker") ?? "").trim();
  const totalOptionPoolShares = Number(formData.get("totalOptionPoolShares"));
  const terminationOptionExpiryDays = Number(formData.get("terminationOptionExpiryDays"));
  const usdtBnbAddress = String(formData.get("usdtBnbAddress") ?? "").trim();
  const usdtTrxAddress = String(formData.get("usdtTrxAddress") ?? "").trim();
  const useManualCompanySharePrice = String(formData.get("useManualCompanySharePrice") ?? "") === "on";
  const manualCompanySharePriceRaw = String(formData.get("manualCompanySharePrice") ?? "").trim();
  let manualCompanySharePrice: Prisma.Decimal | null = null;
  if (manualCompanySharePriceRaw) {
    try {
      manualCompanySharePrice = new Prisma.Decimal(manualCompanySharePriceRaw);
    } catch {
      redirect(adminUrl({ err: "INVALID_SETTINGS", lang, modal: "settings_edit" }));
    }
    if (manualCompanySharePrice.lte(0)) {
      redirect(adminUrl({ err: "INVALID_SETTINGS", lang, modal: "settings_edit" }));
    }
  }
  if (useManualCompanySharePrice && !manualCompanySharePrice) {
    redirect(adminUrl({ err: "INVALID_SETTINGS", lang, modal: "settings_edit" }));
  }
  const logoFile = formData.get("brandLogo");
  let brandLogoDataUrl: string | null = null;
  if (logoFile instanceof File) {
    if (logoFile.size > 0) {
      if (!logoFile.type || !logoFile.type.startsWith("image/")) {
        redirect(adminUrl({ err: "INVALID_LOGO_TYPE", lang, modal: "settings_edit" }));
      }
      if (logoFile.size > 256 * 1024) {
        redirect(adminUrl({ err: "LOGO_TOO_LARGE", lang, modal: "settings_edit" }));
      }
      const bytes = Buffer.from(await logoFile.arrayBuffer());
      const base64 = bytes.toString("base64");
      brandLogoDataUrl = `data:${logoFile.type};base64,${base64}`;
    }
  } else if (logoFile !== null) {
    redirect(adminUrl({ err: "INVALID_LOGO", lang, modal: "settings_edit" }));
  }
  if (
    companyName.length > 80 ||
    !Number.isFinite(totalOptionPoolShares) ||
    !Number.isFinite(terminationOptionExpiryDays) ||
    terminationOptionExpiryDays < 0 ||
    sharePriceTicker.length > 40 ||
    usdtBnbAddress.length > 80 ||
    usdtTrxAddress.length > 80
  ) {
    redirect(adminUrl({ err: "INVALID_SETTINGS", lang, modal: "settings_edit" }));
  }

  const existing = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
  const pool = Math.floor(totalOptionPoolShares);
  const expiryDays = Math.floor(terminationOptionExpiryDays);
  const ticker = sharePriceTicker;
  const bnbAddr = usdtBnbAddress;
  const trxAddr = usdtTrxAddress;

  if (!existing) {
    const data = {
      ...(brandLogoDataUrl ? { brandLogoDataUrl } : {}),
      companyName,
      useManualCompanySharePrice,
      manualCompanySharePrice,
      manualCompanySharePriceUpdatedAt:
        useManualCompanySharePrice && manualCompanySharePrice ? new Date() : null,
      sharePriceTicker: ticker,
      totalOptionPoolShares: pool,
      terminationOptionExpiryDays: expiryDays,
      usdtBnbAddress: bnbAddr,
      usdtTrxAddress: trxAddr,
    } as unknown as Prisma.GlobalSettingsUncheckedCreateInput;

    await prisma.globalSettings.create({
      data,
    });
  } else {
    const data = {
      ...(brandLogoDataUrl ? { brandLogoDataUrl } : {}),
      companyName,
      useManualCompanySharePrice,
      manualCompanySharePrice,
      ...(useManualCompanySharePrice && manualCompanySharePrice
        ? { manualCompanySharePriceUpdatedAt: new Date() }
        : { manualCompanySharePriceUpdatedAt: null }),
      sharePriceTicker: ticker,
      totalOptionPoolShares: pool,
      terminationOptionExpiryDays: expiryDays,
      usdtBnbAddress: bnbAddr,
      usdtTrxAddress: trxAddr,
    } as unknown as Prisma.GlobalSettingsUncheckedUpdateInput;

    await prisma.globalSettings.update({
      where: { id: existing.id },
      data,
    });
  }

  redirect(withOk(adminUrl({ lang }), "SETTINGS_UPDATED", {}));
}

async function uploadBrandLogo(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size <= 0) {
    redirect(withErr(returnTo, "NO_LOGO"));
  }
  if (!file.type || !file.type.startsWith("image/")) {
    redirect(withErr(returnTo, "INVALID_LOGO_TYPE"));
  }
  if (file.size > 256 * 1024) {
    redirect(withErr(returnTo, "LOGO_TOO_LARGE"));
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  const existing = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!existing) {
    await prisma.globalSettings.create({
      data: {
        brandLogoDataUrl: dataUrl,
        totalOptionPoolShares: 0,
        terminationOptionExpiryDays: 90,
      } as Prisma.GlobalSettingsUncheckedCreateInput,
    });
  } else {
    await prisma.globalSettings.update({
      where: { id: existing.id },
      data: { brandLogoDataUrl: dataUrl } as Prisma.GlobalSettingsUncheckedUpdateInput,
    });
  }

  redirect(withOk(returnTo, "LOGO_UPDATED", {}));
}

async function resetUserPasswordByEmail(formData: FormData) {
  "use server";
  const { userId: actorUserId } = await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const identifierRaw = String(formData.get("email") ?? "").trim();
  const identifier = identifierRaw.toLowerCase();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!identifier) redirect(withErr(returnTo, "INVALID_EMAIL"));
  if (newPassword.length < 8) redirect(withErr(returnTo, "PASSWORD_TOO_SHORT"));
  if (newPassword !== confirmPassword) redirect(withErr(returnTo, "PASSWORD_MISMATCH"));

  const root = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const user = identifier.includes("@")
    ? ((await prisma.user.findUnique({ where: { email: identifier } as never, select: { id: true } })) ??
      (await prisma.user.findUnique({ where: { account: identifier } as never, select: { id: true } })))
    : await prisma.user.findUnique({ where: { account: identifier } as never, select: { id: true } });
  if (!user) redirect(withErr(returnTo, "NO_USER"));
  if (root?.id && user.id === root.id && actorUserId !== root.id) {
    redirect(withErr(returnTo, "FORBIDDEN"));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      sessionVersion: { increment: 1 },
    },
  });

  redirect(withOk(returnTo, "PASSWORD_RESET_OK", { uid: user.id }));
}

async function resetEmployeePassword(formData: FormData) {
  "use server";
  const { userId: actorUserId } = await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!employeeId) redirect(withErr(returnTo, "INVALID_EMPLOYEE"));
  if (newPassword.length < 8) redirect(withErr(returnTo, "PASSWORD_TOO_SHORT"));
  if (newPassword !== confirmPassword) redirect(withErr(returnTo, "PASSWORD_MISMATCH"));

  const [root, employee] = await Promise.all([
    prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    }),
  ]);
  if (!employee) redirect(withErr(returnTo, "INVALID_EMPLOYEE"));
  if (!employee.userId) redirect(withErr(returnTo, "NO_EMPLOYEE_ACCOUNT"));
  if (root?.id && employee.userId === root.id && actorUserId !== root.id) {
    redirect(withErr(returnTo, "FORBIDDEN"));
  }

  await prisma.user.update({
    where: { id: employee.userId },
    data: {
      passwordHash: hashPassword(newPassword),
      sessionVersion: { increment: 1 },
    },
  });

  redirect(withOk(returnTo, "PASSWORD_RESET_OK", { eid: employeeId }));
}

async function purgeNonAdminData(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
  if (confirm !== "PURGE") redirect(withErr(returnTo, "CONFIRM_REQUIRED"));

  const pw = hashPassword("123456");

  const [adminUser, financeUser, evanUser] = await Promise.all([
    prisma.user.upsert({
      where: { account: "admin" } as never,
      update: { role: "SUPER_ADMIN" as never } as never,
      create: { account: "admin", email: "admin@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { account: "finance" } as never,
      update: { role: "FINANCE" as never } as never,
      create: { account: "finance", email: "finance@esop.test", passwordHash: pw, role: "FINANCE" } as never,
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { account: "evan" } as never,
      update: { role: "SUPER_ADMIN" as never } as never,
      create: { account: "evan", email: "evan@esop.test", passwordHash: pw, role: "SUPER_ADMIN" } as never,
      select: { id: true },
    }),
  ]);

  const keepUserIds = [adminUser.id, financeUser.id, evanUser.id];

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const keepEmployees = await tx.employee.findMany({
        where: {
          OR: [
            { userId: { in: keepUserIds } },
            { name: { in: ["Evan", "evan"] } },
          ],
        },
        select: { id: true },
      });
      const keepEmployeeIds = keepEmployees.map((e: { id: string }) => e.id);

      const keepGrants = keepEmployeeIds.length
        ? await tx.grant.findMany({ where: { employeeId: { in: keepEmployeeIds } }, select: { id: true } })
        : [];
      const keepGrantIds = keepGrants.map((g: { id: string }) => g.id);

      const deleteEmployees = await tx.employee.findMany({
        where: keepEmployeeIds.length ? { id: { notIn: keepEmployeeIds } } : {},
        select: { id: true },
      });
      const deleteEmployeeIds = deleteEmployees.map((e: { id: string }) => e.id);

      if (deleteEmployeeIds.length) {
        await tx.exerciseRequest.deleteMany({ where: { employeeId: { in: deleteEmployeeIds } } });
        await tx.vestingRecord.deleteMany({ where: { employeeId: { in: deleteEmployeeIds } } });
        await tx.grant.deleteMany({ where: { employeeId: { in: deleteEmployeeIds } } });
      }

      const deleteChangeRequests = await tx.changeRequest.findMany({
        where: {
          requestedByUserId: { notIn: keepUserIds },
          AND: [
            keepEmployeeIds.length
              ? { OR: [{ targetEmployeeId: null }, { targetEmployeeId: { notIn: keepEmployeeIds } }] }
              : {},
            keepGrantIds.length
              ? { OR: [{ targetGrantId: null }, { targetGrantId: { notIn: keepGrantIds } }] }
              : {},
          ],
        },
        select: { id: true },
      });
      const deleteChangeRequestIds = deleteChangeRequests.map((r: { id: string }) => r.id);
      if (deleteChangeRequestIds.length) {
        await tx.changeRequestEvent.deleteMany({ where: { changeRequestId: { in: deleteChangeRequestIds } } });
        await tx.changeRequest.deleteMany({ where: { id: { in: deleteChangeRequestIds } } });
      }

      if (deleteEmployeeIds.length) {
        await tx.employee.deleteMany({ where: { id: { in: deleteEmployeeIds } } });
      }

      await tx.department.deleteMany({});
      await tx.sharePriceHistory.deleteMany({});

      const remainingUserIds = (await tx.employee.findMany({ where: { userId: { not: null } }, select: { userId: true } }))
        .map((x: { userId: string | null }) => String(x.userId ?? ""))
        .filter(Boolean);

      await tx.user.deleteMany({
        where: {
          id: { notIn: keepUserIds },
          ...(remainingUserIds.length ? { NOT: { id: { in: remainingUserIds } } } : {}),
        } as never,
      });
    });
  } catch {
    redirect(withErr(returnTo, "PURGE_FAILED"));
  }

  redirect(withOk(returnTo, "DATA_PURGED", {}));
}

async function enableEmployeeAccount(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const accountRaw = String(formData.get("account") ?? "").trim();
  const account = accountRaw.toLowerCase();
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = emailRaw ? emailRaw : null;
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!employeeId) redirect(withErr(returnTo, "INVALID_EMPLOYEE"));
  if (newPassword.length < 8) redirect(withErr(returnTo, "PASSWORD_TOO_SHORT"));
  if (newPassword !== confirmPassword) redirect(withErr(returnTo, "PASSWORD_MISMATCH"));
  if (!account || account.length > 80) redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
  if (email && (!email.includes("@") || email.length > 120)) redirect(withErr(returnTo, "INVALID_EMAIL"));

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, userId: true },
  });
  if (!employee) redirect(withErr(returnTo, "INVALID_EMPLOYEE"));
  if (employee.userId) redirect(withErr(returnTo, "EMPLOYEE_ALREADY_HAS_ACCOUNT"));
  const existingAccount = await prisma.user.findUnique({ where: { account } as never, select: { id: true } });
  if (existingAccount) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } as never, select: { id: true } });
    if (existingEmail) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
  }

  const createdUser = await prisma.user.create({
    data: {
      account,
      email,
      role: "EMPLOYEE",
      passwordHash: hashPassword(newPassword),
    } as never,
    select: { id: true },
  });
  await prisma.employee.update({
    where: { id: employeeId },
    data: { userId: createdUser.id },
    select: { id: true },
  });

  redirect(withOk(returnTo, "EMP_ACCOUNT_ENABLED", { eid: employeeId }));
}

async function setSharePriceTickerOnly(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const baseReturnTo = returnTo ?? adminUrl({ lang });
  const tickerRaw = String(formData.get("sharePriceTicker") ?? "").trim();
  if (!tickerRaw) redirect(withErr(baseReturnTo, "INVALID_TICKER"));

  const existing = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!existing) {
    await prisma.globalSettings.create({
      data: {
        sharePriceTicker: tickerRaw,
        useManualCompanySharePrice: false,
        totalOptionPoolShares: 0,
        terminationOptionExpiryDays: 90,
      } as Prisma.GlobalSettingsUncheckedCreateInput,
      select: { id: true },
    });
  } else {
    await prisma.globalSettings.update({
      where: { id: existing.id },
      data: {
        sharePriceTicker: tickerRaw,
        useManualCompanySharePrice: false,
      },
    });
  }

  redirect(withOk(baseReturnTo, "TICKER_SET", {}));
}

async function setCompanyNameOnly(formData: FormData) {
  "use server";
  await requireAdminRoles(["SUPER_ADMIN"]);
  const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const baseReturnTo = returnTo ?? adminUrl({ lang });
  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName || companyName.length > 80) redirect(withErr(baseReturnTo, "INVALID_COMPANY_NAME"));

  const existing = await prisma.globalSettings.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!existing) {
    await prisma.globalSettings.create({
      data: {
        companyName,
        totalOptionPoolShares: 0,
        terminationOptionExpiryDays: 90,
      } as Prisma.GlobalSettingsUncheckedCreateInput,
      select: { id: true },
    });
  } else {
    await prisma.globalSettings.update({
      where: { id: existing.id },
      data: { companyName } as Prisma.GlobalSettingsUncheckedUpdateInput,
    });
  }

  redirect(withOk(baseReturnTo, "COMPANY_NAME_UPDATED", {}));
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    dept?: string;
    st?: string;
    lp?: string;
    edit?: string;
    emp?: string;
    ns?: string;
    cr?: string;
    crst?: string;
    ap?: string;
    risk?: string;
    tag?: string;
    ok?: string;
    eid?: string;
    gid?: string;
    uid?: string;
    rid?: string;
    pid?: string;
    back?: string;
    nst?: string;
    okc?: string;
    failc?: string;
    fnp?: string;
    fnf?: string;
    frk?: string;
    dn?: string;
    ccy?: string;
    lang?: string;
    modal?: string;
    deptEdit?: string;
    deptDelete?: string;
    view?: string;
    focus?: string;
    err?: string;
    em?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const dept = (sp.dept ?? "").trim();
  const stRaw = (sp.st ?? "").trim();
  const status = stRaw === "ACTIVE" || stRaw === "TERMINATED" ? stRaw : "";
  const lpRaw = (sp.lp ?? "").trim();
  const ledgerPage = Math.max(1, Number.parseInt(lpRaw || "1", 10) || 1);
  const edit = (sp.edit ?? "").trim();
  const emp = (sp.emp ?? "").trim();
  const nsRaw = (sp.ns ?? "").trim();
  const ns = nsRaw === "ACTIVE" || nsRaw === "TERMINATED" ? nsRaw : "";
  const crId = (sp.cr ?? "").trim();
  const ok = (sp.ok ?? "").trim();
  const okEmployeeId = (sp.eid ?? "").trim();
  const okGrantId = (sp.gid ?? "").trim();
  const okUserId = (sp.uid ?? "").trim();
  const okRequestId = (sp.rid ?? "").trim();
  const proofRequestId = (sp.pid ?? "").trim();
  const proofBackRaw = (sp.back ?? "").trim();
  const okNextStatusRaw = (sp.nst ?? "").trim();
  const okNextStatus = okNextStatusRaw === "FUNDED" || okNextStatusRaw === "COMPLETED" ? okNextStatusRaw : "";
  const okOkCountRaw = (sp.okc ?? "").trim();
  const okFailCountRaw = (sp.failc ?? "").trim();
  const okFailNotPendingRaw = (sp.fnp ?? "").trim();
  const okFailNotFundedRaw = (sp.fnf ?? "").trim();
  const okFailRiskyRaw = (sp.frk ?? "").trim();
  const okDeptName = (sp.dn ?? "").trim();
  const crstRaw = (sp.crst ?? "").trim();
  const crst =
    crstRaw === "PENDING" || crstRaw === "APPROVED" || crstRaw === "REJECTED" || crstRaw === "APPLIED"
      ? crstRaw
      : "";
  const apRaw = (sp.ap ?? "").trim().toLowerCase();
  const ap = apRaw === "todo" || apRaw === "mine" || apRaw === "audit" ? apRaw : "";
  const riskRaw = (sp.risk ?? "").trim().toLowerCase();
  const risk = riskRaw === "high" || riskRaw === "warn" || riskRaw === "clean" ? riskRaw : "";
  const tagRaw = (sp.tag ?? "").trim().toLowerCase();
  const tag =
    tagRaw === "missing_tx" ||
    tagRaw === "proof_pending" ||
    tagRaw === "addr_mismatch" ||
    tagRaw === "diff_1" ||
    tagRaw === "stale" ||
    tagRaw === "check_failed"
      ? tagRaw
      : "";
  const currency = parseCurrency((sp.ccy ?? "").trim() || undefined);
  const lang = parseLang((sp.lang ?? "").trim() || undefined);
  const modal = (sp.modal ?? "").trim();
  const deptEditId = (sp.deptEdit ?? "").trim();
  const deptDeleteId = (sp.deptDelete ?? "").trim();
  const viewRaw = (sp.view ?? "").trim().toLowerCase();
  const view = viewRaw === "all" ? "all" : "";
  const focusRaw = (sp.focus ?? "").trim().toLowerCase();
  const focusParam =
    focusRaw === "approvals" || focusRaw === "pool" || focusRaw === "workbench" || focusRaw === "ops" || focusRaw === "ledger"
      ? focusRaw
      : "";
  const err = (sp.err ?? "").trim();
  const errMsg = (sp.em ?? "").trim();
  const proofBack = safeReturnTo(proofBackRaw) ?? "/admin";

  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const currentUserId = payload?.uid ?? "";
  if (!payload || !currentUserId || (payload.role !== "SUPER_ADMIN" && payload.role !== "FINANCE")) {
    redirect("/");
  }
  const currentUser = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { id: true, account: true, email: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      account: true;
      email: true;
      role: true;
      sessionVersion: true;
    },
  });
  if (!currentUser || (currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "FINANCE")) {
    redirect("/");
  }
  const authedUser = currentUser as NonNullable<typeof currentUser>;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (payloadSv !== (authedUser as unknown as { sessionVersion: number }).sessionVersion) {
    redirect(lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`);
  }
  const isSuperAdmin = authedUser.role === "SUPER_ADMIN";
  const isFinance = authedUser.role === "FINANCE";
  const sensitiveReveal = cookieStore.get("esop_sensitive_reveal")?.value === "1";
  const watermarkText = `${authedUser.account} · ${String(authedUser.id ?? "").slice(-6)}`;
  const watermarkBg = watermarkSvgDataUrl(watermarkText);
  const defaultFocus = isFinance ? "ledger" : isSuperAdmin ? "approvals" : "";
  const focus = focusParam === "workbench" && !isSuperAdmin ? "" : focusParam;
  const showAll = view === "all";
  const needApprovalsSection = showAll || focus === "approvals";
  const approvalsTab =
    ap || (isSuperAdmin ? "todo" : isFinance ? "mine" : "");
  const needApprovalsTodo = needApprovalsSection && isSuperAdmin && (showAll || approvalsTab === "todo");
  const needApprovalsMine = needApprovalsSection && isFinance && (showAll || approvalsTab === "mine");
  const needApprovalsAudit = needApprovalsSection && isSuperAdmin && (showAll || approvalsTab === "audit");
  const needPoolFull = focus === "pool";
  const needPoolSummary = showAll || needPoolFull;
  const needWorkbenchFull = isSuperAdmin && focus === "workbench";
  const needOpsSection = focus === "ops";
  const needLedgerFull = focus === "ledger";
  const needLedgerSummary = showAll || needLedgerFull;
  const shouldAutoFocus =
    !focus &&
    !showAll &&
    !dept &&
    !q &&
    !status &&
    !edit &&
    !emp &&
    !crId &&
    !crst &&
    !risk &&
    !tag &&
    !modal &&
    !deptEditId &&
    !deptDeleteId &&
    !err &&
    !ok &&
    !okEmployeeId &&
    !okGrantId;
  if (shouldAutoFocus && defaultFocus) {
    const p = new URLSearchParams();
    if (currency && currency !== "USD") p.set("ccy", currency);
    if (lang && lang !== "zh-CN") p.set("lang", lang);
    p.set("focus", defaultFocus);
    const qs = p.toString();
    redirect(qs ? `/admin?${qs}` : "/admin");
  }
  const rootSuperAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const rootSuperAdminUserId = rootSuperAdmin?.id ?? "";
  const isRootSuperAdmin = Boolean(isSuperAdmin && rootSuperAdminUserId && authedUser.id === rootSuperAdminUserId);

  await matureVestingRecords(new Date());

  const okEmployeePromise =
    (ok === "EMP_CREATED" ||
      ok === "EMP_ACCOUNT_ENABLED" ||
      ok === "EMP_UPDATED" ||
      ok === "EMP_UPDATE_SUBMITTED" ||
      ok === "EMP_DELETE_SUBMITTED" ||
      ok === "PASSWORD_RESET_OK") &&
    okEmployeeId
      ? prisma.employee.findUnique({
          where: { id: okEmployeeId },
          select: { id: true, name: true, department: true },
        })
      : Promise.resolve(null);
  const okGrantPromise =
    ok === "GRANT_CREATED" && okGrantId
      ? prisma.grant.findUnique({
          where: { id: okGrantId },
          select: {
            id: true,
            agreementNo: true,
            totalShares: true,
            employeeId: true,
            employee: { select: { name: true, department: true } },
          },
        })
      : Promise.resolve(null);
  const okChangeRequestPromise =
    ok === "GRANT_SUBMITTED" && crId
      ? prisma.changeRequest.findUnique({
          where: { id: crId },
          select: { id: true, type: true, status: true, payload: true },
        })
      : Promise.resolve(null);

  const [settings, grantAgg, forfeitedAgg, buybackCompletedAgg, pendingExercises, pendingBuybacks, okEmployee, okGrant, okChangeRequest] = await Promise.all([
    prisma.globalSettings.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        brandLogoDataUrl: true,
        companyName: true,
        companySharePrice: true,
        sharePriceTicker: true,
        sharePriceCurrency: true,
        sharePriceAvg30Usd: true,
        updatedAt: true,
        usdtBnbAddress: true,
        usdtTrxAddress: true,
        totalOptionPoolShares: true,
        terminationOptionExpiryDays: true,
      } as unknown as {
        brandLogoDataUrl: true;
        companyName: true;
        companySharePrice: true;
        sharePriceTicker: true;
        sharePriceCurrency: true;
        sharePriceAvg30Usd: true;
        updatedAt: true;
        usdtBnbAddress: true;
        usdtTrxAddress: true;
        totalOptionPoolShares: true;
        terminationOptionExpiryDays: true;
      },
    }),
    needPoolSummary ? prisma.grant.aggregate({ _sum: { totalShares: true } }) : Promise.resolve({ _sum: { totalShares: 0 } } as never),
    needPoolSummary
      ? prisma.vestingRecord.aggregate({
          where: { status: "FORFEITED" },
          _sum: { shares: true },
        })
      : Promise.resolve({ _sum: { shares: 0 } } as never),
    needPoolSummary
      ? prisma.exerciseRequest.aggregate({
          where: { status: "COMPLETED", isBuybackOrCancel: true },
          _sum: { requestedShares: true },
        })
      : Promise.resolve({ _sum: { requestedShares: 0 } } as never),
    needWorkbenchFull
      ? prisma.exerciseRequest.findMany({
          where: { status: { in: ["PENDING", "FUNDED"] }, isBuybackOrCancel: false },
          orderBy: { createdAt: "asc" },
          include: {
            employee: { select: { name: true, department: true } },
            grant: { select: { agreementNo: true } },
          },
          take: 50,
        })
      : Promise.resolve([]),
    needWorkbenchFull
      ? prisma.exerciseRequest.findMany({
          where: { status: { in: ["PENDING", "FUNDED"] }, isBuybackOrCancel: true },
          orderBy: { createdAt: "asc" },
          include: {
            employee: { select: { name: true, department: true } },
            grant: { select: { agreementNo: true } },
          },
          take: 50,
        })
      : Promise.resolve([]),
    okEmployeePromise,
    okGrantPromise,
    okChangeRequestPromise,
  ] as const);

  const [
    pendingChangeRequestCount,
    pendingExerciseCount,
    pendingBuybackCount,
    pendingExerciseProofCount,
    pendingBuybackConfirmCount,
    grantCreateAuditCount,
    myChangeRequestCountsDb,
  ] = await Promise.all([
    isSuperAdmin ? prisma.changeRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    isSuperAdmin
      ? prisma.exerciseRequest.count({ where: { status: { in: ["PENDING", "FUNDED"] }, isBuybackOrCancel: false } })
      : Promise.resolve(0),
    isSuperAdmin ? prisma.exerciseRequest.count({ where: { status: { in: ["PENDING", "FUNDED"] }, isBuybackOrCancel: true } }) : Promise.resolve(0),
    isSuperAdmin
      ? prisma.exerciseRequest.count({
          where: {
            status: "PENDING",
            isBuybackOrCancel: false,
            paymentProofDataUrl: { not: null },
            paymentProofConfirmedAt: null,
          },
        })
      : Promise.resolve(0),
    isSuperAdmin
      ? prisma.exerciseRequest.count({
          where: {
            status: "FUNDED",
            isBuybackOrCancel: true,
            paymentProofDataUrl: { not: null },
            paymentProofConfirmedAt: null,
          },
        })
      : Promise.resolve(0),
    isSuperAdmin ? prisma.changeRequest.count({ where: { type: "GRANT_CREATE" as never, status: "APPLIED" } }) : Promise.resolve(0),
    isFinance
      ? prisma.changeRequest.groupBy({
          by: ["status"],
          _count: { _all: true },
          where: { requestedByUserId: currentUserId },
        })
      : Promise.resolve([]),
  ]);

  const myChangeRequestCountByStatus = new Map<string, number>();
  for (const r of myChangeRequestCountsDb as unknown as Array<{ status?: unknown; _count?: { _all?: unknown } }>) {
    const k = String(r.status ?? "");
    const v = typeof r._count?._all === "number" ? r._count._all : Number(r._count?._all ?? 0);
    if (k) myChangeRequestCountByStatus.set(k, Number.isFinite(v) ? v : 0);
  }
  const myChangeRequestPendingCount = myChangeRequestCountByStatus.get("PENDING") ?? 0;
  const myChangeRequestApprovedCount = myChangeRequestCountByStatus.get("APPROVED") ?? 0;
  const myChangeRequestRejectedCount = myChangeRequestCountByStatus.get("REJECTED") ?? 0;
  const myChangeRequestAppliedCount = myChangeRequestCountByStatus.get("APPLIED") ?? 0;
  const myChangeRequestAllCount = Array.from(myChangeRequestCountByStatus.values()).reduce((acc, n) => acc + n, 0);

  let departmentsDb =
    needOpsSection || needLedgerFull
      ? await prisma.department.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [];
  if ((needOpsSection || needLedgerFull) && departmentsDb.length === 0) {
    const distinctFromEmployees = await prisma.employee.findMany({
      distinct: ["department"],
      where: { department: { not: "" } },
      select: { department: true },
    });
    const names = Array.from(new Set(distinctFromEmployees.map((x) => String(x.department ?? "").trim()).filter(Boolean)));
    if (names.length > 0) {
      await prisma.department.createMany({
        data: names.map((name) => ({ name })),
      });
      departmentsDb = await prisma.department.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    }
  }

  const [employeeActiveCount, employeeTerminatedCount] = needLedgerSummary
    ? await Promise.all([
        prisma.employee.count({ where: { status: "ACTIVE" } }),
        prisma.employee.count({ where: { status: "TERMINATED" } }),
      ])
    : [0, 0];
  const employeeTotalCount = employeeActiveCount + employeeTerminatedCount;

  const approvalsListLimit = showAll ? 5 : 50;

  const pendingChangeRequests = isSuperAdmin && needApprovalsTodo
    ? await prisma.changeRequest.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: approvalsListLimit,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          payload: true,
          requestedByUser: { select: { email: true } },
          targetEmployee: { select: { id: true, name: true, department: true, status: true } },
        },
      })
    : [];

  const myChangeRequestsAll = isFinance && needApprovalsMine
    ? await prisma.changeRequest.findMany({
        where: { requestedByUserId: currentUserId },
        orderBy: { createdAt: "desc" },
        take: approvalsListLimit,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          payload: true,
          targetEmployee: { select: { id: true, name: true, department: true, status: true } },
          targetGrant: { select: { id: true, agreementNo: true } },
          decidedAt: true,
        },
      })
    : [];

  const myChangeRequestCounts = isFinance
    ? {
        ALL: myChangeRequestAllCount,
        PENDING: myChangeRequestPendingCount,
        APPROVED: myChangeRequestApprovedCount,
        REJECTED: myChangeRequestRejectedCount,
        APPLIED: myChangeRequestAppliedCount,
      }
    : { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, APPLIED: 0 };

  const myChangeRequests = crst
    ? myChangeRequestsAll.filter((r) => String(r.status) === crst)
    : myChangeRequestsAll;

  const grantCreateAudits = needApprovalsAudit
    ? await prisma.changeRequest.findMany({
        where: { type: "GRANT_CREATE" as never, status: "APPLIED" },
        orderBy: { createdAt: "desc" },
        take: approvalsListLimit,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          payload: true,
          requestedByUser: { select: { email: true } },
          targetGrant: {
            select: {
              agreementNo: true,
              employee: { select: { name: true, department: true } },
            },
          },
        },
      })
    : [];

  const changeRequestDetailRaw =
    modal === "cr_detail" && crId
      ? await prisma.changeRequest.findUnique({
          where: { id: crId },
          select: {
            id: true,
            type: true,
            status: true,
            payload: true,
            createdAt: true,
            decidedAt: true,
            requestedByUserId: true,
            requestedByUser: { select: { email: true } },
            decidedByUser: { select: { email: true } },
            targetEmployee: { select: { id: true, name: true, department: true, status: true } },
            targetGrant: { select: { agreementNo: true, employee: { select: { name: true, department: true } } } },
            events: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                action: true,
                note: true,
                createdAt: true,
                createdByUser: { select: { email: true } },
              },
            },
          },
        })
      : null;

  const changeRequestDetail =
    changeRequestDetailRaw && !isSuperAdmin && changeRequestDetailRaw.requestedByUserId !== currentUserId
      ? null
      : changeRequestDetailRaw;

  const grantHistoryEmployee =
    modal === "grant_history" && emp
      ? await prisma.employee.findUnique({
          where: { id: emp },
          select: { id: true, name: true, department: true, status: true },
        })
      : null;

  const resetPasswordEmployee =
    modal === "reset_password" && emp
      ? await prisma.employee.findUnique({
          where: { id: emp },
          select: {
            id: true,
            name: true,
            department: true,
            status: true,
            userId: true,
            user: { select: { email: true } },
          },
        })
      : null;

  const statusConfirmEmployee =
    modal === "emp_status_confirm" && emp && ns
      ? await prisma.employee.findUnique({
          where: { id: emp },
          select: {
            id: true,
            name: true,
            department: true,
            status: true,
            startDate: true,
            user: { select: { email: true } },
          },
        })
      : null;

  const grantHistoryRecords =
    modal === "grant_history" && emp
      ? await prisma.changeRequest.findMany({
          where: {
            type: "GRANT_CREATE" as never,
            targetEmployeeId: emp,
            status: "APPLIED",
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            createdAt: true,
            payload: true,
            requestedByUser: { select: { email: true } },
          },
        })
      : [];

  const grantHistoryGrants =
    modal === "grant_history" && emp
      ? await prisma.grant.findMany({
          where: { employeeId: emp },
          orderBy: { grantDate: "desc" },
          take: 50,
          select: {
            id: true,
            agreementNo: true,
            totalShares: true,
            grantDate: true,
            strikePrice: true,
          },
        })
      : [];

  const grantHistoryExercises =
    modal === "grant_history" && emp && grantHistoryGrants.length > 0
      ? await prisma.exerciseRequest.findMany({
          where: {
            employeeId: emp,
            isBuybackOrCancel: false,
            grantId: { in: grantHistoryGrants.map((g) => g.id) },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            grantId: true,
            status: true,
            requestedShares: true,
            paymentChain: true,
            paymentTxHash: true,
            paymentProofDataUrl: true,
            paymentProofUploadedAt: true,
            paymentProofUploadedByRole: true,
            paymentProofConfirmedAt: true,
            paymentProofConfirmedByRole: true,
            paymentVerifiedAt: true,
            createdAt: true,
            completedAt: true,
          },
        })
      : [];

  const grantHistoryExercisesByGrantId = new Map<string, typeof grantHistoryExercises>();
  if (grantHistoryExercises.length > 0) {
    for (const ex of grantHistoryExercises) {
      const gid = String(ex.grantId ?? "").trim();
      if (!gid) continue;
      const list = grantHistoryExercisesByGrantId.get(gid) ?? [];
      list.push(ex);
      grantHistoryExercisesByGrantId.set(gid, list);
    }
  }

  const proofViewRequest =
    modal === "exercise_proof" && proofRequestId
      ? await prisma.exerciseRequest.findFirst({
          where: { id: proofRequestId, isBuybackOrCancel: false },
          select: {
            id: true,
            status: true,
            requestedShares: true,
            paymentChain: true,
            paymentTxHash: true,
            paymentToAddress: true,
            paymentProofDataUrl: true,
            paymentProofUploadedAt: true,
            paymentProofUploadedByRole: true,
            paymentProofConfirmedAt: true,
            paymentProofConfirmedByRole: true,
            createdAt: true,
            employee: { select: { name: true, department: true } },
            grant: { select: { agreementNo: true } },
          },
        })
      : null;

  const grantHistoryAuditByAgreementNo = new Map<
    string,
    (typeof grantHistoryRecords)[number]
  >();
  for (const r of grantHistoryRecords) {
    const payload = jsonObject(r.payload);
    const agreementNo = jsonString(payload["agreementNo"]);
    if (agreementNo) grantHistoryAuditByAgreementNo.set(agreementNo, r);
  }

  const totalPool = settings?.totalOptionPoolShares ?? 0;
  const granted = grantAgg._sum.totalShares ?? 0;
  const forfeited = forfeitedAgg._sum.shares ?? 0;
  const buybackReturned = buybackCompletedAgg._sum.requestedShares ?? 0;
  const used = Math.max(granted - forfeited - buybackReturned, 0);
  const remaining = Math.max(totalPool - used, 0);
  const pct = totalPool > 0 ? Math.min(used / totalPool, 1) : 0;
  const remainingPct = totalPool > 0 ? remaining / totalPool : 0;
  const poolStatus =
    totalPool <= 0
      ? { label: "未设置", cls: "border-zinc-200 bg-zinc-50 text-zinc-700" }
      : remaining <= 0
        ? { label: "不足", cls: "border-rose-200 bg-rose-50 text-[#e11d48]" }
        : remainingPct < 0.1
          ? { label: "偏紧", cls: "border-amber-200 bg-amber-50 text-amber-800" }
          : { label: "充足", cls: "border-emerald-200 bg-emerald-50 text-[#059669]" };

  const ledgerEmployees = needLedgerFull
    ? ((await prisma.employee.findMany({
        where: {
          ...(dept ? { department: dept } : {}),
          ...(status ? { status } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q } },
                  { department: { contains: q } },
                  { user: { is: { account: { contains: q } } } },
                  { grants: { some: { agreementNo: { contains: q } } } },
                ],
              }
            : {}),
        },
        orderBy: [{ department: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          department: true,
          status: true,
          startDate: true,
          terminatedAt: true,
          updatedAt: true,
          userId: true,
          user: { select: { account: true } as never } as never,
        },
        take: 20,
        skip: Math.max(0, ledgerPage - 1) * 20,
      } as never)) as unknown as Array<{
        id: string;
        name: string;
        department: string;
        status: "ACTIVE" | "TERMINATED";
        startDate: Date;
        terminatedAt: Date | null;
        updatedAt: Date;
        userId: string | null;
        user: { account: string } | null;
      }>)
    : [];
  const ledgerEmployeesTotal = needLedgerFull
    ? await prisma.employee.count({
        where: {
          ...(dept ? { department: dept } : {}),
          ...(status ? { status } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q } },
                  { department: { contains: q } },
                  { user: { is: { account: { contains: q } } } },
                  { grants: { some: { agreementNo: { contains: q } } } },
                ],
              }
            : {}),
        },
      } as never)
    : 0;
  const opsEmployees = needOpsSection
    ? await prisma.employee.findMany({
        orderBy: [{ department: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          department: true,
          status: true,
          startDate: true,
          terminatedAt: true,
          updatedAt: true,
        },
        take: 200,
      })
    : [];

  const [grantByEmployee, vestedByEmployee, exercisedByEmployee] =
    needLedgerFull && ledgerEmployees.length > 0
      ? await Promise.all([
          prisma.grant.groupBy({
            by: ["employeeId"],
            _sum: { totalShares: true },
            where: { employeeId: { in: ledgerEmployees.map((e) => e.id) } },
          }),
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            _sum: { shares: true },
            where: {
              employeeId: { in: ledgerEmployees.map((e) => e.id) },
              status: "VESTED",
            },
          }),
          prisma.exerciseRequest.groupBy({
            by: ["employeeId"],
            _sum: { requestedShares: true },
            _max: { completedAt: true },
            where: {
              employeeId: { in: ledgerEmployees.map((e) => e.id) },
              status: "COMPLETED",
              isBuybackOrCancel: false,
            },
          }),
        ])
      : [[], [], []];

  const totalGrantedByEmployee = new Map(
    grantByEmployee.map((x) => [x.employeeId, x._sum.totalShares ?? 0]),
  );
  const vestedByEmployeeMap = new Map(
    vestedByEmployee.map((x) => [x.employeeId, x._sum.shares ?? 0]),
  );
  const exercisedByEmployeeMap = new Map(
    exercisedByEmployee.map((x) => [x.employeeId, x._sum.requestedShares ?? 0]),
  );
  const lastExerciseAtByEmployee = new Map(
    exercisedByEmployee.map((x) => [x.employeeId, x._max.completedAt ?? null] as const),
  );

  const ledgerListGrantedShares = ledgerEmployees.reduce((acc, e) => acc + (totalGrantedByEmployee.get(e.id) ?? 0), 0);
  const ledgerListVestedShares = ledgerEmployees.reduce((acc, e) => acc + (vestedByEmployeeMap.get(e.id) ?? 0), 0);
  const ledgerListExercisedShares = ledgerEmployees.reduce((acc, e) => acc + (exercisedByEmployeeMap.get(e.id) ?? 0), 0);

  const departmentsFromDb = departmentsDb.map((d) => d.name);
  const departments =
    departmentsFromDb.length > 0
      ? departmentsFromDb
      : Array.from(new Set((ledgerEmployees.length > 0 ? ledgerEmployees : opsEmployees).map((e) => e.department).filter(Boolean)));

  const companySharePriceAuto = settings?.companySharePrice ?? new Prisma.Decimal(7);
  const useManualCompanySharePrice =
    ((settings as unknown as { useManualCompanySharePrice?: boolean | null } | null)?.useManualCompanySharePrice ??
      false) as boolean;
  const manualCompanySharePrice =
    ((settings as unknown as { manualCompanySharePrice?: Prisma.Decimal | null } | null)?.manualCompanySharePrice ??
      null) as Prisma.Decimal | null;
  const manualCompanySharePriceUpdatedAt =
    ((settings as unknown as { manualCompanySharePriceUpdatedAt?: Date | null } | null)
      ?.manualCompanySharePriceUpdatedAt ?? null) as Date | null;
  const companySharePrice =
    useManualCompanySharePrice && manualCompanySharePrice ? manualCompanySharePrice : companySharePriceAuto;
  const terminationOptionExpiryDays = settings?.terminationOptionExpiryDays ?? 90;
  const sharePriceTicker =
    (settings as unknown as { sharePriceTicker?: string | null } | null)?.sharePriceTicker ?? "";
  const sharePriceAvg30Usd =
    ((settings as unknown as { sharePriceAvg30Usd?: Prisma.Decimal | null } | null)?.sharePriceAvg30Usd ??
      null) as Prisma.Decimal | null;
  const sharePriceUpdatedAt =
    useManualCompanySharePrice && manualCompanySharePriceUpdatedAt ? manualCompanySharePriceUpdatedAt : settings?.updatedAt ?? null;
  const baseCurrency =
    ((settings as unknown as { sharePriceCurrency?: Currency | null } | null)?.sharePriceCurrency ??
      "USD") as Currency;
  const brandLogoDataUrl =
    ((settings as unknown as { brandLogoDataUrl?: string | null } | null)?.brandLogoDataUrl ?? "") as string;
  const companyName = String(((settings as unknown as { companyName?: string | null } | null)?.companyName ?? "") || "").trim();
  const companySharePriceUsd =
    baseCurrency === "USD"
      ? companySharePrice
      : companySharePrice.div(currencyToUsdRate(baseCurrency));
  const ledgerEmployeeIds = ledgerEmployees.map((e) => e.id);
  const now = new Date();
  const [nextVest, endVest, grantsForLedger] =
    needLedgerFull && ledgerEmployeeIds.length > 0
      ? await Promise.all([
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            where: {
              employeeId: { in: ledgerEmployeeIds },
              status: "UNVESTED",
            },
            _min: { vestDate: true },
          }),
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            where: {
              employeeId: { in: ledgerEmployeeIds },
            },
            _max: { vestDate: true },
          }),
          prisma.grant.findMany({
            where: { employeeId: { in: ledgerEmployeeIds } },
            select: { employeeId: true, totalShares: true, strikePrice: true },
          }),
        ])
      : [[], [], []];
  const nextVestByEmployee = new Map(
    nextVest.map((x) => [x.employeeId, x._min.vestDate ?? null] as const),
  );
  const endVestByEmployee = new Map(
    endVest.map((x) => [x.employeeId, x._max.vestDate ?? null] as const),
  );

  const strikeAggByEmployee = new Map<
    string,
    {
      sumShares: number;
      sumStrikeValue: Prisma.Decimal;
      minStrike: Prisma.Decimal | null;
      maxStrike: Prisma.Decimal | null;
    }
  >();
  if (needLedgerFull) {
    for (const g of grantsForLedger) {
      const cur = strikeAggByEmployee.get(g.employeeId) ?? {
        sumShares: 0,
        sumStrikeValue: new Prisma.Decimal(0),
        minStrike: null,
        maxStrike: null,
      };
      cur.sumShares += g.totalShares;
      cur.sumStrikeValue = cur.sumStrikeValue.add(g.strikePrice.mul(g.totalShares));
      cur.minStrike = cur.minStrike ? Prisma.Decimal.min(cur.minStrike, g.strikePrice) : g.strikePrice;
      cur.maxStrike = cur.maxStrike ? Prisma.Decimal.max(cur.maxStrike, g.strikePrice) : g.strikePrice;
      strikeAggByEmployee.set(g.employeeId, cur);
    }
  }

  const grantLeaderboardAgg = needPoolFull
    ? await prisma.grant.groupBy({
        by: ["employeeId"],
        _sum: { totalShares: true },
        orderBy: { _sum: { totalShares: "desc" } },
        take: 20,
      })
    : [];
  const topGranted = grantLeaderboardAgg
    .map((x) => ({ employeeId: x.employeeId, shares: x._sum.totalShares ?? 0 }))
    .filter((x) => x.shares > 0);
  const topIds = topGranted.map((x) => x.employeeId);
  const topEmployees =
    needPoolFull && topIds.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: topIds } },
          select: { id: true, name: true, department: true },
        })
      : [];
  const topEmployeeMap = new Map(topEmployees.map((e) => [e.id, e] as const));
  const grantLeaderboard = topGranted.map((x, idx) => {
    const e = topEmployeeMap.get(x.employeeId);
    const employeeLabel = e ? `${e.name} · ${e.department}` : x.employeeId;
    const valueUsd = companySharePriceUsd.mul(x.shares);
    return {
      rank: idx + 1,
      employee: employeeLabel,
      shares: formatInt(x.shares),
      value: formatMoney(valueUsd, currency, "USD"),
    };
  });

  const terminationExpiryByEmployee = new Map<string, { expiryAt: Date; daysLeft: number }>();
  if (needLedgerFull) {
    for (const e of ledgerEmployees) {
      if (e.status !== "TERMINATED") continue;
      const terminatedAt = e.terminatedAt ?? e.updatedAt;
      const expiryAt = new Date(terminatedAt.getTime() + terminationOptionExpiryDays * 24 * 60 * 60 * 1000);
      const msLeft = expiryAt.getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      terminationExpiryByEmployee.set(e.id, { expiryAt, daysLeft });
    }
  }

  const employeeEditEmployee =
    modal === "employee_edit" && emp
      ? ((await prisma.employee.findUnique({
          where: { id: emp },
          select: {
            id: true,
            name: true,
            department: true,
            status: true,
            startDate: true,
            userId: true,
            user: { select: { account: true, email: true, role: true } as never } as never,
          },
        } as never)) as unknown as {
          id: string;
          name: string;
          department: string;
          status: "ACTIVE" | "TERMINATED";
          startDate: Date;
          userId: string | null;
          user: { account: string; email: string | null; role: "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE" } | null;
        } | null)
      : null;

  const employeeDeleteEmployee =
    modal === "employee_delete" && emp
      ? ((await prisma.employee.findUnique({
          where: { id: emp },
          select: {
            id: true,
            name: true,
            department: true,
            status: true,
            userId: true,
            user: { select: { account: true, email: true, role: true } as never } as never,
          },
        } as never)) as unknown as {
          id: string;
          name: string;
          department: string;
          status: "ACTIVE" | "TERMINATED";
          userId: string | null;
          user: { account: string; email: string | null; role: "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE" } | null;
        } | null)
      : null;

  const editingEmployee = edit
    ? ((await prisma.employee.findUnique({
        where: { id: edit },
        select: {
          id: true,
          name: true,
          department: true,
          status: true,
          startDate: true,
          userId: true,
          user: { select: { account: true, email: true, role: true } as never } as never,
        },
      } as never)) as unknown as {
        id: string;
        name: string;
        department: string;
        status: "ACTIVE" | "TERMINATED";
        startDate: Date;
        userId: string | null;
        user: { account: string; email: string | null; role: "SUPER_ADMIN" | "FINANCE" | "EMPLOYEE" } | null;
      } | null)
    : null;

  const employeeDeleteUserRole = String(employeeDeleteEmployee?.user?.role ?? "");
  const employeeDeleteIsAdminAccount =
    employeeDeleteUserRole === "SUPER_ADMIN" || employeeDeleteUserRole === "FINANCE";
  const employeeDeleteIsRootAccount = Boolean(
    rootSuperAdminUserId && employeeDeleteEmployee?.userId === rootSuperAdminUserId,
  );
  const canDeleteEmployeeDirect = Boolean(
    isSuperAdmin && !employeeDeleteIsRootAccount && (!employeeDeleteIsAdminAccount || isRootSuperAdmin),
  );

  const editingEmployeeUserRole = String(editingEmployee?.user?.role ?? "");
  const editingEmployeeIsAdminAccount =
    editingEmployeeUserRole === "SUPER_ADMIN" || editingEmployeeUserRole === "FINANCE";
  const editingEmployeeIsRootAccount = Boolean(
    rootSuperAdminUserId && editingEmployee?.userId === rootSuperAdminUserId,
  );
  const canDeleteEditingEmployeeDirect = Boolean(
    isSuperAdmin && !editingEmployeeIsRootAccount && (!editingEmployeeIsAdminAccount || isRootSuperAdmin),
  );

  async function updateEmployeeDirect(formData: FormData) {
    "use server";
    const { userId: actorUserId } = await requireAdminRoles(["SUPER_ADMIN"]);
    const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
    const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
    const successTo = safeReturnTo(String(formData.get("successTo") ?? "")) ?? adminUrl({ lang });
    const employeeId = String(formData.get("employeeId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const department = String(formData.get("department") ?? "").trim();
    const startDateRaw = String(formData.get("startDate") ?? "").trim();
    const startDate = startDateRaw ? new Date(startDateRaw) : null;
    const accountRaw = String(formData.get("account") ?? "").trim();
    const account = accountRaw ? accountRaw.toLowerCase() : "";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const newStatus = String(formData.get("status") ?? "").trim();
    if (!employeeId || !name || !department || !startDate || Number.isNaN(startDate.getTime())) {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_UPDATE"));
    }

    const exists = await prisma.department.findUnique({ where: { name: department }, select: { id: true } });
    if (!exists) redirect(withErr(returnTo, "INVALID_DEPARTMENT"));

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, status: true, user: { select: { role: true } } },
    });
    if (!employee) redirect(withErr(returnTo, "INVALID_EMPLOYEE_UPDATE"));
    if (rootSuperAdminUserId && employee.userId === rootSuperAdminUserId && actorUserId !== rootSuperAdminUserId) {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }
    const employeeUserRole = String(employee.user?.role ?? "");
    const isAdminAccount = employeeUserRole === "SUPER_ADMIN" || employeeUserRole === "FINANCE";
    if (!isAdminAccount && newStatus !== "ACTIVE" && newStatus !== "TERMINATED") {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_STATUS"));
    }
    const effectiveStatus = (isAdminAccount ? employee.status : newStatus) as "ACTIVE" | "TERMINATED";
    if (account && account.length > 80) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    if (email && (!email.includes("@") || email.length > 120)) {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_ACCOUNT"));
    }
    if ((account || email) && !employee.userId) {
      redirect(withErr(returnTo, "NO_EMPLOYEE_ACCOUNT"));
    }

    await prisma.employee.update({
      where: { id: employeeId },
      data: { name, department, startDate },
    });
    if ((account || email) && employee.userId) {
      if (account) {
        const dupAccount = await prisma.user.findUnique({ where: { account } as never, select: { id: true } });
        if (dupAccount && dupAccount.id !== employee.userId) {
          redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
        }
      }
      if (email) {
        const dupEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (dupEmail && dupEmail.id !== employee.userId) {
          redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
        }
      }
      try {
        await prisma.user.update({
          where: { id: employee.userId },
          data: {
            ...(account ? { account } : {}),
            ...(email ? { email } : {}),
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          if (account) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
          if (email) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
        }
        redirect(withErr(returnTo, "UPDATE_EMPLOYEE_FAILED"));
      }
    }
    await setEmployeeStatus({ employeeId, status: effectiveStatus });
    redirect(withOk(successTo, "EMP_UPDATED", { eid: employeeId }));
  }

  async function submitEmployeeUpdateRequest(formData: FormData) {
    "use server";
    const { userId: actorUserId } = await requireAdminRoles(["FINANCE"]);
    const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
    const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
    const successTo = safeReturnTo(String(formData.get("successTo") ?? "")) ?? adminUrl({ lang });
    const employeeId = String(formData.get("employeeId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const department = String(formData.get("department") ?? "").trim();
    const startDateRaw = String(formData.get("startDate") ?? "").trim();
    const startDate = startDateRaw ? new Date(startDateRaw) : null;
    const accountRaw = String(formData.get("account") ?? "").trim();
    const account = accountRaw ? accountRaw.toLowerCase() : "";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const newStatus = String(formData.get("status") ?? "").trim();
    if (!employeeId || !name || !department || !startDate || Number.isNaN(startDate.getTime())) {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_UPDATE"));
    }
    const exists = await prisma.department.findUnique({ where: { name: department }, select: { id: true } });
    if (!exists) redirect(withErr(returnTo, "INVALID_DEPARTMENT"));
    if (account && account.length > 80) {
      redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
    }
    if (email && (!email.includes("@") || email.length > 120)) {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_ACCOUNT"));
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, status: true, user: { select: { role: true } } },
    });
    if (!employee) redirect(withErr(returnTo, "INVALID_EMPLOYEE_UPDATE"));
    if (rootSuperAdminUserId && employee.userId === rootSuperAdminUserId && actorUserId !== rootSuperAdminUserId) {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }
    const employeeUserRole = String(employee.user?.role ?? "");
    const isAdminAccount = employeeUserRole === "SUPER_ADMIN" || employeeUserRole === "FINANCE";
    if (!isAdminAccount && newStatus !== "ACTIVE" && newStatus !== "TERMINATED") {
      redirect(withErr(returnTo, "INVALID_EMPLOYEE_STATUS"));
    }
    const effectiveStatus = (isAdminAccount ? employee.status : newStatus) as "ACTIVE" | "TERMINATED";

    await prisma.changeRequest.create({
      data: {
        type: "EMPLOYEE_UPDATE",
        status: "PENDING",
        targetEmployeeId: employeeId,
        payload: {
          name,
          department,
          status: effectiveStatus,
          startDate: startDate.toISOString(),
          ...(account ? { account } : {}),
          ...(email ? { email } : {}),
        },
        requestedByUserId: actorUserId,
        events: { create: { action: "SUBMITTED", createdByUserId: actorUserId } },
      },
    });
    redirect(withOk(successTo, "EMP_UPDATE_SUBMITTED", { eid: employeeId }));
  }

  async function deleteEmployeeDirect(formData: FormData) {
    "use server";
    const { userId: actorUserId } = await requireAdminRoles(["SUPER_ADMIN"]);
    const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
    const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
    const successTo = safeReturnTo(String(formData.get("successTo") ?? "")) ?? adminUrl({ lang });
    const employeeId = String(formData.get("employeeId") ?? "").trim();
    if (!employeeId) redirect(withErr(returnTo, "INVALID_DELETE"));

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, user: { select: { role: true } } },
    });
    if (!employee) redirect(successTo);
    if (rootSuperAdminUserId && employee.userId === rootSuperAdminUserId) {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }
    const employeeUserRole = String(employee.user?.role ?? "");
    const isAdminAccount = employeeUserRole === "SUPER_ADMIN" || employeeUserRole === "FINANCE";
    if (isAdminAccount && (!rootSuperAdminUserId || actorUserId !== rootSuperAdminUserId)) {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }

    await prisma.$transaction([
      prisma.vestingRecord.deleteMany({ where: { employeeId } }),
      prisma.exerciseRequest.deleteMany({ where: { employeeId } }),
      prisma.grant.deleteMany({ where: { employeeId } }),
      prisma.employee.delete({ where: { id: employeeId } }),
      ...(employee.userId ? [prisma.user.delete({ where: { id: employee.userId } })] : []),
    ]);

    redirect(withOk(successTo, "EMP_DELETED", { eid: employeeId }));
  }

  async function submitEmployeeDeleteRequest(formData: FormData) {
    "use server";
    const { userId: actorUserId } = await requireAdminRoles(["SUPER_ADMIN", "FINANCE"]);
    const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
    const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminUrl({ lang });
    const successTo = safeReturnTo(String(formData.get("successTo") ?? "")) ?? adminUrl({ lang });
    const employeeId = String(formData.get("employeeId") ?? "").trim();
    if (!employeeId) redirect(withErr(returnTo, "INVALID_DELETE"));

    const target = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, user: { select: { role: true } } },
    });
    if (!target) redirect(withErr(returnTo, "INVALID_DELETE"));
    if (rootSuperAdminUserId && target.userId === rootSuperAdminUserId) {
      redirect(withErr(returnTo, "FORBIDDEN"));
    }

    await prisma.changeRequest.create({
      data: {
        type: "EMPLOYEE_DELETE",
        status: "PENDING",
        targetEmployeeId: employeeId,
        payload: {},
        requestedByUserId: actorUserId,
        events: { create: { action: "SUBMITTED", createdByUserId: actorUserId } },
      },
    });
    redirect(withOk(successTo, "EMP_DELETE_SUBMITTED", { eid: employeeId }));
  }

  async function decideChangeRequest(formData: FormData) {
    "use server";
    const { userId } = await requireAdminRoles(["SUPER_ADMIN"]);
    const lang = parseLang(String(formData.get("lang") ?? "").trim() || undefined);
    const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "")) ?? adminHref({ focus: "approvals", lang, modal: "" });
    const id = String(formData.get("id") ?? "").trim();
    const decision = String(formData.get("decision") ?? "").trim();
    if (!id || (decision !== "APPROVE" && decision !== "REJECT")) {
      redirect(withErr(returnTo, "INVALID_APPROVAL"));
    }

    const cr = await prisma.changeRequest.findUnique({
      where: { id },
      include: {
        targetEmployee: { select: { id: true, userId: true, status: true, user: { select: { role: true } } } },
      },
    });
    if (!cr || cr.status !== "PENDING") redirect(withErr(returnTo, "INVALID_APPROVAL_STATE"));

    if (decision === "REJECT") {
      await prisma.changeRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedByUserId: userId,
          decidedAt: new Date(),
          events: { create: { action: "REJECTED", createdByUserId: userId } },
        },
      });
      redirect(withOk(returnTo, "CR_REJECTED", {}));
    }

    if (cr.type === "EMPLOYEE_UPDATE") {
      const payload = jsonObject(cr.payload);
      const name = jsonString(payload["name"]).trim();
      const department = jsonString(payload["department"]).trim();
      const newStatus = jsonString(payload["status"]).trim();
      const startDateIso = jsonString(payload["startDate"]).trim();
      const account = jsonString(payload["account"]).trim().toLowerCase();
      const email = jsonString(payload["email"]).trim().toLowerCase();
      const startDate = startDateIso ? new Date(startDateIso) : null;
      const targetEmployee =
        cr.targetEmployee ??
        (await prisma.employee.findUnique({
          where: { id: cr.targetEmployeeId ?? "" },
          select: { id: true, userId: true, status: true, user: { select: { role: true } } },
        }));
      const targetUserId = targetEmployee?.userId ?? "";
      const targetUserRole = String(targetEmployee?.user?.role ?? "");
      const targetIsAdminAccount = targetUserRole === "SUPER_ADMIN" || targetUserRole === "FINANCE";
      if (rootSuperAdminUserId && targetUserId === rootSuperAdminUserId && userId !== rootSuperAdminUserId) {
        redirect(withErr(returnTo, "FORBIDDEN"));
      }

      if (
        !cr.targetEmployeeId ||
        !name ||
        !department ||
        !startDate ||
        Number.isNaN(startDate.getTime())
      ) {
        redirect(withErr(returnTo, "INVALID_APPROVAL_PAYLOAD"));
      }
      if (!targetIsAdminAccount && newStatus !== "ACTIVE" && newStatus !== "TERMINATED") {
        redirect(withErr(returnTo, "INVALID_EMPLOYEE_STATUS"));
      }
      const effectiveStatus = (targetIsAdminAccount ? targetEmployee?.status : newStatus) as "ACTIVE" | "TERMINATED";
      const deptOk = await prisma.department.findUnique({ where: { name: department }, select: { id: true } });
      if (!deptOk) redirect(withErr(returnTo, "INVALID_DEPARTMENT"));
      if (account && account.length > 80) {
        redirect(withErr(returnTo, "INVALID_USER_ACCOUNT"));
      }
      if (email && (!email.includes("@") || email.length > 120)) {
        redirect(withErr(returnTo, "INVALID_EMPLOYEE_ACCOUNT"));
      }

      await prisma.changeRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedByUserId: userId,
          decidedAt: new Date(),
          events: { create: { action: "APPROVED", createdByUserId: userId } },
        },
      });

      await prisma.employee.update({
        where: { id: cr.targetEmployeeId! },
        data: { name, department, startDate },
      });
      if (account || email) {
        const employee2 = await prisma.employee.findUnique({
          where: { id: cr.targetEmployeeId! },
          select: { userId: true },
        });
        if (!employee2?.userId) redirect(withErr(returnTo, "NO_EMPLOYEE_ACCOUNT"));
        if (account) {
          const dupAccount = await prisma.user.findUnique({ where: { account } as never, select: { id: true } });
          if (dupAccount && dupAccount.id !== employee2.userId) {
            redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
          }
        }
        if (email) {
          const dupEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
          if (dupEmail && dupEmail.id !== employee2.userId) {
            redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
          }
        }
        try {
          await prisma.user.update({
            where: { id: employee2.userId },
            data: {
              ...(account ? { account } : {}),
              ...(email ? { email } : {}),
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            if (account) redirect(withErr(returnTo, "DUPLICATE_ACCOUNT"));
            if (email) redirect(withErr(returnTo, "DUPLICATE_EMAIL"));
          }
          redirect(withErr(returnTo, "UPDATE_EMPLOYEE_FAILED"));
        }
      }
      await setEmployeeStatus({
        employeeId: cr.targetEmployeeId!,
        status: effectiveStatus,
      });

      await prisma.changeRequest.update({
        where: { id },
        data: {
          status: "APPLIED",
          events: { create: { action: "APPLIED", createdByUserId: userId } },
        },
      });
      redirect(withOk(returnTo, "CR_APPLIED", {}));
    }

    if (cr.type === "EMPLOYEE_DELETE") {
      if (!cr.targetEmployeeId) redirect(withErr(returnTo, "INVALID_APPROVAL_PAYLOAD"));
      const employee = cr.targetEmployee;
      if (!employee) redirect(withErr(returnTo, "INVALID_DELETE"));
      const targetUserId = employee.userId ?? "";
      const targetUserRole = String(employee.user?.role ?? "");
      const targetIsAdminAccount = targetUserRole === "SUPER_ADMIN" || targetUserRole === "FINANCE";
      if (rootSuperAdminUserId && targetUserId === rootSuperAdminUserId) {
        redirect(withErr(returnTo, "FORBIDDEN"));
      }
      if (targetIsAdminAccount && (!rootSuperAdminUserId || userId !== rootSuperAdminUserId)) {
        redirect(withErr(returnTo, "FORBIDDEN"));
      }

      await prisma.$transaction(async (tx) => {
        await tx.changeRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            decidedByUserId: userId,
            decidedAt: new Date(),
            events: { create: { action: "APPROVED", createdByUserId: userId } },
          },
        });

        await tx.vestingRecord.deleteMany({ where: { employeeId: cr.targetEmployeeId! } });
        await tx.exerciseRequest.deleteMany({ where: { employeeId: cr.targetEmployeeId! } });
        await tx.grant.deleteMany({ where: { employeeId: cr.targetEmployeeId! } });
        await tx.employee.delete({ where: { id: cr.targetEmployeeId! } });
        if (employee.userId) {
          await tx.user.delete({ where: { id: employee.userId } });
        }

        await tx.changeRequest.update({
          where: { id },
          data: {
            status: "APPLIED",
            events: { create: { action: "APPLIED", createdByUserId: userId } },
          },
        });
      });
      redirect(withOk(returnTo, "CR_APPLIED", {}));
    }

    if (String(cr.type) === "GRANT_CREATE") {
      const payload = jsonObject(cr.payload);
      const employeeId = jsonString(payload["employeeId"]).trim() || cr.targetEmployeeId || "";
      const totalShares = Math.floor(Number(payload["totalShares"]));
      const grantDateIso = jsonString(payload["grantDate"]).trim();
      const strikePrice = Number(payload["strikePrice"]);
      const lockupPeriodMonths = Math.floor(Number(payload["lockupPeriodMonths"]));
      const vestingTypeRaw = jsonString(payload["vestingType"]).trim();
      const vestingType =
        vestingTypeRaw === "IMMEDIATE"
          ? "IMMEDIATE"
          : vestingTypeRaw === "CUSTOM_INSTALLMENTS"
            ? "CUSTOM_INSTALLMENTS"
            : "";
      const totalVestingDurationMonths = Math.floor(Number(payload["totalVestingDurationMonths"]));
      const vestingInstallments = Math.floor(Number(payload["vestingInstallments"]));
      const grantDate = grantDateIso ? new Date(grantDateIso) : null;

      if (
        !employeeId ||
        !Number.isFinite(totalShares) ||
        totalShares <= 0 ||
        !grantDate ||
        Number.isNaN(grantDate.getTime()) ||
        !Number.isFinite(strikePrice) ||
        strikePrice < 0 ||
        !Number.isFinite(lockupPeriodMonths) ||
        lockupPeriodMonths < 0 ||
        !vestingType
      ) {
        redirect(withErr(returnTo, "INVALID_APPROVAL_PAYLOAD"));
      }

      if (vestingType === "CUSTOM_INSTALLMENTS") {
        if (
          !Number.isFinite(totalVestingDurationMonths) ||
          totalVestingDurationMonths <= 0 ||
          !Number.isFinite(vestingInstallments) ||
          vestingInstallments <= 0 ||
          totalVestingDurationMonths % vestingInstallments !== 0 ||
          totalShares < vestingInstallments
        ) {
          redirect(withErr(returnTo, "INVALID_VESTING"));
        }
      }

      const [settings2, grantAgg2, forfeitedAgg2, buybackCompletedAgg2] = await Promise.all([
        prisma.globalSettings.findFirst({
          orderBy: { createdAt: "desc" },
          select: { totalOptionPoolShares: true } as unknown as { totalOptionPoolShares: true },
        }),
        prisma.grant.aggregate({ _sum: { totalShares: true } }),
        prisma.vestingRecord.aggregate({
          where: { status: "FORFEITED" },
          _sum: { shares: true },
        }),
        prisma.exerciseRequest.aggregate({
          where: { status: "COMPLETED", isBuybackOrCancel: true },
          _sum: { requestedShares: true },
        }),
      ]);
      const totalPool = settings2?.totalOptionPoolShares ?? 0;
      const granted = grantAgg2._sum.totalShares ?? 0;
      const forfeited = forfeitedAgg2._sum.shares ?? 0;
      const buybackReturned = buybackCompletedAgg2._sum.requestedShares ?? 0;
      const used = Math.max(granted - forfeited - buybackReturned, 0);
      const remaining = Math.max(totalPool - used, 0);
      if (remaining < totalShares) {
        redirect(withErr(returnTo, "POOL_EXCEEDED"));
      }

      await prisma.changeRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedByUserId: userId,
          decidedAt: new Date(),
          events: { create: { action: "APPROVED", createdByUserId: userId } },
        },
      });

      const created = await createGrantWithVesting({
        employeeId,
        totalShares,
        grantDate,
        strikePrice,
        lockupPeriodMonths,
        vestingType,
        totalVestingDurationMonths:
          vestingType === "CUSTOM_INSTALLMENTS" ? totalVestingDurationMonths : undefined,
        vestingInstallments:
          vestingType === "CUSTOM_INSTALLMENTS" ? vestingInstallments : undefined,
      });

      await prisma.changeRequest.update({
        where: { id },
        data: {
          status: "APPLIED",
          targetEmployeeId: employeeId,
          targetGrantId: created.id,
          payload: {
            ...payload,
            agreementNo: created.agreementNo,
            vestingRecordCount: created.vestingRecords.length,
          },
          events: { create: { action: "APPLIED", createdByUserId: userId } },
        },
      });

      redirect(withOk(returnTo, "CR_APPLIED", {}));
    }

    redirect(withErr(returnTo, "UNSUPPORTED_APPROVAL_TYPE"));
  }

  function adminHref(params: {
    dept?: string;
    q?: string;
    st?: string;
    lp?: number | string;
    edit?: string;
    emp?: string;
    ns?: string;
    cr?: string;
    crst?: string;
    ap?: string;
    risk?: string;
    tag?: string;
    deptEdit?: string;
    deptDelete?: string;
    ccy?: Currency;
    lang?: Lang;
    modal?: string;
    view?: string;
    focus?: string;
  }) {
    const p = new URLSearchParams();
    const d = (params.dept ?? "").trim();
    const qq = (params.q ?? "").trim();
    const s = (params.st ?? "").trim();
    const lp = Number.parseInt(String(params.lp ?? ledgerPage), 10);
    const e = (params.edit ?? "").trim();
    const employeeId = (params.emp ?? "").trim();
    const ns = (params.ns ?? "").trim();
    const changeRequestId = (params.cr ?? "").trim();
    const changeRequestStatus = (params.crst ?? "").trim();
    const approvalsTab = (params.ap ?? ap).trim().toLowerCase();
    const risk = (params.risk ?? "").trim();
    const tag = (params.tag ?? "").trim();
    const deptEdit = (params.deptEdit ?? "").trim();
    const deptDelete = (params.deptDelete ?? "").trim();
    const c = params.ccy ?? currency;
    const lg = params.lang ?? lang;
    const m = (params.modal ?? "").trim();
    const v = (params.view ?? view).trim().toLowerCase();
    const f = (params.focus ?? focus).trim();
    if (d) p.set("dept", d);
    if (qq) p.set("q", qq);
    if (s) p.set("st", s);
    if (Number.isFinite(lp) && lp > 1) p.set("lp", String(lp));
    if (e) p.set("edit", e);
    if (employeeId) p.set("emp", employeeId);
    if (ns === "ACTIVE" || ns === "TERMINATED") p.set("ns", ns);
    if (changeRequestId) p.set("cr", changeRequestId);
    if (changeRequestStatus) p.set("crst", changeRequestStatus);
    if (approvalsTab === "todo" || approvalsTab === "mine" || approvalsTab === "audit") p.set("ap", approvalsTab);
    if (risk) p.set("risk", risk);
    if (tag) p.set("tag", tag);
    if (deptEdit) p.set("deptEdit", deptEdit);
    if (deptDelete) p.set("deptDelete", deptDelete);
    if (c && c !== "USD") p.set("ccy", c);
    if (lg && lg !== "zh-CN") p.set("lang", lg);
    if (m) p.set("modal", m);
    if (v === "all") p.set("view", "all");
    if (f) p.set("focus", f);
    const qs = p.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  const tr = (cn: string, tw: string, en: string) =>
    lang === "zh-TW" ? tw : lang === "en" ? en : cn;

  const baseAfterOkHref = adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" });

  type RiskRow = Parameters<typeof requestRiskLevel>[0]["r"];
  type TagRow = Parameters<typeof requestTags>[0]["r"];

  type ToastAction = { label: string; href: string };
  type ToastPayload = {
    toastId: string;
    title: string;
    lines: string[];
    durationMs: number;
    clearKeys: string[];
    actions?: ToastAction[];
  };

  function buildErrorToast(): ToastPayload | null {
    if (err === "INVALID_COMPANY_NAME") {
      return {
        toastId: "INVALID_COMPANY_NAME",
        title: tr("公司名称无效", "公司名稱無效", "Invalid company name"),
        lines: [tr("请填写公司名称（不超过 80 个字符）。", "請填寫公司名稱（不超過 80 個字符）。", "Please enter a company name (max 80 chars).")],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "DUPLICATE_ACCOUNT") {
      return {
        toastId: "DUPLICATE_ACCOUNT",
        title: tr("账号已存在", "帳號已存在", "Account already exists"),
        lines: [
          tr(
            "该账号已被占用，请更换账号后再提交。",
            "該帳號已被佔用，請更換帳號後再提交。",
            "This account is already in use. Please choose another.",
          ),
        ],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "DUPLICATE_EMAIL") {
      return {
        toastId: "DUPLICATE_EMAIL",
        title: tr("登录账号已存在", "登入帳號已存在", "Account already exists"),
        lines: [
          tr(
            "该邮箱已被占用，请更换邮箱后再提交。",
            "該郵箱已被佔用，請更換郵箱後再提交。",
            "This email is already in use. Please use another email.",
          ),
        ],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "INVALID_EMPLOYEE") {
      return {
        toastId: "INVALID_EMPLOYEE",
        title: tr("员工信息不完整", "員工資訊不完整", "Missing employee info"),
        lines: [tr("请填写姓名、部门与入职日期。", "請填寫姓名、部門與入職日期。", "Please fill name, department and start date.")],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "INVALID_USER_ACCOUNT") {
      return {
        toastId: "INVALID_USER_ACCOUNT",
        title: tr("账号信息无效", "帳號資訊無效", "Invalid account info"),
        lines: [
          tr(
            "请检查账号、邮箱格式与初始密码（至少 8 位）。",
            "請檢查帳號、信箱格式與初始密碼（至少 8 位）。",
            "Please check account, email format and the initial password (min 8 chars).",
          ),
        ],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "INVALID_ROLE") {
      return {
        toastId: "INVALID_ROLE",
        title: tr("角色无效", "角色無效", "Invalid role"),
        lines: [tr("请选择要创建的后台角色。", "請選擇要建立的後台角色。", "Please select a role.")],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "CREATE_USER_FAILED") {
      return {
        toastId: "CREATE_USER_FAILED",
        title: tr("创建失败", "建立失敗", "Create failed"),
        lines: [tr("请稍后重试。", "請稍後重試。", "Please retry later.")],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "CONFIRM_REQUIRED") {
      return {
        toastId: "CONFIRM_REQUIRED",
        title: tr("需要确认", "需要確認", "Confirmation required"),
        lines: [tr("请输入 PURGE 以确认清空操作。", "請輸入 PURGE 以確認清空操作。", "Please type PURGE to confirm.")],
        durationMs: 6000,
        clearKeys: ["err"],
      };
    }
    if (err === "PURGE_FAILED") {
      return {
        toastId: "PURGE_FAILED",
        title: tr("清空失败", "清空失敗", "Purge failed"),
        lines: [tr("请稍后重试；如多次失败，请检查数据库连接与约束。", "請稍後重試；如多次失敗，請檢查資料庫連線與約束。", "Please retry later. If it keeps failing, check DB constraints.")],
        durationMs: 7000,
        clearKeys: ["err"],
      };
    }
    return null;
  }

  function buildSuccessToast(): ToastPayload | null {
    if (!ok) return null;

    if (ok === "COMPANY_NAME_UPDATED") {
      return {
        toastId: `COMPANY_NAME_UPDATED`,
        title: tr("公司名称已保存", "公司名稱已儲存", "Company name saved"),
        lines: [],
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "PASSWORD_RESET_OK") {
      return {
        toastId: `PASSWORD_RESET_OK:${okUserId || okEmployeeId || "unknown"}`,
        title: tr("密码已重置", "密碼已重置", "Password reset"),
        lines: [
          okEmployee?.name ? tr(`员工：${okEmployee.name}`, `員工：${okEmployee.name}`, `Employee: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
          okUserId ? tr(`用户ID：${okUserId}`, `使用者ID：${okUserId}`, `User ID: ${okUserId}`) : "",
          tr(
            "目标账号已被强制下线，需要使用新密码重新登录。",
            "目標帳號已被強制下線，需要使用新密碼重新登入。",
            "The target account has been logged out and must sign in again with the new password.",
          ),
        ].filter(Boolean),
        durationMs: 5000,
        clearKeys: ["ok", "uid", "eid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "EMP_CREATED") {
      return {
        toastId: `EMP_CREATED:${okEmployeeId || "unknown"}`,
        title: tr("员工创建成功", "員工建立成功", "Employee created"),
        lines: [
          okEmployee?.id ? tr(`员工编号：${okEmployee.id}`, `員工編號：${okEmployee.id}`, `ID: ${okEmployee.id}`) : "",
          okEmployee?.name ? tr(`姓名：${okEmployee.name}`, `姓名：${okEmployee.name}`, `Name: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [
          {
            label: tr("查看员工", "查看員工", "View employee"),
            href: adminHref({
              dept,
              q,
              st: status,
              edit,
              emp: okEmployee?.id || okEmployeeId,
              cr: crId,
              crst,
              risk,
              tag,
              ccy: currency,
              lang,
              modal: "employee_edit",
            }),
          },
          { label: tr("继续创建", "繼續建立", "Create more"), href: baseAfterOkHref },
        ].filter((a) => Boolean(a.href)),
      };
    }

    if (ok === "EMP_ACCOUNT_ENABLED") {
      return {
        toastId: `EMP_ACCOUNT_ENABLED:${okEmployeeId || "unknown"}`,
        title: tr("员工账号已开通", "員工帳號已開通", "Employee account enabled"),
        lines: [
          okEmployee?.id ? tr(`员工编号：${okEmployee.id}`, `員工編號：${okEmployee.id}`, `ID: ${okEmployee.id}`) : "",
          okEmployee?.name ? tr(`姓名：${okEmployee.name}`, `姓名：${okEmployee.name}`, `Name: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [
          {
            label: tr("去登录页", "去登入頁", "Go to login"),
            href: lang && lang !== "zh-CN" ? `/?lang=${encodeURIComponent(lang)}` : "/",
          },
          {
            label: tr("查看员工", "查看員工", "View employee"),
            href: adminHref({
              dept,
              q,
              st: status,
              edit,
              emp: okEmployee?.id || okEmployeeId,
              cr: crId,
              crst,
              risk,
              tag,
              ccy: currency,
              lang,
              modal: "employee_edit",
            }),
          },
        ],
      };
    }

    if (ok === "EMP_UPDATED") {
      return {
        toastId: `EMP_UPDATED:${okEmployeeId || "unknown"}`,
        title: tr("员工已更新", "員工已更新", "Employee updated"),
        lines: [
          okEmployee?.id ? tr(`员工编号：${okEmployee.id}`, `員工編號：${okEmployee.id}`, `ID: ${okEmployee.id}`) : "",
          okEmployee?.name ? tr(`姓名：${okEmployee.name}`, `姓名：${okEmployee.name}`, `Name: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [
          {
            label: tr("查看员工", "查看員工", "View employee"),
            href: adminHref({ dept, q, st: status, edit, emp: okEmployee?.id || okEmployeeId, ccy: currency, lang, modal: "employee_edit" }),
          },
          { label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref },
        ].filter((a) => Boolean(a.href)),
      };
    }

    if (ok === "EMP_UPDATE_SUBMITTED") {
      return {
        toastId: `EMP_UPDATE_SUBMITTED:${okEmployeeId || "unknown"}`,
        title: tr("已提请审批", "已提請審批", "Request submitted"),
        lines: [
          okEmployee?.name ? tr(`员工：${okEmployee.name}`, `員工：${okEmployee.name}`, `Employee: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [
          {
            label: tr("查看审批", "查看審批", "View approvals"),
            href: adminHref({ focus: "approvals", ap: isFinance ? "mine" : "todo", ccy: currency, lang, modal: "" }),
          },
          { label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref },
        ].filter((a) => Boolean(a.href)),
      };
    }

    if (ok === "EMP_DELETE_SUBMITTED") {
      return {
        toastId: `EMP_DELETE_SUBMITTED:${okEmployeeId || "unknown"}`,
        title: tr("删除申请已提交", "刪除申請已提交", "Delete request submitted"),
        lines: [
          okEmployee?.name ? tr(`员工：${okEmployee.name}`, `員工：${okEmployee.name}`, `Employee: ${okEmployee.name}`) : "",
          okEmployee?.department
            ? tr(`部门：${okEmployee.department}`, `部門：${okEmployee.department}`, `Department: ${okEmployee.department}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [
          {
            label: tr("查看审批", "查看審批", "View approvals"),
            href: adminHref({ focus: "approvals", ap: isFinance ? "mine" : "todo", ccy: currency, lang, modal: "" }),
          },
          { label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref },
        ].filter((a) => Boolean(a.href)),
      };
    }

    if (ok === "EMP_DELETED") {
      const eid = okEmployeeId || "";
      return {
        toastId: `EMP_DELETED:${eid || "unknown"}`,
        title: tr("员工已删除", "員工已刪除", "Employee deleted"),
        lines: eid ? [tr(`员工编号：${eid}`, `員工編號：${eid}`, `ID: ${eid}`)] : [],
        durationMs: 4500,
        clearKeys: ["ok", "eid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "GRANT_CREATED") {
      return {
        toastId: `GRANT_CREATED:${okGrantId || "unknown"}`,
        title: tr("协议创建成功", "協議建立成功", "Agreement created"),
        lines: [
          okGrant?.agreementNo
            ? tr(`协议编号：${okGrant.agreementNo}`, `協議編號：${okGrant.agreementNo}`, `Agreement No: ${okGrant.agreementNo}`)
            : "",
          okGrant?.employee
            ? tr(
                `员工：${okGrant.employee.name} · ${okGrant.employee.department}`,
                `員工：${okGrant.employee.name} · ${okGrant.employee.department}`,
                `Employee: ${okGrant.employee.name} · ${okGrant.employee.department}`,
              )
            : "",
          typeof okGrant?.totalShares === "number"
            ? tr(
                `授予股数：${formatInt(okGrant.totalShares)} 股`,
                `授予股數：${formatInt(okGrant.totalShares)} 股`,
                `Shares: ${formatInt(okGrant.totalShares)}`,
              )
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "gid"],
        actions: okGrant?.employeeId
          ? [
              {
                label: tr("查看授予记录", "查看授予記錄", "View grants"),
                href: adminHref({
                  dept,
                  q,
                  st: status,
                  edit,
                  emp: okGrant.employeeId,
                  cr: crId,
                  crst,
                  risk,
                  tag,
                  ccy: currency,
                  lang,
                  modal: "grant_history",
                }),
              },
              { label: tr("继续创建", "繼續建立", "Create more"), href: baseAfterOkHref },
            ]
          : [{ label: tr("继续创建", "繼續建立", "Create more"), href: baseAfterOkHref }],
      };
    }

    if (ok === "GRANT_SUBMITTED") {
      return {
        toastId: `GRANT_SUBMITTED:${okChangeRequest?.id || crId || "unknown"}`,
        title: tr("协议创建申请已提交", "協議建立申請已提交", "Agreement request submitted"),
        lines: [
          okChangeRequest?.id
            ? tr(`申请编号：${okChangeRequest.id}`, `申請編號：${okChangeRequest.id}`, `Request ID: ${okChangeRequest.id}`)
            : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [
          { label: tr("查看申请", "查看申請", "View request"), href: baseAfterOkHref },
          { label: tr("继续创建", "繼續建立", "Create more"), href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "" }) },
        ],
      };
    }

    if (ok === "CR_APPLIED") {
      return {
        toastId: `CR_APPLIED`,
        title: tr("已通过并生效", "已通過並生效", "Approved & applied"),
        lines: [],
        durationMs: 5000,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "CR_REJECTED") {
      return {
        toastId: `CR_REJECTED`,
        title: tr("已驳回", "已駁回", "Rejected"),
        lines: [],
        durationMs: 5000,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "TICKER_SET") {
      return {
        toastId: `TICKER_SET`,
        title: tr("股票代码已设置", "股票代碼已設定", "Ticker updated"),
        lines: [
          tr("股价将自动更新（无需手动刷新）。", "股價將自動更新（無需手動刷新）。", "Share price will update automatically."),
          tr("美股开盘约 15 秒/次；非开盘约 1 小时/次。", "美股開盤約 15 秒/次；非開盤約 1 小時/次。", "US market hours: ~15s; otherwise: ~1h."),
        ],
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "BACKOFFICE_USER_CREATED") {
      return {
        toastId: `BACKOFFICE_USER_CREATED:${okUserId || "unknown"}`,
        title: tr("后台用户已创建", "後台使用者已建立", "Backoffice user created"),
        lines: [tr("可使用邮箱与初始密码登录后台。", "可使用信箱與初始密碼登入後台。", "They can sign in with email and the initial password.")],
        durationMs: 4500,
        clearKeys: ["ok", "uid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "EXERCISE_STATUS_UPDATED") {
      const label =
        okNextStatus === "FUNDED"
          ? tr("已确认到账", "已確認到帳", "Verified")
          : okNextStatus === "COMPLETED"
            ? tr("已完成行权", "已完成行權", "Completed")
            : "";
      return {
        toastId: `EXERCISE_STATUS_UPDATED:${okRequestId || "unknown"}`,
        title: tr("行权状态已更新", "行權狀態已更新", "Exercise status updated"),
        lines: [
          okRequestId ? tr(`申请编号：${okRequestId}`, `申請編號：${okRequestId}`, `Request ID: ${okRequestId}`) : "",
          label ? tr(`新状态：${label}`, `新狀態：${label}`, `New status: ${label}`) : "",
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "rid", "nst"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "EXERCISE_PAYMENT_UPDATED") {
      return {
        toastId: `EXERCISE_PAYMENT_UPDATED:${okRequestId || "unknown"}`,
        title: tr("支付信息已更新", "支付資訊已更新", "Payment info updated"),
        lines: [okRequestId ? tr(`申请编号：${okRequestId}`, `申請編號：${okRequestId}`, `Request ID: ${okRequestId}`) : ""].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "rid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "BUYBACK_PROOF_UPLOADED") {
      return {
        toastId: `BUYBACK_PROOF_UPLOADED:${okRequestId || "unknown"}`,
        title: tr("回购截图已上传", "回購截圖已上傳", "Buyback proof uploaded"),
        lines: [
          okRequestId ? tr(`申请编号：${okRequestId}`, `申請編號：${okRequestId}`, `Request ID: ${okRequestId}`) : "",
          tr("已通知员工确认。", "已通知員工確認。", "Employee confirmation is required."),
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "rid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "PAYMENT_CHECK_OK") {
      return {
        toastId: `PAYMENT_CHECK_OK:${okRequestId || "unknown"}`,
        title: tr("已检查到账", "已檢查到帳", "Payment verified"),
        lines: [
          okRequestId ? tr(`申请编号：${okRequestId}`, `申請編號：${okRequestId}`, `Request ID: ${okRequestId}`) : "",
          tr("链上已确认。", "鏈上已確認。", "Confirmed on-chain."),
        ].filter(Boolean),
        durationMs: 4500,
        clearKeys: ["ok", "rid"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "BULK_PAYMENT_CHECKED") {
      const okc = Number(okOkCountRaw || 0);
      const failc = Number(okFailCountRaw || 0);
      return {
        toastId: `BULK_PAYMENT_CHECKED:${okc}:${failc}`,
        title: tr("批量检查完成", "批量檢查完成", "Bulk check completed"),
        lines: [tr(`成功 ${okc} 条 / 失败 ${failc} 条。`, `成功 ${okc} 條 / 失敗 ${failc} 條。`, `Success ${okc} / Failed ${failc}.`)],
        durationMs: 5000,
        clearKeys: ["ok", "okc", "failc"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "BULK_STATUS_UPDATED") {
      const okc = Number(okOkCountRaw || 0);
      const failc = Number(okFailCountRaw || 0);
      const fnp = Number(okFailNotPendingRaw || 0);
      const fnf = Number(okFailNotFundedRaw || 0);
      const frk = Number(okFailRiskyRaw || 0);
      const label =
        okNextStatus === "FUNDED"
          ? tr("已确认到账", "已確認到帳", "Verified")
          : okNextStatus === "COMPLETED"
            ? tr("已完成行权", "已完成行權", "Completed")
            : "";
      return {
        toastId: `BULK_STATUS_UPDATED:${okNextStatus || "unknown"}:${okc}:${failc}`,
        title: tr("批量更新完成", "批量更新完成", "Bulk update completed"),
        lines: [
          label ? tr(`目标状态：${label}`, `目標狀態：${label}`, `Target status: ${label}`) : "",
          tr(`成功 ${okc} 条 / 失败 ${failc} 条。`, `成功 ${okc} 條 / 失敗 ${failc} 條。`, `Success ${okc} / Failed ${failc}.`),
          fnp > 0
            ? tr(`失败原因：状态不是「待确认到账」 ${fnp} 条。`, `失敗原因：狀態不是「待確認到帳」 ${fnp} 條。`, `Failed: not pending ${fnp}.`)
            : "",
          fnf > 0
            ? tr(`失败原因：状态不是「已确认到账」 ${fnf} 条。`, `失敗原因：狀態不是「已確認到帳」 ${fnf} 條。`, `Failed: not funded ${fnf}.`)
            : "",
          frk > 0
            ? tr(`已跳过：检查失败/异常 ${frk} 条（请先逐条检查）。`, `已跳過：檢查失敗/異常 ${frk} 條（請先逐條檢查）。`, `Skipped: risky ${frk}.`)
            : "",
        ].filter(Boolean),
        durationMs: 5000,
        clearKeys: ["ok", "nst", "okc", "failc", "fnp", "fnf", "frk"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "SENSITIVE_REVEAL_ENABLED" || ok === "SENSITIVE_REVEAL_DISABLED") {
      const enabled = ok === "SENSITIVE_REVEAL_ENABLED";
      return {
        toastId: ok,
        title: enabled ? tr("敏感信息已解锁", "敏感資訊已解鎖", "Sensitive view enabled") : tr("敏感信息已隐藏", "敏感資訊已隱藏", "Sensitive view disabled"),
        lines: [
          enabled
            ? tr("本次解锁有效期 5 分钟。", "本次解鎖有效期 5 分鐘。", "This unlock lasts 5 minutes.")
            : tr("已恢复默认脱敏展示。", "已恢復預設脫敏顯示。", "Masked view restored."),
        ],
        durationMs: 4500,
        clearKeys: ["ok", "modal"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "DEPT_CREATED" || ok === "DEPT_RENAMED" || ok === "DEPT_DELETED") {
      const title =
        ok === "DEPT_CREATED"
          ? tr("部门已创建", "部門已建立", "Department created")
          : ok === "DEPT_RENAMED"
            ? tr("部门已重命名", "部門已重新命名", "Department renamed")
            : tr("部门已删除", "部門已刪除", "Department deleted");
      return {
        toastId: `${ok}:${okDeptName || "unknown"}`,
        title,
        lines: okDeptName ? [tr(`部门：${okDeptName}`, `部門：${okDeptName}`, `Department: ${okDeptName}`)] : [],
        durationMs: 4500,
        clearKeys: ["ok", "dn"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "SETTINGS_UPDATED") {
      return {
        toastId: `SETTINGS_UPDATED`,
        title: tr("设置已保存", "設定已儲存", "Settings saved"),
        lines: [],
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "LOGO_UPDATED") {
      return {
        toastId: `LOGO_UPDATED`,
        title: tr("Logo 已更新", "Logo 已更新", "Logo updated"),
        lines: [],
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    if (ok === "VESTING_RUN_OK") {
      return {
        toastId: `VESTING_RUN_OK`,
        title: tr("成熟已运行", "成熟已運行", "Vesting run completed"),
        lines: [tr("已按当前日期刷新成熟记录。", "已按當前日期刷新成熟記錄。", "Vesting records have been refreshed.")],
        durationMs: 4500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }
    if (ok === "DATA_PURGED") {
      return {
        toastId: `DATA_PURGED`,
        title: tr("数据已清空", "資料已清空", "Data cleared"),
        lines: [
          tr(
            "已保留 admin / finance / evan 三个账号，其余业务数据已清空。",
            "已保留 admin / finance / evan 三個帳號，其餘業務資料已清空。",
            "Kept admin / finance / evan accounts; all other business data was removed.",
          ),
          tr("默认密码仍为 123456（如账号为新建）。", "預設密碼仍為 123456（若帳號為新建）。", "Default password is still 123456 (if the account was newly created)."),
        ],
        durationMs: 5500,
        clearKeys: ["ok"],
        actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
      };
    }

    return {
      toastId: `OK:${ok}`,
      title: tr("操作成功", "操作成功", "Success"),
      lines: [],
      durationMs: 4500,
      clearKeys: ["ok", "eid", "gid"],
      actions: [{ label: tr("继续", "繼續", "Continue"), href: baseAfterOkHref }],
    };
  }

  const errorToast = buildErrorToast();
  const successToast = buildSuccessToast();

  type RiskCounts = { all: number; high: number; warn: number; clean: number };
  type TagCounts = { all: number; missing_tx: number; proof_pending: number; addr_mismatch: number; diff_1: number; stale: number; check_failed: number };

  function riskScore(r: unknown) {
    const lvl = requestRiskLevel({ r: r as unknown as RiskRow, settings });
    if (lvl === "high") return 0;
    if (lvl === "warn") return 1;
    return 2;
  }

  function computeRiskCounts(rows: unknown[]): RiskCounts {
    return rows.reduce<RiskCounts>(
      (acc, r) => {
        const lvl = requestRiskLevel({ r: r as unknown as RiskRow, settings });
        acc.all += 1;
        if (lvl === "high") acc.high += 1;
        else if (lvl === "warn") acc.warn += 1;
        else acc.clean += 1;
        return acc;
      },
      { all: 0, high: 0, warn: 0, clean: 0 },
    );
  }

  function computeTagCounts(rows: unknown[]): TagCounts {
    return rows.reduce<TagCounts>(
      (acc, r) => {
        const tags = requestTags({ r: r as unknown as TagRow, settings });
        acc.all += 1;
        if (tags.includes("missing_tx")) acc.missing_tx += 1;
        if (tags.includes("proof_pending")) acc.proof_pending += 1;
        if (tags.includes("addr_mismatch")) acc.addr_mismatch += 1;
        if (tags.includes("diff_1")) acc.diff_1 += 1;
        if (tags.includes("stale")) acc.stale += 1;
        if (tags.includes("check_failed")) acc.check_failed += 1;
        return acc;
      },
      { all: 0, missing_tx: 0, proof_pending: 0, addr_mismatch: 0, diff_1: 0, stale: 0, check_failed: 0 },
    );
  }

  function sortByRiskThenCreatedAt<T extends { createdAt: Date }>(rows: T[]) {
    return rows.slice().sort((a, b) => riskScore(a) - riskScore(b) || a.createdAt.getTime() - b.createdAt.getTime());
  }

  function filterByRisk<T>(rows: T[]) {
    return risk ? rows.filter((r) => requestRiskLevel({ r: r as unknown as RiskRow, settings }) === risk) : rows;
  }

  function filterByTag<T>(rows: T[]) {
    return tag ? rows.filter((r) => requestTags({ r: r as unknown as TagRow, settings }).includes(tag)) : rows;
  }

  function filterBySearch<T extends { employee?: { name?: string | null; department?: string | null } | null; grant?: { agreementNo?: string | null } | null }>(
    rows: T[],
  ) {
    const needle = (q ?? "").trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const n = String(r.employee?.name ?? "").toLowerCase();
      const d = String(r.employee?.department ?? "").toLowerCase();
      const a = String(r.grant?.agreementNo ?? "").toLowerCase();
      return n.includes(needle) || d.includes(needle) || a.includes(needle);
    });
  }

  const exerciseRiskCounts = computeRiskCounts(pendingExercises);
  const buybackRiskCounts = computeRiskCounts(pendingBuybacks);

  const pendingExercisesSorted = sortByRiskThenCreatedAt(pendingExercises);
  const pendingBuybacksSorted = sortByRiskThenCreatedAt(pendingBuybacks);

  const pendingExercisesBase = filterBySearch(filterByRisk(pendingExercisesSorted));
  const pendingBuybacksBase = filterBySearch(filterByRisk(pendingBuybacksSorted));

  const exerciseTagCounts = computeTagCounts(pendingExercisesBase);
  const buybackTagCounts = computeTagCounts(pendingBuybacksBase);

  const pendingExercisesShown = filterByTag(pendingExercisesBase);
  const pendingBuybacksShown = filterByTag(pendingBuybacksBase);

  function PoolWorkbenchHomePanels() {
    return (
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-2xl md:border md:border-zinc-200 md:p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-zinc-900">期权池</div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${poolStatus.cls}`}>{poolStatus.label}</span>
              </div>
              <div className="text-xs text-zinc-500">
                剩余 <span className="font-mono text-zinc-900">{formatInt(remaining)}</span> / 总池{" "}
                <span className="font-mono text-zinc-900">{formatInt(totalPool)}</span> · 已占用{" "}
                <span className="font-mono text-zinc-900">{Math.round(pct * 100)}%</span>
              </div>
            <div className="text-xs text-zinc-500">
              退回 <span className="font-mono text-zinc-900">{formatInt(forfeited)}</span> · 回购退回{" "}
              <span className="font-mono text-zinc-900">{formatInt(buybackReturned)}</span>
            </div>
              <div className="text-xs text-zinc-600">
                股价口径 <span className="font-mono text-zinc-900">{formatMoney(companySharePrice, currency, baseCurrency)}</span>
                {useManualCompanySharePrice ? " · 手动清算" : ""}
              </div>
              {totalPool > 0 && remaining <= 0 ? (
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                  期权池已用尽：无法新增授予。可调整池上限或核对退回/回购记录。
                </div>
              ) : totalPool > 0 && remainingPct < 0.1 ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  期权池剩余不足 10%：请谨慎授予，避免临近超发导致审批卡住。
                </div>
              ) : null}
            </div>
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap: "", risk, tag, ccy: currency, lang, modal: "", view: "", focus: "pool" })}
              className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-4 text-xs font-semibold text-white active:scale-[0.98]"
              scroll={false}
              data-haptic
            >
              查看详情
            </Link>
          </div>
        </section>

        {isSuperAdmin ? (
          <section className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-2xl md:border md:border-zinc-200 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-900">工作台待办</div>
              <span className="text-xs text-zinc-500">总管理员</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#f8fafc] p-3">
                <div className="text-xs text-zinc-500">行权/打款</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">{pendingExerciseCount}</div>
              </div>
              <div className="rounded-2xl bg-[#f8fafc] p-3">
                <div className="text-xs text-zinc-500">离职回购</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">{pendingBuybackCount}</div>
              </div>
            </div>
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap: "", risk, tag, ccy: currency, lang, modal: "", view: "", focus: "workbench" })}
              className="btn-press btn-ripple mt-4 inline-flex h-10 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-[#f8fafc] px-4 text-xs font-semibold text-zinc-900 active:bg-slate-200"
              scroll={false}
              data-haptic
            >
              进入工作台
              {pendingExerciseProofCount + pendingBuybackConfirmCount > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-extrabold text-white">
                  {pendingExerciseProofCount + pendingBuybackConfirmCount}
                </span>
              ) : null}
            </Link>
          </section>
        ) : null}
      </div>
    );
  }

  function OpsHomePanel() {
    return (
      <section className="mt-6 rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-2xl md:border md:border-zinc-200 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-zinc-900">运营操作</div>
            <div className="text-xs leading-5 text-zinc-500">新增员工、发起授予/修改（先建员工，再授予）。</div>
          </div>
          <Link
            href={adminHref({ dept: "", q: "", st: "", edit: "", emp: "", cr: "", crst: "", ap: "", risk: "", tag: "", ccy: currency, lang, modal: "", view: "", focus: "ops" })}
            className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-4 text-xs font-semibold text-white active:scale-[0.98]"
            scroll={false}
            data-haptic
          >
            进入运营操作
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-[#f8fafc] p-4">
            <div className="text-xs text-zinc-500">新增员工</div>
            <div className="mt-1 text-xs text-zinc-600">填姓名/部门/入职日期，可选创建登录账号。</div>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] p-4">
            <div className="text-xs text-zinc-500">发起授予</div>
            <div className="mt-1 text-xs text-zinc-600">选择员工，填写股数/行权价/成熟规则，提交审批或直接生效。</div>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] p-4">
            <div className="text-xs text-zinc-500">员工修改/删除</div>
            <div className="mt-1 text-xs text-zinc-600">在台账里编辑/删除员工，系统会进入审批与留痕。</div>
          </div>
        </div>
      </section>
    );
  }

  function LedgerHomePanels() {
    return (
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs text-zinc-500">在职员工</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900">{employeeActiveCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs text-zinc-500">离职员工</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900">{employeeTerminatedCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs text-zinc-500">员工总数</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900">{employeeTotalCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">快捷入口</div>
          <Link
            href={adminHref({ dept: "", q: "", st: "", edit: "", emp: "", cr: "", crst: "", ap: "", risk: "", tag: "", ccy: currency, lang, modal: "", view: "", focus: "ledger" })}
            className="mt-2 inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800"
            scroll={false}
          >
            进入台账
          </Link>
          <div className="mt-2 text-xs text-zinc-500">支持按部门/状态筛选与搜索。</div>
        </div>
      </div>
    );
  }

  function safeIsoDateLabel(iso: string) {
    const raw = (iso ?? "").trim();
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return formatDate(d, lang);
  }

  function vestingLabelFromPayload(payload: Record<string, unknown>) {
    const vestingType = jsonString(payload["vestingType"]);
    const duration = Number(payload["totalVestingDurationMonths"]);
    const installments = Number(payload["vestingInstallments"]);
    if (vestingType === "IMMEDIATE") return "立即成熟";
    if (vestingType === "CUSTOM_INSTALLMENTS") {
      return `自定义分期（${Number.isFinite(duration) ? duration : "—"} 月 / ${Number.isFinite(installments) ? installments : "—"} 期）`;
    }
    return "—";
  }

  function changeRequestSummaryFromPayload(input: { type: unknown; payload: unknown }) {
    const t = String(input.type ?? "");
    const payload = jsonObject(input.payload);

    if (t === "EMPLOYEE_UPDATE") {
      const startDateLabel = safeIsoDateLabel(jsonString(payload["startDate"]));
      const loginAccount = jsonString(payload["account"]);
      const loginEmail = jsonString(payload["email"]);
      return `姓名 ${jsonString(payload["name"])} · 部门 ${jsonString(payload["department"])} · 状态 ${jsonString(payload["status"])} · 入职 ${startDateLabel || "—"}${loginAccount ? ` · 账号 ${loginAccount}` : ""}${loginEmail ? ` · 邮箱 ${loginEmail}` : ""}`;
    }

    if (t === "EMPLOYEE_DELETE") {
      return "删除员工";
    }

    if (t === "GRANT_CREATE") {
      const grantDateLabel = safeIsoDateLabel(jsonString(payload["grantDate"]));
      const totalShares = Number(payload["totalShares"]);
      const strikePriceNum = Number(payload["strikePrice"]);
      const strikeLabel = Number.isFinite(strikePriceNum)
        ? formatMoney(new Prisma.Decimal(strikePriceNum), currency, baseCurrency)
        : "—";
      const lockupMonths = Number(payload["lockupPeriodMonths"]);
      const vestingLabel = vestingLabelFromPayload(payload);
      return `授予 ${Number.isFinite(totalShares) ? formatInt(totalShares) : "—"} 股 · 授予日 ${grantDateLabel || "—"} · 行权价 ${strikeLabel} · 锁定期 ${Number.isFinite(lockupMonths) ? `${lockupMonths} 月` : "—"} · 成熟机制 ${vestingLabel}`;
    }

    return "—";
  }

  function ApprovalTodoCard({
    cr,
    className,
    actionsClassName,
  }: {
    cr: (typeof pendingChangeRequests)[number];
    className: string;
    actionsClassName: string;
  }) {
    const summary = changeRequestSummaryFromPayload({ type: cr.type, payload: cr.payload });
    const payload = jsonObject(cr.payload);
    const typeKey = String(cr.type ?? "");
    const statusKey = String(cr.status ?? "");
    const targetStatusLabel =
      cr.targetEmployee?.status === "ACTIVE"
        ? "在职"
        : cr.targetEmployee?.status === "TERMINATED"
          ? "离职"
          : "—";

    const targetName = cr.targetEmployee?.name ?? "—";
    const targetDept = cr.targetEmployee?.department ?? "—";
    const avatarText = String(targetName).trim().slice(0, 1) || "—";
    const statusPill =
      statusKey === "PENDING"
        ? "bg-[#2563eb]/10 text-[#2563eb]"
        : statusKey === "APPROVED" || statusKey === "APPLIED"
          ? "bg-emerald-50 text-[#059669]"
          : statusKey === "REJECTED"
            ? "bg-rose-50 text-[#e11d48]"
            : "bg-[#f8fafc] text-zinc-700";

    const coreA = (() => {
      if (typeKey === "GRANT_CREATE") {
        const totalShares = Number(payload["totalShares"]);
        const strikePriceNum = Number(payload["strikePrice"]);
        const strikeLabel = Number.isFinite(strikePriceNum)
          ? formatMoney(new Prisma.Decimal(strikePriceNum), currency, baseCurrency)
          : "—";
        return {
          leftLabel: "授予股数",
          leftValue: Number.isFinite(totalShares) ? formatInt(totalShares) : "—",
          rightLabel: "行权价",
          rightValue: strikeLabel,
        };
      }
      if (typeKey === "EMPLOYEE_UPDATE") {
        const nextDept = jsonString(payload["department"]) || "—";
        const nextStatusRaw = jsonString(payload["status"]);
        const nextStatus = nextStatusRaw === "ACTIVE" ? "在职" : nextStatusRaw === "TERMINATED" ? "离职" : "—";
        return {
          leftLabel: "目标状态",
          leftValue: nextStatus,
          rightLabel: "目标部门",
          rightValue: nextDept,
        };
      }
      if (typeKey === "EMPLOYEE_DELETE") {
        return {
          leftLabel: "操作",
          leftValue: "删除员工",
          rightLabel: "影响",
          rightValue: "不可逆",
        };
      }
      return {
        leftLabel: "类型",
        leftValue: changeRequestTypeLabel(typeKey),
        rightLabel: "状态",
        rightValue: changeRequestStatusLabel(statusKey),
      };
    })();

    return (
      <div className={`${className} relative overflow-hidden`} data-swipe-card>
        <div
          className="relative z-10 flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between"
          data-swipe-surface
        >
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10 text-sm font-semibold text-[#2563eb]">
                  {avatarText}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900">{targetName}</div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {targetDept} · {targetStatusLabel} · {changeRequestTypeLabel(typeKey)}
                  </div>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusPill}`}>
                {changeRequestStatusLabel(statusKey)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
                <div className="text-[11px] font-semibold text-zinc-500">{coreA.leftLabel}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-900">{coreA.leftValue}</div>
              </div>
              <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
                <div className="text-[11px] font-semibold text-zinc-500">{coreA.rightLabel}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-900">{coreA.rightValue}</div>
              </div>
            </div>

            <div className="mt-2 text-[11px] text-zinc-500">
              申请人 <span className="font-mono text-zinc-700">{cr.requestedByUser.email}</span>{" "}
              <span className="text-zinc-300">·</span>{" "}
              <span className="font-mono text-zinc-700">{formatDateTime(cr.createdAt, lang)}</span>
            </div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500 break-words">
              变更内容 {summary}
            </div>
            <div className="hidden" />
          </div>

          <div className={actionsClassName}>
            <Link
              href={adminHref({ dept, q, st: status, ccy: currency, lang, modal: "cr_detail", cr: cr.id })}
              className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center gap-2 rounded-2xl bg-[#f8fafc] px-3 text-xs font-semibold text-zinc-900 active:bg-slate-200 md:h-9 md:rounded-xl"
              scroll={false}
              data-haptic
            >
              <FileText width={14} height={14} strokeWidth={1.5} />
              详情
            </Link>
            <form action={decideChangeRequest} data-lock-submit="1" data-undo="1" data-undo-sec="8" data-undo-title="将驳回申请" data-undo-btn="撤销">
              <input type="hidden" name="lang" value={lang} />
              <input
                type="hidden"
                name="returnTo"
                value={adminHref({ dept, q, st: status, edit, emp, cr: "", crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })}
              />
              <input type="hidden" name="id" value={cr.id} />
              <input type="hidden" name="decision" value="REJECT" />
              <button
                className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl bg-[#f8fafc] px-3 text-xs font-semibold text-zinc-900 active:scale-[0.98] active:bg-slate-200 md:h-9 md:rounded-xl"
                data-haptic
              >
                驳回
              </button>
            </form>
            <form action={decideChangeRequest} data-lock-submit="1" data-undo="1" data-undo-sec="8" data-undo-title="将通过并生效" data-undo-btn="撤销">
              <input type="hidden" name="lang" value={lang} />
              <input
                type="hidden"
                name="returnTo"
                value={adminHref({ dept, q, st: status, edit, emp, cr: "", crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })}
              />
              <input type="hidden" name="id" value={cr.id} />
              <input type="hidden" name="decision" value="APPROVE" />
              <button
                className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white active:scale-[0.98] md:h-9 md:rounded-xl"
                data-haptic
              >
                通过并生效
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  function GrantCreateAuditCard({
    cr,
    className,
  }: {
    cr: (typeof grantCreateAudits)[number];
    className: string;
  }) {
    const payload = jsonObject(cr.payload);
    const agreementNo = jsonString(payload["agreementNo"]) || cr.targetGrant?.agreementNo || "—";
    const totalShares = Number(payload["totalShares"]);
    const strikePriceNum = Number(payload["strikePrice"]);
    const strikeLabel = Number.isFinite(strikePriceNum)
      ? formatMoney(new Prisma.Decimal(strikePriceNum), currency, baseCurrency)
      : "—";
    const lockupMonths = Number(payload["lockupPeriodMonths"]);
    const vestingLabel = vestingLabelFromPayload(payload);
    const employeeLabel = cr.targetGrant?.employee ? `${cr.targetGrant.employee.name} · ${cr.targetGrant.employee.department}` : "—";

    return (
      <div className={className}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">
            授予 · {agreementNo} · {employeeLabel}
          </div>
          <div className="text-xs text-zinc-500">{formatDateTime(cr.createdAt, lang)}</div>
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          {Number.isFinite(totalShares) ? `${formatInt(totalShares)} 股` : "—"} · 行权价 {strikeLabel} · 锁定期{" "}
          {Number.isFinite(lockupMonths) ? `${lockupMonths} 月` : "—"} · 成熟机制 {vestingLabel}
        </div>
        <div className="mt-1 text-xs text-zinc-600">创建人 {cr.requestedByUser.email}</div>
        <div className="mt-2">
          <Link
            href={adminHref({ dept, q, st: status, ccy: currency, lang, modal: "cr_detail", cr: cr.id })}
            className="btn-press btn-ripple inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white"
            scroll={false}
          >
            <FileText width={14} height={14} strokeWidth={1.5} />
            详情
          </Link>
        </div>
      </div>
    );
  }

  function MyChangeRequestCard({
    cr,
  }: {
    cr: (typeof myChangeRequests)[number];
  }) {
    const summary = changeRequestSummaryFromPayload({ type: cr.type, payload: cr.payload });
    const targetStatusLabel =
      cr.targetEmployee?.status === "ACTIVE"
        ? "在职"
        : cr.targetEmployee?.status === "TERMINATED"
          ? "离职"
          : "—";

    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">
            {changeRequestTypeLabel(String(cr.type))} · {changeRequestStatusLabel(String(cr.status))}
          </div>
          <div className="text-xs text-zinc-500">{formatDateTime(cr.createdAt, lang)}</div>
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          审批时间 {cr.decidedAt ? formatDateTime(cr.decidedAt, lang) : "—"}
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          目标员工 {cr.targetEmployee?.name ?? "—"} · {cr.targetEmployee?.department ?? "—"} · {targetStatusLabel}
        </div>
        <div className="mt-1 text-xs text-zinc-600">变更内容 {summary}</div>
        <div className="mt-2">
          <Link
            href={adminHref({ dept, q, st: status, ccy: currency, lang, modal: "cr_detail", cr: cr.id })}
            className="btn-press btn-ripple inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white"
            scroll={false}
          >
            <FileText width={14} height={14} strokeWidth={1.5} />
            详情
          </Link>
        </div>
      </div>
    );
  }

  function renderApprovalsSection() {
    if (!(showAll || focus === "approvals")) return null;
    return (
      <section
        id="approvals"
        className="mt-6 rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-2xl md:border md:border-black/5 md:bg-white/80 md:shadow-sm md:hover:shadow-md sm:p-6"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-zinc-900">变更审批</h2>
            <p className="text-xs leading-5 text-zinc-500">
              处理员工/协议变更申请；审批通过后生效，并保留完整留痕。
            </p>
          </div>
          <div className="text-xs text-zinc-500">
            当前身份：{isSuperAdmin ? "总管理员" : isFinance ? "财务" : "—"}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {isSuperAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "todo", ccy: currency, lang, modal: "", view: "", focus: "approvals" })}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  !showAll && approvalsTab === "todo"
                    ? "bg-[#2563eb]/10 text-[#2563eb]"
                    : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                待我审批 <span className="font-mono">{pendingChangeRequestCount}</span>
              </Link>
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "audit", ccy: currency, lang, modal: "", view: "", focus: "approvals" })}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  !showAll && approvalsTab === "audit"
                    ? "bg-[#2563eb]/10 text-[#2563eb]"
                    : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                授予留痕 <span className="font-mono">{grantCreateAuditCount}</span>
              </Link>
            </div>
          ) : null}
          {isFinance ? (
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "mine", ccy: currency, lang, modal: "", view: "", focus: "ops" })}
              className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-4 text-xs font-semibold text-white active:scale-[0.98]"
              scroll={false}
              data-haptic
            >
              去发起申请
            </Link>
          ) : null}
        </div>

        {isSuperAdmin ? (
          showAll ? (
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-zinc-900">待我审批</div>
                  <Link
                    href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "todo", ccy: currency, lang, modal: "", view: "", focus: "approvals" })}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                    scroll={false}
                  >
                    查看全部
                  </Link>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {pendingChangeRequests.length === 0 ? (
                    <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-zinc-500">
                      暂无待审批申请
                    </div>
                  ) : (
                    pendingChangeRequests.map((cr, idx) => (
                      <div
                        key={cr.id}
                        className="ui-stagger-in"
                        style={{ animationDelay: `${Math.min(20, Math.max(0, idx)) * 50}ms` }}
                      >
                        <ApprovalTodoCard
                          cr={cr}
                          className="rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:p-5"
                          actionsClassName="mt-3 grid grid-cols-3 gap-2 md:mt-0 md:flex md:shrink-0 md:items-center md:justify-end"
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-zinc-900">授予留痕</div>
                  <Link
                    href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "audit", ccy: currency, lang, modal: "", view: "", focus: "approvals" })}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                    scroll={false}
                  >
                    查看全部
                  </Link>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {grantCreateAudits.length === 0 ? (
                    <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-zinc-500">
                      暂无授予留痕
                    </div>
                  ) : (
                    grantCreateAudits.map((cr) => (
                      <GrantCreateAuditCard
                        key={cr.id}
                        cr={cr}
                        className="rounded-2xl bg-[#f8fafc] px-4 py-3"
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : approvalsTab === "audit" ? (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-zinc-600">授予留痕</div>
                <div className="text-xs text-zinc-500">{grantCreateAuditCount}</div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {grantCreateAudits.length === 0 ? (
                  <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-zinc-500">
                    暂无授予留痕
                  </div>
                ) : (
                  grantCreateAudits.map((cr) => (
                    <GrantCreateAuditCard
                      key={cr.id}
                      cr={cr}
                      className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3">
              {pendingChangeRequests.length === 0 ? (
                <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-zinc-500">
                  暂无待审批申请
                </div>
              ) : (
                pendingChangeRequests.map((cr, idx) => (
                  <div
                    key={cr.id}
                    className="ui-stagger-in"
                    style={{ animationDelay: `${Math.min(20, Math.max(0, idx)) * 50}ms` }}
                  >
                    <ApprovalTodoCard
                      cr={cr}
                      className="rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:p-5"
                      actionsClassName="mt-3 grid grid-cols-3 gap-2 md:mt-0 md:flex md:shrink-0 md:items-center md:justify-end"
                    />
                  </div>
                ))
              )}
            </div>
          )
        ) : isFinance ? (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "PENDING", ap: "mine", ccy: currency, lang, modal, view: "", focus: "approvals" })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  crst === "PENDING"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                待审批 <span className="font-mono">{myChangeRequestCounts.PENDING}</span>
              </Link>
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "APPROVED", ap: "mine", ccy: currency, lang, modal, view: "", focus: "approvals" })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  crst === "APPROVED"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                已通过 <span className="font-mono">{myChangeRequestCounts.APPROVED}</span>
              </Link>
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "REJECTED", ap: "mine", ccy: currency, lang, modal, view: "", focus: "approvals" })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  crst === "REJECTED"
                    ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                已驳回 <span className="font-mono">{myChangeRequestCounts.REJECTED}</span>
              </Link>
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "APPLIED", ap: "mine", ccy: currency, lang, modal, view: "", focus: "approvals" })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  crst === "APPLIED"
                    ? "border-emerald-200 bg-emerald-50 text-[#059669]"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                已生效 <span className="font-mono">{myChangeRequestCounts.APPLIED}</span>
              </Link>
              <Link
                href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst: "", ap: "mine", ccy: currency, lang, modal, view: "", focus: "approvals" })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  !crst ? "border-zinc-300 bg-zinc-100 text-zinc-900" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                全部 <span className="font-mono">{myChangeRequestCounts.ALL}</span>
              </Link>
            </div>
            {myChangeRequests.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
                {crst ? "该状态下暂无申请记录" : "暂无申请记录"}
              </div>
            ) : (
              myChangeRequests.map((cr) => <MyChangeRequestCard key={cr.id} cr={cr} />)
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
            无权限查看
          </div>
        )}
      </section>
    );
  }

  function renderLedgerRow(e: (typeof ledgerEmployees)[number], idx: number) {
    const totalGranted = totalGrantedByEmployee.get(e.id) ?? 0;
    const vestedShares = vestedByEmployeeMap.get(e.id) ?? 0;
    const exercisedShares = exercisedByEmployeeMap.get(e.id) ?? 0;
    const lastExerciseAt = lastExerciseAtByEmployee.get(e.id) ?? null;
    const progress = totalGranted > 0 ? Math.min(vestedShares / totalGranted, 1) : 0;
    const nextV = nextVestByEmployee.get(e.id) ?? null;
    const endV = endVestByEmployee.get(e.id) ?? null;
    const vestedValue = companySharePrice.mul(vestedShares);
    const strikeAgg = strikeAggByEmployee.get(e.id);
    const avgStrike =
      strikeAgg && strikeAgg.sumShares > 0
        ? strikeAgg.sumStrikeValue.div(strikeAgg.sumShares)
        : null;
    const strikeMin = strikeAgg?.minStrike ?? null;
    const strikeMax = strikeAgg?.maxStrike ?? null;
    const expiry = terminationExpiryByEmployee.get(e.id) ?? null;
    const urgentExpiryDays =
      e.status === "TERMINATED" && expiry && expiry.daysLeft >= 0 && expiry.daysLeft <= 2 ? expiry.daysLeft : null;
    const statusPillLabel = e.status === "ACTIVE" ? "在职" : urgentExpiryDays != null ? `离职·${urgentExpiryDays}天` : "离职";
    const canToggleStatus = isSuperAdmin || isFinance;
    const nextStatus = e.status === "ACTIVE" ? "TERMINATED" : "ACTIVE";
    const financeStatusConfirmHref = adminHref({
      dept,
      q,
      st: status,
      ccy: currency,
      lang,
      view,
      focus,
      modal: "emp_status_confirm",
      emp: e.id,
      ns: nextStatus,
    });
    const toggleReturnTo = adminHref({
      dept,
      q,
      st: status,
      ccy: currency,
      lang,
      view,
      focus,
      emp: "",
      edit: "",
      modal: "",
      cr: "",
      crst: "",
      ap: "",
    });
    const zebraBg = idx % 2 === 0 ? "bg-white" : "bg-[#f8fafc]";

    return (
      <tr
        key={e.id}
        className={`ui-stagger-in group transition-colors ${zebraBg} hover:bg-slate-50`}
        style={{ animationDelay: `${Math.min(20, Math.max(0, idx)) * 50}ms` }}
      >
        <td
          className={`sticky left-0 z-10 relative px-2 py-2 pl-3 align-top text-zinc-900 ${zebraBg} group-hover:bg-slate-50 sm:px-3 sm:py-3 sm:pl-4`}
        >
          <span className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-indigo-500 opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="truncate">{e.name}</div>
          {e.user?.account ? (
            <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{e.user.account}</div>
          ) : (
            <div className="mt-0.5 truncate text-xs text-zinc-400">未开通账号</div>
          )}
        </td>
        <td className="px-2 py-2 align-top text-zinc-700 sm:px-3 sm:py-3">
          <div className="truncate">{e.department}</div>
        </td>
        <td className="px-2 py-2 align-top sm:px-3 sm:py-3">
          {canToggleStatus ? (
            isFinance ? (
              <Link
                href={financeStatusConfirmHref}
                className={`btn-press inline-flex touch-manipulation items-center rounded-full border px-2 py-0.5 text-xs font-medium active:scale-[0.98] ${
                  e.status === "ACTIVE"
                    ? "border-emerald-200 bg-emerald-50 text-[#059669] hover:bg-emerald-100"
                    : urgentExpiryDays != null
                      ? "border-rose-200 bg-rose-50 text-[#e11d48] hover:bg-rose-100"
                      : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                }`}
                title={e.status === "ACTIVE" ? "提请审批：切换为离职" : "提请审批：切换为在职"}
                scroll={false}
              >
                {statusPillLabel}
              </Link>
            ) : (
              <form action={updateEmployeeDirect} className="inline-block">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="returnTo" value={toggleReturnTo} />
                <input type="hidden" name="successTo" value={toggleReturnTo} />
                <input type="hidden" name="employeeId" value={e.id} />
                <input type="hidden" name="name" value={e.name} />
                <input type="hidden" name="department" value={e.department} />
                <input type="hidden" name="startDate" value={ymdInTimeZone(e.startDate, BUSINESS_TIMEZONE)} />
                <input type="hidden" name="status" value={nextStatus} />
                <button
                  className={`btn-press inline-flex touch-manipulation items-center rounded-full border px-2 py-0.5 text-xs font-medium active:scale-[0.98] ${
                    e.status === "ACTIVE"
                      ? "border-emerald-200 bg-emerald-50 text-[#059669] hover:bg-emerald-100"
                      : urgentExpiryDays != null
                        ? "border-rose-200 bg-rose-50 text-[#e11d48] hover:bg-rose-100"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                  }`}
                  title={e.status === "ACTIVE" ? "点击切换为离职" : "点击切换为在职"}
                >
                  {statusPillLabel}
                </button>
              </form>
            )
          ) : (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                e.status === "ACTIVE"
                  ? "border-emerald-200 bg-emerald-50 text-[#059669]"
                  : urgentExpiryDays != null
                    ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600"
              }`}
            >
              {statusPillLabel}
            </span>
          )}
        </td>
        <td className="px-2 py-2 align-top text-right sm:px-3 sm:py-3">
          {avgStrike ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="truncate text-zinc-900">{formatMoney(avgStrike, currency, baseCurrency)}</div>
              {strikeMin && strikeMax && !strikeMin.equals(strikeMax) ? (
                <div className="truncate text-xs text-zinc-500">
                  {formatMoney(strikeMin, currency, baseCurrency)} ~ {formatMoney(strikeMax, currency, baseCurrency)}
                </div>
              ) : null}
            </div>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
        <td className="px-2 py-2 align-top text-right text-zinc-900 sm:px-3 sm:py-3">
          <div className="inline-flex items-center justify-end gap-2">
            <span className="font-mono tabular-nums">{formatInt(totalGranted)}</span>
            <Link
              href={adminHref({ dept, q, st: status, edit, emp: e.id, ccy: currency, lang, modal: "grant_history" })}
              className="btn-press inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/5 bg-white/80 text-zinc-700 hover:bg-white hover:shadow-sm"
              aria-label="查看授予记录"
              title="查看授予记录"
              scroll={false}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
                <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </Link>
          </div>
        </td>
        <td className="px-2 py-2 align-top text-right font-medium text-[#059669] sm:px-3 sm:py-3">
          <span className="font-mono tabular-nums">{formatInt(vestedShares)}</span>
        </td>
        <td className="px-2 py-2 align-top text-right sm:px-3 sm:py-3">
          {exercisedShares > 0 ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="font-mono tabular-nums font-medium text-indigo-700">{formatInt(exercisedShares)}</div>
              {lastExerciseAt ? (
                <div className="text-xs text-zinc-500">最近 {formatDate(lastExerciseAt, lang)}</div>
              ) : null}
            </div>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
        <td className="px-2 py-2 align-top sm:px-3 sm:py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-zinc-500">
              <span className="font-mono tabular-nums">{Math.round(progress * 100)}%</span>
              {nextV ? (
                <span className="min-w-0 truncate">下次 {formatDate(nextV, lang)}</span>
              ) : endV ? (
                <span>已到期</span>
              ) : (
                <span>—</span>
              )}
            </div>
            <AnimatedProgressBar percent={progress} barClassName="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300" />
            {endV ? (
              <div className="mt-1 truncate text-xs text-zinc-500">完全成熟 {formatDate(endV, lang)}</div>
            ) : null}
          </div>
        </td>
        <td className="px-2 py-2 align-top text-right font-medium text-[#059669] sm:px-3 sm:py-3">
          <div className="truncate font-mono tabular-nums" title={formatMoney(vestedValue, currency, baseCurrency)}>
            {formatMoney(vestedValue, currency, baseCurrency)}
          </div>
        </td>
        <td className="px-2 py-2 align-top sm:px-3 sm:py-3">
          {e.status === "TERMINATED" ? (
            expiry ? (
              <div className="flex flex-col gap-0.5">
                <div className="text-xs text-zinc-500">到期 {formatDate(expiry.expiryAt, lang)}</div>
                {expiry.daysLeft >= 0 ? (
                  <div
                    className={`inline-flex w-fit items-center rounded-lg px-2 py-0.5 text-xs font-semibold ${
                      expiry.daysLeft <= 30 ? "animate-pulse bg-rose-50 text-[#e11d48]" : "bg-zinc-50 text-zinc-900"
                    }`}
                  >
                    剩余 {expiry.daysLeft} 天
                  </div>
                ) : (
                  <div className="text-sm font-medium text-zinc-900">已过期 {Math.abs(expiry.daysLeft)} 天</div>
                )}
              </div>
            ) : (
              <span className="text-zinc-500">—</span>
            )
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
        <td
          className={`sticky right-0 z-10 border-l border-zinc-200/70 px-2 py-2 align-middle text-right ${zebraBg} group-hover:bg-slate-50 sm:px-3 sm:py-3`}
        >
          <div className="flex items-center justify-end">
            <Link
              href={adminHref({ dept, q, st: status, emp: e.id, ccy: currency, lang, modal: "employee_edit" })}
              className="btn-press btn-ripple inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-black/5 bg-white/80 px-2.5 text-xs font-semibold text-zinc-900 hover:bg-white"
              scroll={false}
            >
              <PencilLine width={14} height={14} strokeWidth={1.5} />
              编辑
            </Link>
          </div>
        </td>
      </tr>
    );
  }

  function renderLedgerCard(e: (typeof ledgerEmployees)[number], idx: number) {
    const totalGranted = totalGrantedByEmployee.get(e.id) ?? 0;
    const vestedShares = vestedByEmployeeMap.get(e.id) ?? 0;
    const exercisedShares = exercisedByEmployeeMap.get(e.id) ?? 0;
    const lastExerciseAt = lastExerciseAtByEmployee.get(e.id) ?? null;
    const progress = totalGranted > 0 ? Math.min(vestedShares / totalGranted, 1) : 0;
    const nextV = nextVestByEmployee.get(e.id) ?? null;
    const endV = endVestByEmployee.get(e.id) ?? null;
    const vestedValue = companySharePrice.mul(vestedShares);
    const strikeAgg = strikeAggByEmployee.get(e.id);
    const avgStrike =
      strikeAgg && strikeAgg.sumShares > 0
        ? strikeAgg.sumStrikeValue.div(strikeAgg.sumShares)
        : null;
    const expiry = terminationExpiryByEmployee.get(e.id) ?? null;

    const urgentExpiryDays =
      e.status === "TERMINATED" && expiry && expiry.daysLeft >= 0 && expiry.daysLeft <= 2 ? expiry.daysLeft : null;
    const statusLabel = e.status === "ACTIVE" ? "在职" : e.status === "TERMINATED" ? (urgentExpiryDays != null ? `离职·${urgentExpiryDays}天` : "离职") : "—";
    const avgStrikeLabel = avgStrike ? formatMoney(avgStrike, currency, baseCurrency) : "—";
    const grantedLabel = formatInt(totalGranted);
    const vestedLabel = formatInt(vestedShares);
    const exercisedLabel = exercisedShares > 0 ? formatInt(exercisedShares) : "—";
    const lastExerciseLabel = lastExerciseAt ? `最近 ${formatDate(lastExerciseAt, lang)}` : "";
    const progressLabel = `${Math.round(progress * 100)}%`;
    const nextVestLabel = nextV ? `下次 ${formatDate(nextV, lang)}` : endV ? "已到期" : "—";
    const endVestLabel = endV ? `完全成熟 ${formatDate(endV, lang)}` : "";
    const vestedValueLabel = formatMoney(vestedValue, currency, baseCurrency);
    const expiryLabel =
      e.status === "TERMINATED"
        ? expiry
          ? expiry.daysLeft >= 0
            ? `剩余 ${expiry.daysLeft} 天（到期 ${formatDate(expiry.expiryAt, lang)}）`
            : `已过期 ${Math.abs(expiry.daysLeft)} 天（到期 ${formatDate(expiry.expiryAt, lang)}）`
          : "—"
        : "—";

    return (
      <div
        key={e.id}
        className="ui-stagger-in w-full rounded-2xl bg-white p-4 text-left shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        style={{ animationDelay: `${Math.min(20, Math.max(0, idx)) * 50}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb]/10 text-sm font-semibold text-[#2563eb]">
              {String(e.name ?? "").trim().slice(0, 1) || "—"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-zinc-900">{e.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                {e.user?.account ? (
                  <span className="font-mono text-zinc-500">{e.user.account}</span>
                ) : (
                  <span className="text-zinc-400">未开通账号</span>
                )}
                <span className="text-zinc-300">·</span>
                <span className="truncate">{e.department}</span>
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
              e.status === "ACTIVE"
                ? "border-emerald-200 bg-emerald-50 text-[#059669]"
                : "border-rose-200 bg-rose-50 text-[#e11d48]"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        {e.status === "TERMINATED" && expiry ? (
          <div
            className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${
              expiry.daysLeft >= 0 && expiry.daysLeft <= 2 ? "bg-rose-50 text-[#e11d48]" : "bg-[#f8fafc] text-zinc-700"
            }`}
          >
            {expiry.daysLeft >= 0
              ? `离职过期：剩余 ${expiry.daysLeft} 天 · 到期 ${formatDate(expiry.expiryAt, lang)}`
              : `离职过期：已过期 ${Math.abs(expiry.daysLeft)} 天 · 到期 ${formatDate(expiry.expiryAt, lang)}`}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
            <div className="text-[11px] font-medium text-zinc-500">已授予</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-900">{grantedLabel}</div>
          </div>
          <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
            <div className="text-[11px] font-medium text-zinc-500">已成熟</div>
            <div className="mt-0.5 text-sm font-semibold text-[#059669]">{vestedLabel}</div>
          </div>
          <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
            <div className="text-[11px] font-medium text-zinc-500">已行权</div>
            <div className="mt-0.5 text-sm font-semibold text-indigo-700">{exercisedLabel}</div>
            {lastExerciseLabel ? (
              <div className="mt-0.5 text-[11px] text-zinc-500">{lastExerciseLabel}</div>
            ) : null}
          </div>
          <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
            <div className="text-[11px] font-medium text-zinc-500">已成熟价值</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-[#059669]">{vestedValueLabel}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-[#f8fafc] px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>成熟进度 {progressLabel}</span>
            <span className="min-w-0 truncate">{nextVestLabel}</span>
          </div>
          <AnimatedProgressBar percent={progress} barClassName="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300" />
          {endVestLabel ? <div className="mt-1 text-[11px] text-zinc-500">{endVestLabel}</div> : null}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-600">
          <div className="truncate">均价行权 {avgStrikeLabel}</div>
          <button
            type="button"
            className="btn-press btn-ripple shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 active:bg-slate-200"
            data-ledger-open
            data-haptic
            data-emp-id={e.id}
            data-emp-name={e.name}
            data-emp-dept={e.department}
            data-emp-status={statusLabel}
            data-emp-avg-strike={avgStrikeLabel}
            data-emp-granted={grantedLabel}
            data-emp-vested={vestedLabel}
            data-emp-exercised={exercisedLabel}
            data-emp-last-exercise={lastExerciseLabel}
            data-emp-progress={progressLabel}
            data-emp-next-vest={nextVestLabel}
            data-emp-end-vest={endVestLabel}
            data-emp-vested-value={vestedValueLabel}
            data-emp-expiry={expiryLabel}
            data-emp-edit-href={adminHref({ dept, q, st: status, emp: e.id, ccy: currency, lang, modal: "employee_edit" })}
            data-emp-grant-href={adminHref({ dept, q, st: status, edit, emp: e.id, ccy: currency, lang, modal: "grant_history" })}
          >
            查看
          </button>
        </div>
      </div>
    );
  }

  type WorkbenchPaymentRow = {
    id: string;
    status: unknown;
    createdAt: Date;
    isBuybackOrCancel?: unknown;
    paymentChain: unknown;
    paymentToAddress: unknown;
    paymentTxHash: unknown;
    paymentProofDataUrl?: unknown;
    paymentProofUploadedByRole?: unknown;
    paymentProofConfirmedAt?: unknown;
    paymentAmountUsdt: unknown;
    paymentReceivedUsdt?: unknown;
    paymentCheckedAt?: unknown;
    paymentCheckError?: unknown;
  };

  type WorkbenchTagTone = "rose" | "amber" | "zinc";

  const workbenchReturnTo = adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal });

  function renderWorkbenchTagPills(tags: Array<{ label: string; tone: WorkbenchTagTone }>) {
    if (tags.length === 0) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {tags.map((t, idx) => (
          <span
            key={`${t.label}-${idx}`}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              t.tone === "rose"
                ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                : t.tone === "amber"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            {t.label}
          </span>
        ))}
      </div>
    );
  }

  function buildWorkbenchPaymentTags(input: { r: WorkbenchPaymentRow; includeMissing: boolean }) {
    const { r, includeMissing } = input;
    const tags: Array<{ label: string; tone: WorkbenchTagTone }> = [];

    const chain = String(r.paymentChain ?? "");
    const tx = String(r.paymentTxHash ?? "");
    const toAddr = String(r.paymentToAddress ?? "").trim();
    const isBuyback = String(r.isBuybackOrCancel ?? "") === "true";
    const proof = String(r.paymentProofDataUrl ?? "").trim();
    const proofConfirmedAt = String(r.paymentProofConfirmedAt ?? "").trim();
    const expected =
      chain === "BNB"
        ? String(settings?.usdtBnbAddress ?? "").trim()
        : chain === "TRX"
          ? String(settings?.usdtTrxAddress ?? "").trim()
          : "";

    if (includeMissing) {
      if (!chain) tags.push({ label: "缺链", tone: "rose" });
      if (!toAddr) tags.push({ label: "缺收款地址", tone: "rose" });
      if (!tx) tags.push({ label: "缺TxHash", tone: "rose" });
    }
    if (expected && toAddr && expected !== toAddr) {
      tags.push({ label: "收款地址不匹配", tone: "rose" });
    }

    const expectedUsdt = (r.paymentAmountUsdt ?? null) as Prisma.Decimal | null;
    const receivedUsdt = (r.paymentReceivedUsdt ?? null) as Prisma.Decimal | null;
    if (expectedUsdt && expectedUsdt.gt(0)) {
      tags.push({ label: `应收 ${expectedUsdt.toFixed(2)} USDT`, tone: "zinc" });
    }
    if (receivedUsdt && receivedUsdt.gt(0)) {
      tags.push({ label: `到账 ${receivedUsdt.toFixed(2)} USDT`, tone: "zinc" });
    }
    if (expectedUsdt && expectedUsdt.gt(0) && receivedUsdt && receivedUsdt.gt(0)) {
      const diffPct = Number(receivedUsdt.sub(expectedUsdt).div(expectedUsdt).mul(100).toFixed(1));
      const abs = Math.abs(diffPct);
      const label = `偏差 ${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%`;
      if (abs >= 1) tags.push({ label, tone: "rose" });
      else if (abs >= 0.2) tags.push({ label, tone: "amber" });
    }

    if (r.paymentCheckedAt && r.paymentCheckError) {
      tags.push({ label: "检查失败", tone: "amber" });
    }

    if (proof && !proofConfirmedAt) {
      tags.push({ label: isBuyback ? "待员工确认" : "待确认截图", tone: "amber" });
    }

    return tags;
  }

  function renderWorkbenchSelectCheckbox(input: {
    id: string;
    checkboxFormId: "bulkExercises" | "bulkBuybacks";
    status: string;
    hasPaymentError: boolean;
  }) {
    const { id, checkboxFormId, status, hasPaymentError } = input;
    return (
      <label className="btn-press absolute right-3 top-3 inline-flex touch-manipulation items-center gap-2 rounded-2xl bg-[#f8fafc] px-3 py-2 text-[11px] font-semibold text-zinc-700 active:bg-slate-200">
        <input
          form={checkboxFormId}
          type="checkbox"
          name="ids"
          value={id}
          data-st={status}
          data-perr={hasPaymentError ? "1" : "0"}
          className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
        />
        <span>选择</span>
      </label>
    );
  }

  function renderWorkbenchExerciseActions(input: {
    id: string;
    paymentTxHash: string;
    paymentAmountUsdt: Prisma.Decimal | null;
    status: string;
    hasEmployeeProof: boolean;
  }) {
    const { id, paymentTxHash, paymentAmountUsdt, status, hasEmployeeProof } = input;
    const isFree = Boolean(paymentAmountUsdt && paymentAmountUsdt.lte(0));
    return (
      <div className="mt-3 w-full sm:mt-0 sm:w-auto">
        {status === "COMPLETED" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white opacity-60 sm:w-auto"
          >
            已完成✓
          </button>
        ) : isFree ? (
          <form action={checkExercisePayment} className="contents" data-lock-submit="1">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="returnTo" value={workbenchReturnTo} />
            <button className="btn-press btn-ripple inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white active:scale-[0.98] sm:w-auto">
              直接完成行权
            </button>
          </form>
        ) : paymentTxHash ? (
          <form action={checkExercisePayment} className="contents" data-lock-submit="1">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="returnTo" value={workbenchReturnTo} />
            <button className="btn-press btn-ripple inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white active:scale-[0.98] sm:w-auto">
              检查到账并完成行权
            </button>
          </form>
        ) : hasEmployeeProof ? (
          <form action={completeExerciseByProof} className="contents" data-lock-submit="1">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="returnTo" value={workbenchReturnTo} />
            <button className="btn-press btn-ripple inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white active:scale-[0.98] sm:w-auto">
              确认截图并完成行权
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white opacity-50 sm:w-auto"
          >
            等待凭证
          </button>
        )}
        {status === "COMPLETED" ? null : (
          <div className="mt-2 text-[11px] font-medium text-zinc-500">
            {isFree
              ? "行权成本为 0：可直接完成行权"
              : paymentTxHash
                ? "自动检查链上到账；确认成功后自动完成行权"
                : hasEmployeeProof
                  ? "人工确认截图；确认后完成行权"
                  : "员工未提交 TxHash 或截图"}
            <div className="mt-1">
              <Link
                href={withModal(withParam(withParam(workbenchReturnTo, "pid", id), "back", workbenchReturnTo), "exercise_proof")}
                scroll={false}
                className="text-[#2563eb] underline decoration-[#2563eb]/20 underline-offset-2"
              >
                编辑支付信息
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderWorkbenchBulkForm(formId: "bulkExercises" | "bulkBuybacks", kind: "exercise" | "buyback") {
    return (
      <form id={formId} action={bulkExerciseAction} className="flex items-center gap-2" data-lock-submit="1" data-undo-sec="8">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="returnTo" value={workbenchReturnTo} />
        <button
          type="button"
          data-bulk-select="all"
          data-bulk-form={formId}
          className="btn-press inline-flex h-8 touch-manipulation items-center justify-center rounded-full bg-[#f8fafc] px-3 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
        >
          全选
        </button>
        <button
          type="button"
          data-bulk-select="none"
          data-bulk-form={formId}
          className="btn-press inline-flex h-8 touch-manipulation items-center justify-center rounded-full bg-[#f8fafc] px-3 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
        >
          清空
        </button>
        <div className="hidden items-center gap-1 text-[11px] font-medium text-zinc-500 sm:inline-flex">
          <span>已选</span>
          <span data-bulk-count={formId} className="font-mono tabular-nums text-zinc-900">
            0
          </span>
        </div>
        {!sensitiveReveal ? (
          <Link
            href={withModal(workbenchReturnTo, "reveal_sensitive")}
            scroll={false}
            className="btn-press inline-flex h-8 touch-manipulation items-center justify-center rounded-full bg-[#f8fafc] px-3 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
          >
            显示敏感
          </Link>
        ) : (
          <button
            type="submit"
            form="disableSensitiveRevealForm"
            className="btn-press inline-flex h-8 touch-manipulation items-center justify-center rounded-full bg-[#f8fafc] px-3 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
          >
            隐藏敏感
          </button>
        )}
        {kind === "exercise" ? (
          <details className="relative">
            <summary className="btn-press btn-ripple inline-flex h-8 list-none touch-manipulation items-center justify-center gap-1 rounded-full bg-[#f8fafc] px-3 text-[11px] font-semibold text-zinc-900 active:bg-slate-200">
              批量操作
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
              <button
                type="submit"
                name="op"
                value="check"
                data-bulk-op="check"
                className="block w-full px-3 py-2 text-left text-xs font-medium text-zinc-900 hover:bg-zinc-50"
              >
                批量检查到账并完成行权
              </button>
            </div>
          </details>
        ) : null}
      </form>
    );
  }

  function renderWorkbenchRiskFilterPills(counts: RiskCounts) {
    const items: Array<{
      key: "" | "high" | "warn" | "clean";
      label: string;
      count: number;
      tone: "zinc" | "rose" | "amber" | "emerald";
    }> = [
      { key: "", label: "全部", count: counts.all, tone: "zinc" },
      { key: "high", label: "高风险", count: counts.high, tone: "rose" },
      { key: "warn", label: "需关注", count: counts.warn, tone: "amber" },
      { key: "clean", label: "无异常", count: counts.clean, tone: "emerald" },
    ];

    const selected = items.find((x) => x.key === risk) ?? items[0];
    const visibleItems = items.filter((x) => x.key === "" || x.count > 0 || x.key === risk);

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <details className="relative">
          <summary
            className={`btn-press btn-ripple list-none touch-manipulation rounded-full px-3 py-1.5 text-[11px] font-semibold active:bg-slate-200 ${
              risk ? "bg-[#2563eb]/10 text-[#2563eb]" : "bg-[#f8fafc] text-zinc-900"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <span>风险</span>
              <span className="text-zinc-500">·</span>
              <span>{selected.label}</span>
              <span className="font-mono tabular-nums">{selected.count}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </summary>
          <div className="absolute left-0 z-20 mt-2 w-[360px] max-w-[85vw] overflow-hidden rounded-3xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-xs font-medium text-zinc-900">风险筛选</div>
              {risk ? (
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk: "", tag, ccy: currency, lang, modal })}
                  className="text-[11px] font-semibold text-zinc-600"
                  scroll={false}
                >
                  清除
                </Link>
              ) : null}
            </div>
            <div className="px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                {visibleItems.map((it) => (
                  <Link
                    key={it.key || "all"}
                    href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk: it.key, tag, ccy: currency, lang, modal })}
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                      risk === it.key
                        ? it.tone === "rose"
                          ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                          : it.tone === "amber"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : it.tone === "emerald"
                              ? "border-emerald-200 bg-emerald-50 text-[#059669]"
                              : "border-zinc-300 bg-zinc-100 text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                    scroll={false}
                  >
                    {it.label} <span className="font-mono tabular-nums">{it.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    );
  }

  function renderWorkbenchTagFilterPills(counts: TagCounts) {
    const items: Array<{
      key: "missing_tx" | "proof_pending" | "addr_mismatch" | "diff_1" | "stale" | "check_failed";
      label: string;
      count: number;
      tone: "rose" | "amber";
    }> = [
      { key: "missing_tx", label: "缺TxHash", count: counts.missing_tx, tone: "rose" },
      { key: "proof_pending", label: "待确认截图", count: counts.proof_pending, tone: "amber" },
      { key: "addr_mismatch", label: "地址不匹配", count: counts.addr_mismatch, tone: "rose" },
      { key: "diff_1", label: "偏差>1%", count: counts.diff_1, tone: "rose" },
      { key: "stale", label: "超时", count: counts.stale, tone: "amber" },
      { key: "check_failed", label: "检查失败", count: counts.check_failed, tone: "amber" },
    ];

    const selected = items.find((x) => x.key === tag) ?? null;
    const visibleItems = items.filter((x) => x.count > 0 || x.key === tag);
    const selectedCount = selected ? selected.count : counts.all;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <details className="relative">
          <summary
            className={`btn-press btn-ripple list-none touch-manipulation rounded-full px-3 py-1.5 text-[11px] font-semibold active:bg-slate-200 ${
              tag ? "bg-[#2563eb]/10 text-[#2563eb]" : "bg-[#f8fafc] text-zinc-900"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <span>标签</span>
              <span className="text-zinc-500">·</span>
              <span>{selected ? selected.label : "全部"}</span>
              <span className="font-mono tabular-nums">{selectedCount}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </summary>
          <div className="absolute left-0 z-20 mt-2 w-[360px] max-w-[85vw] overflow-hidden rounded-3xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-xs font-medium text-zinc-900">标签筛选</div>
              {tag ? (
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag: "", ccy: currency, lang, modal })}
                  className="text-[11px] font-semibold text-zinc-600"
                  scroll={false}
                >
                  清除
                </Link>
              ) : null}
            </div>
            <div className="px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag: "", ccy: currency, lang, modal })}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                    !tag
                      ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  scroll={false}
                >
                  全部 <span className="font-mono tabular-nums">{counts.all}</span>
                </Link>
                {visibleItems.length === 0 ? (
                  <span className="text-[11px] text-zinc-500">暂无异常标签</span>
                ) : (
                  visibleItems.map((it) => (
                    <Link
                      key={it.key}
                      href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag: it.key, ccy: currency, lang, modal })}
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                        tag === it.key
                          ? it.tone === "rose"
                            ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      scroll={false}
                    >
                      {it.label} <span className="font-mono tabular-nums">{it.count}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </details>
      </div>
    );
  }

  function renderWorkbenchExerciseItem(r: (typeof pendingExercisesShown)[number]) {
    const avatarText = String(r.employee.name ?? "").trim().slice(0, 1) || "—";
    const proofUrl = String((r as unknown as { paymentProofDataUrl?: unknown } | null)?.paymentProofDataUrl ?? "").trim();
    const proofHas = Boolean(proofUrl);
    const proofViewHref = withModal(withParam(withParam(workbenchReturnTo, "pid", r.id), "back", workbenchReturnTo), "exercise_proof");
    return (
      <div
        key={r.id}
        className="relative rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
      >
        {renderWorkbenchSelectCheckbox({
          id: r.id,
          checkboxFormId: "bulkExercises",
          status: String(r.status ?? ""),
          hasPaymentError: Boolean(r.paymentCheckError),
        })}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3 pr-16">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb]/10 text-sm font-semibold text-[#2563eb]">
                {avatarText}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">{r.employee.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {r.employee.department} · {r.grant?.agreementNo ?? "—"} · {formatDate(r.createdAt, lang)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
              <div className="text-[11px] font-semibold text-zinc-500">申请股数</div>
              <div className="mt-0.5 text-sm font-semibold text-zinc-900">{formatInt(r.requestedShares)}</div>
            </div>
            <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
              <div className="text-[11px] font-semibold text-zinc-500">需支付额</div>
              <div className="ui-sensitive mt-0.5 truncate text-sm font-semibold text-[#059669]">
                {formatMoney(r.totalCost, currency, baseCurrency)}
              </div>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            {(() => {
              const chain = (r.paymentChain ?? "").toString();
              const tx = String(r.paymentTxHash ?? "");
              const explorer =
                chain === "BNB"
                  ? `https://bscscan.com/tx/${tx}`
                  : chain === "TRX"
                    ? `https://tronscan.org/#/transaction/${tx}`
                    : "";
              const toAddr = String(r.paymentToAddress ?? "");
              const addrOut = sensitiveReveal ? toAddr || "—" : maskSensitive(toAddr);
              const hasProof = Boolean(String((r as unknown as { paymentProofDataUrl?: unknown } | null)?.paymentProofDataUrl ?? "").trim());
              if (!tx) return <span className="ui-sensitive font-mono">{chain || "—"} · {addrOut} · {hasProof ? "已上传截图" : "缺 TxHash"}</span>;
              return (
                <span className="ui-sensitive font-mono">
                  {chain || "—"} · {addrOut}
                  {!sensitiveReveal ? (
                    <>
                      {" "}
                      <Link
                        href={withModal(workbenchReturnTo, "reveal_sensitive")}
                        scroll={false}
                        className="ml-1 inline-flex items-center gap-1 rounded-full border border-black/5 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-white"
                        aria-label="解锁敏感信息"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        解锁
                      </Link>
                    </>
                  ) : null}
                  {" · "}
                  {tx && explorer ? (
                    <a
                      href={explorer}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#2563eb] underline decoration-[#2563eb]/20 underline-offset-2"
                      title={sensitiveReveal ? tx : ""}
                    >
                      {tx.slice(0, 10)}…{tx.slice(-8)}
                    </a>
                  ) : (
                    <span title={sensitiveReveal ? tx : ""}>
                      {tx.slice(0, 10)}…{tx.slice(-8)}
                    </span>
                  )}
                </span>
              );
            })()}
          </div>
          {r.paymentCheckedAt ? (
            <div className="mt-1 text-[11px] text-zinc-500">
              上次检查 {formatDate(new Date(r.paymentCheckedAt), lang)}
              {r.paymentCheckError ? ` · ${r.paymentCheckError}` : ""}
            </div>
          ) : null}
          {proofHas ? (
            <div className="mt-2">
              {!sensitiveReveal ? (
                <Link
                  href={withModal(workbenchReturnTo, "reveal_sensitive")}
                  scroll={false}
                  className="group relative block overflow-hidden rounded-xl border border-zinc-200 bg-white"
                  aria-label="解锁后查看转账截图"
                >
                  <img src={proofUrl} alt="转账截图缩略图" className="h-28 w-full object-cover blur-[10px] opacity-70" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full border border-black/10 bg-white/85 px-3 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm backdrop-blur-md">
                      解锁后查看
                    </div>
                  </div>
                </Link>
              ) : (
                <Link
                  href={proofViewHref}
                  scroll={false}
                  className="group relative block overflow-hidden rounded-xl border border-zinc-200 bg-white"
                  aria-label="查看转账截图"
                >
                  <img src={proofUrl} alt="转账截图缩略图" className="h-28 w-full object-cover" />
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="rounded-full border border-black/10 bg-white/85 px-3 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm backdrop-blur-md">
                      点击查看
                    </div>
                  </div>
                </Link>
              )}
            </div>
          ) : null}
          {renderWorkbenchTagPills(buildWorkbenchPaymentTags({ r, includeMissing: true }))}
        </div>
        {renderWorkbenchExerciseActions({
          id: r.id,
          paymentTxHash: String(r.paymentTxHash ?? ""),
          paymentAmountUsdt: (r.paymentAmountUsdt ?? null) as Prisma.Decimal | null,
          status: String(r.status ?? ""),
          hasEmployeeProof: Boolean(String(r.paymentProofDataUrl ?? "").trim()) && String(r.paymentProofUploadedByRole ?? "") === "EMPLOYEE",
        })}
      </div>
    );
  }

  function renderWorkbenchBuybackItem(r: (typeof pendingBuybacksShown)[number]) {
    const avatarText = String(r.employee.name ?? "").trim().slice(0, 1) || "—";
    return (
      <div
        key={r.id}
        className="relative rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
      >
        {renderWorkbenchSelectCheckbox({
          id: r.id,
          checkboxFormId: "bulkBuybacks",
          status: String(r.status ?? ""),
          hasPaymentError: Boolean(r.paymentCheckError),
        })}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3 pr-16">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb]/10 text-sm font-semibold text-[#2563eb]">
                {avatarText}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">{r.employee.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {r.employee.department} · {r.grant?.agreementNo ?? "—"} · {formatDate(r.createdAt, lang)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
              <div className="text-[11px] font-semibold text-zinc-500">回购股数</div>
              <div className="mt-0.5 text-sm font-semibold text-zinc-900">{formatInt(r.requestedShares)}</div>
            </div>
            <div className="rounded-xl bg-[#f8fafc] px-3 py-2">
              <div className="text-[11px] font-semibold text-zinc-500">回购金额</div>
              <div className="ui-sensitive mt-0.5 truncate text-sm font-semibold text-[#059669]">
                {formatMoney(r.totalCost, currency, baseCurrency)}
              </div>
            </div>
          </div>

          {renderWorkbenchTagPills(buildWorkbenchPaymentTags({ r, includeMissing: false }))}
        </div>
        {r.status === "COMPLETED" ? (
          <button
            type="button"
            disabled
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white opacity-60 sm:mt-0 sm:w-auto"
          >
            已完成✓
          </button>
        ) : String(r.paymentProofDataUrl ?? "").trim() ? (
          <div className="mt-3 w-full sm:mt-0 sm:w-auto">
            <button
              type="button"
              disabled
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white opacity-50 sm:w-auto"
            >
              等待员工确认
            </button>
            {sensitiveReveal ? (
              <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <img src={String(r.paymentProofDataUrl)} alt="回购转账截图" className="h-auto w-full object-contain" />
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-medium text-zinc-600">
                已上传回购截图（解锁后可查看）
              </div>
            )}
          </div>
        ) : (
          <form action={uploadBuybackProof} className="mt-3 w-full sm:mt-0 sm:w-auto" data-lock-submit="1">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="returnTo" value={workbenchReturnTo} />
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <input
                type="file"
                name="paymentProof"
                accept="image/*"
                className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 file:mr-3 file:rounded-xl file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-900 sm:w-[260px]"
              />
              <button className="btn-press btn-ripple inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-3 text-xs font-semibold text-white active:scale-[0.98] sm:w-auto">
                上传回购转账截图并通知员工确认
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  function renderPoolWorkbenchSection() {
    if (showAll) return <PoolWorkbenchHomePanels />;
    if (!needPoolFull && !needWorkbenchFull) return null;

    const riskLabel = risk === "high" ? "高风险" : risk === "warn" ? "需关注" : risk === "clean" ? "无异常" : "";
    const tagLabel =
      tag === "missing_tx"
        ? "缺TxHash"
        : tag === "addr_mismatch"
          ? "地址不匹配"
          : tag === "diff_1"
            ? "偏差>1%"
            : tag === "stale"
              ? "超时"
              : tag === "check_failed"
                ? "检查失败"
                : "";
    const workbenchClearHref = adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk: "", tag: "", ccy: currency, lang, modal, view, focus: "workbench" });

    return (
      <div id="pool" className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form id="disableSensitiveRevealForm" action={disableSensitiveReveal} className="hidden" data-lock-submit="1">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="returnTo" value={workbenchReturnTo} />
        </form>
        {needPoolFull ? (
          <>
            <section
              className={`ui-card p-4 sm:p-6 ${
                needWorkbenchFull ? "" : "lg:col-span-3"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-zinc-900">期权池水位</h2>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${poolStatus.cls}`}>
                      {poolStatus.label}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-zinc-500">一眼确认：池是否够用、股价口径是否一致。</p>
                  {totalPool > 0 && remaining <= 0 ? (
                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                      期权池已用尽：无法新增授予。可调整池上限或核对退回/回购记录。
                    </div>
                  ) : totalPool > 0 && remainingPct < 0.1 ? (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      期权池剩余不足 10%：请谨慎授予，避免临近超发导致审批卡住。
                    </div>
                  ) : null}
                </div>
                <OptionPoolDonut pct={pct} leaderboard={grantLeaderboard} />
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-2xl bg-[#f8fafc] p-4">
                  <div className="text-xs text-zinc-500">已占用（净）</div>
                  <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-zinc-900">{formatInt(used)}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    已退回 <span className="font-mono tabular-nums text-zinc-700">{formatInt(forfeited)}</span> · 已回购退回{" "}
                    <span className="font-mono tabular-nums text-zinc-700">{formatInt(buybackReturned)}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-[#f8fafc] p-4">
                  <div className="text-xs text-zinc-500">剩余可用</div>
                  <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-zinc-900">{formatInt(remaining)}</div>
                  {totalPool > 0 ? (
                    <div className="mt-1 text-xs text-zinc-500">
                      占用 <span className="font-mono tabular-nums">{Math.round(pct * 100)}%</span> · 剩余{" "}
                      <span className="font-mono tabular-nums">{Math.round(remainingPct * 100)}%</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-zinc-500">先设置池上限</div>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl bg-[#f8fafc] p-4">
                <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
                  <span>公司股价（口径）</span>
                  {useManualCompanySharePrice ? (
                    <span className="ml-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-[#059669]">
                      手动清算
                    </span>
                  ) : null}
                  <HelpTip text="影响员工侧估值与后台展示口径；不影响行权成本（行权价×股数）。" />
                </div>
                <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-zinc-900">
                  <LiveCompanySharePrice
                    key={`${sharePriceTicker}|${currency}|${baseCurrency}|${companySharePrice.toFixed(6)}`}
                    initialPriceBase={Number(companySharePrice.toFixed(6))}
                    initialBaseCurrency={baseCurrency}
                    displayCurrency={currency}
                    sharePriceTicker={sharePriceTicker}
                  />
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-600">
                  <span>
                    近30日均价{" "}
                    <LiveSharePriceAvg30
                      key={`${sharePriceTicker}|${currency}|${sharePriceAvg30Usd ? sharePriceAvg30Usd.toFixed(6) : ""}`}
                      initialAvg30Usd={sharePriceAvg30Usd ? Number(sharePriceAvg30Usd.toFixed(6)) : null}
                      displayCurrency={currency}
                      sharePriceTicker={sharePriceTicker}
                    />
                  </span>
                  <HelpTip text="按最近 30 个交易日收盘价计算，内部以 USD 口径存储；显示会随币种切换联动。" />
                </div>
                {err === "FETCH_AVG30_FAILED" ? (
                  <div className="mt-1 text-xs text-[#e11d48]">近30日均价抓取失败：稍后重试或更换股票代码。</div>
                ) : null}
                <div className="mt-1 text-xs text-zinc-500">
                  股票代码 {sharePriceTicker ? sharePriceTicker : "—"} · 基准币种 {baseCurrency} · 更新于{" "}
                  {sharePriceUpdatedAt ? formatDateTime(sharePriceUpdatedAt, lang) : "—"}
                </div>
                {isSuperAdmin ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <form action={setSharePriceTickerOnly} className="flex flex-col gap-1" data-lock-submit="1">
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })} />
                      <div className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600">
                        <span>股票代码</span>
                        <HelpTip text="用于抓取实时股价与近30日均价。" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          name="sharePriceTicker"
                          defaultValue={sharePriceTicker}
                          placeholder="如 AAPL / 0700.HK"
                          className="h-10 w-full min-w-[220px] flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                        />
                        <button
                          className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-[#2563eb] px-4 text-sm font-semibold text-white active:scale-[0.98]"
                          data-haptic
                          data-lock-text="设置中…"
                        >
                          设置股票代码
                        </button>
                      </div>
                    </form>

                    <form action={setCompanyNameOnly} className="flex flex-col gap-1" data-lock-submit="1">
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })} />
                      <div className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600">
                        <span>公司名称（印章）</span>
                        <HelpTip text="显示在员工端“电子权证预览”的公司印章处。" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          name="companyName"
                          defaultValue={companyName}
                          placeholder="例如：XX科技有限公司"
                          className="h-10 w-full min-w-[220px] flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                        />
                        <button
                          className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white active:scale-[0.98]"
                          data-haptic
                          data-lock-text="保存中…"
                        >
                          保存公司名称
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
                {isSuperAdmin ? (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    股价会自动更新：美股开盘约 15 秒/次；非开盘约 1 小时/次。
                  </div>
                ) : null}
              </div>

              {isSuperAdmin ? (
                modal === "settings_edit" ? (
                  <form action={upsertSettings} className="mt-6 grid grid-cols-1 gap-3">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="sharePriceTicker" value={sharePriceTicker} />
                    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs leading-5 text-zinc-600">
                      <div className="font-medium text-zinc-900">口径说明</div>
                      <div className="mt-1">
                        股价用于估值展示；不影响行权成本（行权价 × 股数）。期权池上限用于计算已授予/剩余。
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="inline-flex items-center gap-1 text-xs font-medium text-zinc-900">
                        <span>公司名称（用于印章）</span>
                        <HelpTip text="显示在员工端“电子权证预览”的公司印章处。" />
                      </div>
                      <input
                        name="companyName"
                        defaultValue={companyName}
                        placeholder="例如：XX科技有限公司"
                        className="mt-3 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                      />
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="text-xs font-medium text-zinc-600">抓取结果</div>
                      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                          <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
                            <span>当前公司股价</span>
                            <HelpTip text="抓取的实时每股价格（基准币种口径），用于员工侧浮盈估算。" />
                          </div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">
                            <LiveCompanySharePrice
                              key={`${sharePriceTicker}|${currency}|${baseCurrency}|${companySharePrice.toFixed(6)}`}
                              initialPriceBase={Number(companySharePrice.toFixed(6))}
                              initialBaseCurrency={baseCurrency}
                              displayCurrency={currency}
                              sharePriceTicker={sharePriceTicker}
                            />
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                          <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
                            <span>近30日均价</span>
                            <HelpTip text="按最近 30 个交易日收盘价计算，内部以 USD 口径存储；显示会随币种切换联动。" />
                          </div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">
                          <LiveSharePriceAvg30
                            key={`${sharePriceTicker}|${currency}|${sharePriceAvg30Usd ? sharePriceAvg30Usd.toFixed(6) : ""}`}
                            initialAvg30Usd={sharePriceAvg30Usd ? Number(sharePriceAvg30Usd.toFixed(6)) : null}
                            displayCurrency={currency}
                            sharePriceTicker={sharePriceTicker}
                          />
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                          <div className="text-xs text-zinc-500">基准币种</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{baseCurrency}</div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="inline-flex items-center gap-1 text-xs font-medium text-zinc-900">
                        <span>手动校准（清算股价）</span>
                        <HelpTip text="用于财务最终口径：开启后，员工侧与后台展示的“当前公司股价”将以手动校准值为准；关闭则使用实时抓取值。" />
                      </div>
                      <div className="mt-3 flex flex-col gap-3">
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            name="useManualCompanySharePrice"
                            type="checkbox"
                            defaultChecked={useManualCompanySharePrice}
                            className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
                          />
                          <span>启用手动清算股价</span>
                        </label>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-2">
                            <span className="text-xs font-medium text-zinc-600">清算股价（{baseCurrency}）</span>
                            <input
                              name="manualCompanySharePrice"
                              type="number"
                              step="0.000001"
                              defaultValue={manualCompanySharePrice ? Number(manualCompanySharePrice.toFixed(6)) : ""}
                              placeholder="7.350000"
                              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                            />
                          </label>
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
                            <div>当前口径：{useManualCompanySharePrice ? "手动清算" : "实时抓取"}</div>
                            <div className="mt-1">更新时间：{sharePriceUpdatedAt ? formatDateTime(sharePriceUpdatedAt, lang) : "—"}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                          <span>期权池总股数</span>
                          <HelpTip text="公司预留的期权池上限；授予与审批会以此强校验防超发。" />
                        </span>
                        <input
                          name="totalOptionPoolShares"
                          type="number"
                          defaultValue={totalPool}
                          className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                          <span>离职后期权过期（天）</span>
                          <HelpTip text="员工离职后未行权期权的过期天数；用于台账倒计时展示与到期判断。" />
                        </span>
                        <input
                          name="terminationOptionExpiryDays"
                          type="number"
                          min={0}
                          defaultValue={settings?.terminationOptionExpiryDays ?? 90}
                          className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                        />
                      </label>
                    </div>
                    <details className="rounded-xl border border-zinc-200 bg-white p-4">
                      <summary className="cursor-pointer text-xs font-medium text-zinc-900">更多设置（USDT 地址 / Logo）</summary>
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          <div className="text-xs font-medium text-zinc-900">USDT 收款地址</div>
                          <div className="mt-1 text-xs text-zinc-500">员工端行权打款使用（BNB/TRX）。</div>
                          <div className="mt-3 flex flex-col gap-3">
                            <label className="flex flex-col gap-2">
                              <span className="text-xs font-medium text-zinc-600">BNB 链 USDT 地址</span>
                              <input
                                name="usdtBnbAddress"
                                defaultValue={settings?.usdtBnbAddress ?? ""}
                                placeholder="0x..."
                                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xs font-medium text-zinc-600">TRX 链 USDT 地址</span>
                              <input
                                name="usdtTrxAddress"
                                defaultValue={settings?.usdtTrxAddress ?? ""}
                                placeholder="T..."
                                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                              />
                            </label>
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          <div className="text-xs font-medium text-zinc-900">Logo</div>
                          <div className="mt-1 text-xs text-zinc-500">显示在左上角标题旁（PNG/JPG/SVG，≤256KB）。</div>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white">
                              {brandLogoDataUrl ? (
                                <Image src={brandLogoDataUrl} alt="Logo preview" width={40} height={40} unoptimized />
                              ) : (
                                <div className="text-sm font-semibold text-zinc-700">E</div>
                              )}
                            </div>
                            <input
                              name="brandLogo"
                              type="file"
                              accept="image/*"
                              className="block w-72 text-xs text-zinc-600 file:mr-3 file:rounded-xl file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-zinc-800 hover:file:bg-zinc-50"
                            />
                          </div>
                          {err === "INVALID_LOGO_TYPE" || err === "LOGO_TOO_LARGE" || err === "INVALID_LOGO" ? (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                              {err === "LOGO_TOO_LARGE"
                                ? "图片太大，请压缩到 256KB 以内。"
                                : err === "INVALID_LOGO_TYPE"
                                  ? "文件类型不支持，请上传图片。"
                                  : "Logo 上传失败，请重试。"}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </details>
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 active:scale-[0.98] hover:bg-zinc-50">
                        保存全局变量
                      </button>
                      <Link
                        href={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                        scroll={false}
                      >
                        取消
                      </Link>
                    </div>
                  </form>
                ) : (
                  <div className="mt-6 grid grid-cols-1 gap-3">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs leading-5 text-zinc-600">
                      <div className="font-medium text-zinc-900">口径说明</div>
                      <div className="mt-1">
                        股价用于估值展示；不影响行权成本（行权价 × 股数）。期权池上限用于计算已授予/剩余。
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="flex flex-col gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                          <span>股票代码</span>
                          <HelpTip text="用于抓取实时股价与近30日均价；系统会尝试识别对应币种口径。" />
                        </span>
                        <input
                          value={sharePriceTicker}
                          disabled
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                          <span>期权池总股数</span>
                          <HelpTip text="公司预留的期权池上限；授予与审批会以此强校验防超发。" />
                        </span>
                        <input
                          type="number"
                          value={totalPool}
                          disabled
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                          <span>离职后期权过期（天）</span>
                          <HelpTip text="员工离职后未行权期权的过期天数；用于台账倒计时展示与到期判断。" />
                        </span>
                        <input
                          type="number"
                          value={settings?.terminationOptionExpiryDays ?? 90}
                          disabled
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </label>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium text-zinc-900">USDT 收款地址</div>
                      <div className="mt-1 text-xs text-zinc-500">员工端行权打款使用（BNB/TRX）。</div>
                      <div className="mt-3 flex flex-col gap-3">
                        <label className="flex flex-col gap-2">
                          <span className="text-xs font-medium text-zinc-600">BNB 链 USDT 地址</span>
                          <input
                            value={settings?.usdtBnbAddress ?? ""}
                            disabled
                            className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs font-medium text-zinc-600">TRX 链 USDT 地址</span>
                          <input
                            value={settings?.usdtTrxAddress ?? ""}
                            disabled
                            className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                          />
                        </label>
                      </div>
                    </div>
                    <Link
                      href={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "settings_edit" })}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                      scroll={false}
                    >
                      修改
                    </Link>
                  </div>
                )
              ) : isFinance ? (
                <div className="mt-6 grid grid-cols-1 gap-3">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs leading-5 text-zinc-600">
                    <div className="font-medium text-zinc-900">全局变量（只读）</div>
                    <div className="mt-1">用于对账：核对股价、池上限、过期天数与 USDT 地址。</div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-zinc-600">股票代码</span>
                      <input
                        value={sharePriceTicker}
                        disabled
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-zinc-600">期权池总股数</span>
                      <input
                        type="number"
                        value={totalPool}
                        disabled
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-zinc-600">离职后期权过期（天）</span>
                      <input
                        type="number"
                        value={settings?.terminationOptionExpiryDays ?? 90}
                        disabled
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                      />
                    </label>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <div className="text-xs font-medium text-zinc-900">USDT 收款地址</div>
                    <div className="mt-1 text-xs text-zinc-500">员工端行权打款使用（BNB/TRX）。</div>
                    <div className="mt-3 flex flex-col gap-3">
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-zinc-600">BNB 链 USDT 地址</span>
                        <input
                          value={settings?.usdtBnbAddress ?? ""}
                          disabled
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-zinc-600">TRX 链 USDT 地址</span>
                        <input
                          value={settings?.usdtTrxAddress ?? ""}
                          disabled
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {needWorkbenchFull ? (
          <section
            id="workbench"
            className={`ui-card p-4 md:p-6 ${
              needPoolFull ? "lg:col-span-2" : "lg:col-span-3"
            }`}
          >
            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-medium text-zinc-900">审批工作台</h2>
                <p className="text-xs leading-5 text-zinc-500">行权申请与离职回购（仅总管理员可处理；点击“检查到账并完成行权”即可完成处理）</p>
              </div>
              {(risk || tag) && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {riskLabel ? (
                    <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-[11px] font-semibold text-[#2563eb]">
                      风险：{riskLabel}
                    </span>
                  ) : null}
                  {tagLabel ? (
                    <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-[11px] font-semibold text-[#2563eb]">
                      标签：{tagLabel}
                    </span>
                  ) : null}
                  <Link
                    href={workbenchClearHref}
                    className="btn-press inline-flex touch-manipulation items-center rounded-full bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
                    scroll={false}
                    data-haptic
                  >
                    清除筛选
                  </Link>
                </div>
              )}
            </div>

            <form method="get" action="/admin" className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="hidden" name="focus" value="workbench" />
              {currency && currency !== "USD" ? <input type="hidden" name="ccy" value={currency} /> : null}
              {lang && lang !== "zh-CN" ? <input type="hidden" name="lang" value={lang} /> : null}
              {risk ? <input type="hidden" name="risk" value={risk} /> : null}
              {tag ? <input type="hidden" name="tag" value={tag} /> : null}
              <input
                name="q"
                defaultValue={q}
                placeholder="搜索姓名 / 部门 / 协议号"
                className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 sm:flex-1"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  data-haptic
                  className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-4 text-sm font-semibold text-white active:scale-[0.98]"
                >
                  搜索
                </button>
                {q ? (
                  <Link
                    href={adminHref({ dept, q: "", st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal, view, focus: "workbench" })}
                    className="btn-press inline-flex h-10 touch-manipulation items-center justify-center rounded-2xl bg-[#f8fafc] px-4 text-sm font-semibold text-zinc-700 active:bg-slate-200"
                    scroll={false}
                    data-haptic
                  >
                    清空
                  </Link>
                ) : null}
              </div>
            </form>

            {pendingExercises.length === 0 && pendingBuybacks.length === 0 ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-6">
                <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="mt-3 text-sm font-medium text-zinc-900">
                    {tr("太棒了！暂无待办", "太棒了！暫無待辦", "All clear!")}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {tr("当前没有待处理的申请，期权池运行良好。", "目前沒有待處理的申請，期權池運行良好。", "No pending requests right now.")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-3xl bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50 md:shadow-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                      <span>待处理 · 行权申请</span>
                      {pendingExerciseProofCount > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          截图待确认 {pendingExerciseProofCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {renderWorkbenchBulkForm("bulkExercises", "exercise")}
                      <div className="text-xs text-zinc-500">
                        {pendingExercisesShown.length}/{pendingExercises.length}
                      </div>
                    </div>
                  </div>
                  {renderWorkbenchRiskFilterPills(exerciseRiskCounts)}
                  {renderWorkbenchTagFilterPills(exerciseTagCounts)}
                  <div className="mt-2 flex flex-col gap-2">
                    {pendingExercisesShown.length === 0 ? (
                      <div className="text-sm text-zinc-500">暂无待处理</div>
                    ) : (
                      pendingExercisesShown.map(renderWorkbenchExerciseItem)
                    )}
                  </div>
                </div>

                <div className="rounded-3xl bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50 md:shadow-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                      <span>待处理 · 离职回购</span>
                      {pendingBuybackConfirmCount > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          待员工确认 {pendingBuybackConfirmCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {renderWorkbenchBulkForm("bulkBuybacks", "buyback")}
                      <div className="text-xs text-zinc-500">
                        {pendingBuybacksShown.length}/{pendingBuybacks.length} · 高{buybackRiskCounts.high} · 关{buybackRiskCounts.warn}
                      </div>
                    </div>
                  </div>
                  {renderWorkbenchTagFilterPills(buybackTagCounts)}
                  <div className="mt-2 flex flex-col gap-2">
                    {pendingBuybacksShown.length === 0 ? (
                      <div className="text-sm text-zinc-500">暂无待处理</div>
                    ) : (
                      pendingBuybacksShown.map(renderWorkbenchBuybackItem)
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>
    );
  }

  function renderOpsSection() {
    return showAll ? (
    <OpsHomePanel />
    ) : focus === "ops" ? (
      <section
        id="ops"
        className="ui-card mt-6 p-4 sm:p-6"
      >
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-900">运营操作</h2>
          <p className="text-xs leading-5 text-zinc-500">
            创建员工与授予申请；审批通过后自动生成成熟明细。
          </p>
          <p className="text-xs leading-5 text-zinc-600">先建员工，再发起授予。</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-zinc-600">新增员工</div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-zinc-500">常用</span>
              <Link
                href={adminHref({
                  dept,
                  q,
                  st: status,
                  edit,
                  ccy: currency,
                  lang,
                  modal: "dept_create",
                  deptEdit: "",
                  deptDelete: "",
                })}
                className="font-medium text-zinc-600 hover:text-zinc-900"
                scroll={false}
              >
                管理部门
              </Link>
            </div>
          </div>
          <form action={createEmployee} className="mt-4 grid grid-cols-1 gap-3">
            <input type="hidden" name="lang" value={lang} />
            <input
              type="hidden"
              name="returnTo"
              value={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" })}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-2">
                <div className="flex h-6 items-center text-xs text-zinc-500">姓名</div>
                <input
                  name="name"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder="张三"
                />
              </label>
              <label className="flex flex-col gap-2">
                <div className="relative flex h-6 items-center justify-between text-xs text-zinc-500">
                  <span>部门</span>
                  <Link
                    href={adminHref({
                      dept,
                      q,
                      st: status,
                      edit,
                      ccy: currency,
                      lang,
                      modal: "dept_create",
                      deptEdit: "",
                      deptDelete: "",
                    })}
                    className="btn-press inline-flex h-6 w-6 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                    scroll={false}
                  >
                    +
                  </Link>
                </div>
                <select
                  name="department"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  defaultValue=""
                  disabled={departments.length === 0}
                >
                  <option value="" disabled>
                    {departments.length === 0 ? "先创建部门" : "请选择…"}
                  </option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <div className="flex h-6 items-center text-xs text-zinc-500">角色</div>
                <select
                  name="role"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  defaultValue="EMPLOYEE"
                >
                  <option value="EMPLOYEE">员工</option>
                  <option value="FINANCE">财务</option>
                  <option value="SUPER_ADMIN">管理员</option>
                </select>
              </label>
            </div>
            {departments.length === 0 ? (
              <div className="text-xs leading-5 text-zinc-500">
                先创建部门，再创建员工。
              </div>
            ) : null}
            <label className="flex flex-col gap-2">
              <span className="text-xs text-zinc-500">入职日期</span>
              <input
                name="startDate"
                type="date"
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
              />
            </label>
            <div className="mt-1 text-xs font-medium text-zinc-600">账号（登录名）</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-2">
                <span className="text-xs text-zinc-500">账号（创建登录时必填）</span>
                <input
                  name="account"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder="alice"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-zinc-500">邮箱（选填）</span>
                <input
                  name="email"
                  type="email"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder="alice@company.com"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-zinc-500">初始密码</span>
                <input
                  name="initialPassword"
                  type="password"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder="至少 8 位"
                />
              </label>
            </div>
            <div className="text-xs leading-5 text-zinc-500">
              员工可不填账号；创建登录时账号必填、邮箱选填。管理员/财务必须填写账号与初始密码。
            </div>
            <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
              创建
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-zinc-600">发起授予</div>
            <div className="text-xs text-zinc-500">常用</div>
          </div>
          <form action={createGrant} className="mt-4 grid grid-cols-1 gap-3">
            <input type="hidden" name="lang" value={lang} />
            <input
              type="hidden"
              name="returnTo"
              value={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" })}
            />
            <label className="flex flex-col gap-2">
              <span className="text-xs text-zinc-500">关联员工</span>
              <EmployeePicker
                employees={opsEmployees.map((e) => ({
                  id: e.id,
                  name: e.name,
                  department: e.department,
                  status: e.status === "ACTIVE" ? "ACTIVE" : "TERMINATED",
                }))}
                defaultEmployeeId={opsEmployees[0]?.id ?? ""}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-xs text-zinc-500">授予日期</span>
                <input
                  name="grantDate"
                  type="date"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  required
                />
              </label>
            </div>
            <div className="text-xs leading-5 text-zinc-500">
              协议编号由系统按年份自动顺序生成（GRANT-YYYY-001 起）。
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                  <span>授予总股数</span>
                  <HelpTip text="本次授予的期权数量；会占用期权池剩余额度，并用于生成成熟明细。" />
                </span>
                <GrantSharesValueInput
                  name="totalShares"
                  min={1}
                  currency={currency}
                  companySharePriceUsd={Number(companySharePriceUsd.toFixed(6))}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                    placeholder="10000"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                  <span>行权价</span>
                  <HelpTip text="员工行权购买股票的每股价格；用于计算行权成本与浮盈（浮盈不影响行权成本）。" />
                </span>
                <StrikePriceDiscountInput
                  name="strikePrice"
                  min={0}
                  step="0.01"
                  companySharePriceBase={Number(companySharePrice.toFixed(6))}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder={`${Number(companySharePrice.toFixed(2))}`}
                />
              </label>
            </div>

            <VestingConfigurator />

            <label className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
                <span>行权后锁定期（月）</span>
                <HelpTip text="行权完成后股份的冻结期（月）；可填 0 表示无锁定期。" />
              </span>
              <input
                name="lockup_period_months"
                type="number"
                min={0}
                step={1}
                placeholder="0（无锁定期）"
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                required
              />
            </label>

                <button
                  className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-indigo-700 disabled:opacity-40"
              disabled={opsEmployees.length === 0}
            >
              {isSuperAdmin ? "保存并生效（生成成熟明细）" : "提交授予审批"}
            </button>
            {opsEmployees.length === 0 ? (
              <div className="text-xs text-zinc-500">先创建员工</div>
            ) : null}
          </form>
        </div>
      </div>

      {modal === "dept_create" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <Link
            href={adminHref({
              dept,
              q,
              st: status,
              edit,
              ccy: currency,
              lang,
              modal: "",
              deptEdit: "",
              deptDelete: "",
            })}
            className="absolute inset-0 bg-black/30 ui-overlay-in"
            aria-label="关闭"
            scroll={false}
          >
            <span className="sr-only">关闭</span>
          </Link>
          <div className="relative z-10 w-full max-w-[420px] max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl ui-modal-in">
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
              <div className="text-sm font-semibold text-zinc-900">创建部门</div>
              <Link
                href={adminHref({
                  dept,
                  q,
                  st: status,
                  edit,
                  ccy: currency,
                  lang,
                  modal: "",
                  deptEdit: "",
                  deptDelete: "",
                })}
                className="btn-press btn-ripple rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                scroll={false}
              >
                关闭
              </Link>
            </div>
            <div className="px-5 py-4">
              <form action={createDepartment} className="flex items-center gap-2">
                <input type="hidden" name="lang" value={lang} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={adminHref({
                    dept,
                    q,
                    st: status,
                    edit,
                    ccy: currency,
                    lang,
                    modal: "dept_create",
                    deptEdit: deptEditId,
                    deptDelete: deptDeleteId,
                  })}
                />
                <input
                  name="departmentName"
                  className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  placeholder="研发 / Engineering"
                  required
                  autoFocus
                />
                <button className="btn-press btn-ripple h-10 touch-manipulation rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                  创建
                </button>
              </form>

              {err && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                  {err === "DEPARTMENT_IN_USE"
                    ? "删除失败：该部门下已有员工"
                    : err === "DUPLICATE_DEPARTMENT"
                      ? "修改失败：部门名称已存在"
                      : err === "RENAME_DEPARTMENT_FAILED"
                        ? "修改失败：请稍后再试"
                        : err === "DELETE_DEPARTMENT_FAILED"
                          ? "删除失败：请稍后再试"
                          : err === "CREATE_DEPARTMENT_FAILED"
                            ? "创建失败：请检查名称是否重复"
                            : err === "INVALID_DEPARTMENT"
                              ? "操作失败：部门名称无效"
                              : `操作失败：${err}`}
                </div>
              )}

              <div className="mt-4 border-t border-zinc-200 pt-3">
                <div className="text-xs font-medium text-zinc-900">已创建的部门</div>
                {departmentsDb.length === 0 ? (
                  <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                    暂无部门
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {departmentsDb.map((d) => {
                      const isEditing = deptEditId === d.id;
                      const isDeleting = deptDeleteId === d.id;
                      if (isEditing) {
                        return (
                          <form
                            key={d.id}
                            action={renameDepartment}
                            className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                          >
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="departmentId" value={d.id} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={adminHref({
                                dept,
                                q,
                                st: status,
                                edit,
                                ccy: currency,
                                lang,
                                modal: "dept_create",
                                deptEdit: d.id,
                                deptDelete: "",
                              })}
                            />
                            <input
                              name="newDepartmentName"
                              defaultValue={d.name}
                              className="h-9 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                              required
                              autoFocus
                            />
                            <button className="btn-press btn-ripple h-9 touch-manipulation rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 active:scale-[0.98] hover:bg-zinc-50">
                              保存
                            </button>
                            <Link
                              href={adminHref({
                                dept,
                                q,
                                st: status,
                                edit,
                                ccy: currency,
                                lang,
                                modal: "dept_create",
                                deptEdit: "",
                                deptDelete: "",
                              })}
                              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                              scroll={false}
                            >
                              取消
                            </Link>
                          </form>
                        );
                      }
                      if (isDeleting) {
                        return (
                          <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                            <div className="min-w-0 text-sm text-zinc-900">{d.name}</div>
                            <div className="flex items-center gap-2">
                              <form action={deleteDepartment}>
                                <input type="hidden" name="lang" value={lang} />
                                <input type="hidden" name="departmentId" value={d.id} />
                                <input
                                  type="hidden"
                                  name="returnTo"
                                  value={adminHref({
                                    dept,
                                    q,
                                    st: status,
                                    edit,
                                    ccy: currency,
                                    lang,
                                    modal: "dept_create",
                                    deptEdit: "",
                                    deptDelete: "",
                                  })}
                                />
                                <button className="btn-press btn-ripple h-8 touch-manipulation rounded-xl bg-zinc-900 px-3 text-xs font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                                  确认删除
                                </button>
                              </form>
                              <Link
                                href={adminHref({
                                  dept,
                                  q,
                                  st: status,
                                  edit,
                                  ccy: currency,
                                  lang,
                                  modal: "dept_create",
                                  deptEdit: "",
                                  deptDelete: "",
                                })}
                                className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                                scroll={false}
                              >
                                取消
                              </Link>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                          <div className="min-w-0 text-sm text-zinc-900">{d.name}</div>
                          <div className="flex items-center gap-2">
                            <Link
                              href={adminHref({
                                dept,
                                q,
                                st: status,
                                edit,
                                ccy: currency,
                                lang,
                                modal: "dept_create",
                                deptEdit: d.id,
                                deptDelete: "",
                              })}
                              className="btn-press inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                              scroll={false}
                            >
                              <PencilLine width={14} height={14} strokeWidth={1.5} />
                              编辑
                            </Link>
                            <Link
                              href={adminHref({
                                dept,
                                q,
                                st: status,
                                edit,
                                ccy: currency,
                                lang,
                                modal: "dept_create",
                                deptEdit: "",
                                deptDelete: d.id,
                              })}
                              className="btn-press inline-flex items-center gap-1.5 text-xs font-semibold text-[#e11d48] hover:text-[#e11d48]"
                              scroll={false}
                            >
                              <Trash2 width={14} height={14} strokeWidth={1.5} />
                              删除
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isSuperAdmin ? (
        <details className="mt-6 rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50 md:p-5 md:shadow-none">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
            高级操作（不常用）
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="text-xs font-medium text-zinc-900">刷新成熟状态</div>
                  <div className="text-xs leading-5 text-zinc-500">用于手动触发成熟计算（一般情况下系统会自动运行）。</div>
                </div>
                <form action={runVestingNow} className="shrink-0">
                  <input type="hidden" name="lang" value={lang} />
                  <button className="btn-press btn-ripple inline-flex h-10 min-w-[96px] touch-manipulation items-center justify-center whitespace-nowrap rounded-2xl bg-[#2563eb] px-4 text-xs font-semibold text-white active:scale-[0.98]" data-haptic>
                    立即刷新
                  </button>
                </form>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:shadow-none">
              <div className="text-xs font-medium text-zinc-900">重置账号密码（账号/邮箱）</div>
              <div className="mt-1 text-xs text-zinc-500">重置后该账号会被强制退出登录。</div>
              <form action={resetUserPasswordByEmail} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, ccy: currency, lang })} />
                <input
                  name="email"
                  placeholder="账号 或 someone@company.com"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300 md:col-span-2"
                  required
                />
                <input
                  name="newPassword"
                  type="password"
                  minLength={8}
                  placeholder="新密码（至少 8 位）"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                  required
                />
                <div className="flex items-center gap-2 md:col-span-2">
                  <input
                    name="confirmPassword"
                    type="password"
                    minLength={8}
                    placeholder="确认"
                    className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                    required
                  />
                  <button className="btn-press btn-ripple h-10 min-w-[96px] shrink-0 touch-manipulation whitespace-nowrap rounded-2xl bg-[#2563eb] px-4 text-sm font-semibold text-white active:scale-[0.98]" data-haptic>
                    确认重置
                  </button>
                </div>
              </form>
            </div>

            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:shadow-none">
              <div className="text-xs font-medium text-[#e11d48]">清空测试数据（危险）</div>
              <div className="mt-1 text-xs leading-5 text-rose-700">
                保留账号：<span className="font-mono">admin</span>、<span className="font-mono">finance</span>、<span className="font-mono">evan</span>；清空其余员工、授予、成熟、行权、审批、部门、股价历史等数据。
              </div>
              <form action={purgeNonAdminData} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, ccy: currency, lang })} />
                <input
                  name="confirm"
                  placeholder="输入 PURGE 以确认"
                  className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-rose-300 md:col-span-3"
                  required
                />
                <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center whitespace-nowrap rounded-2xl bg-[#e11d48] px-4 text-sm font-semibold text-white active:scale-[0.98] md:col-span-3" data-haptic>
                  确认清空
                </button>
              </form>
            </div>
          </div>
        </details>
      ) : null}
    </section>
    ) : null;
  }

  function renderLedgerSection() {
    if (!(showAll || focus === "ledger")) return null;
    const hasLedgerFilters = Boolean(dept || q || status);
    const pageSize = 20;
    const total = ledgerEmployeesTotal;
    const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    const page = Math.min(ledgerPage, totalPages);
    const offset = Math.max(0, page - 1) * pageSize;
    const exportHref = `/api/admin/ledger/export?${new URLSearchParams(
      Object.entries({
        dept: dept || undefined,
        st: status || undefined,
        q: q || undefined,
        ccy: currency !== "USD" ? currency : undefined,
      }).filter(([, v]) => Boolean(v)) as Array<[string, string]>,
    ).toString()}`;
    return (
      <>
      <section
        id="ledger"
        className="ui-card mt-6 p-4 sm:p-6"
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-900">
            员工期权台账总览
          </h2>
          <p className="text-xs leading-5 text-zinc-500">
            支持按部门/状态筛选与搜索；可编辑员工信息与状态。
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <a
              href={exportHref}
              className="btn-press btn-ripple inline-flex h-9 touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white"
            >
              导出 Excel
            </a>
          </div>
          {hasLedgerFilters ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {dept ? (
                <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-[11px] font-semibold text-[#2563eb]">
                  部门：{dept}
                </span>
              ) : null}
              {status ? (
                <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-[11px] font-semibold text-[#2563eb]">
                  状态：{status === "ACTIVE" ? "在职" : status === "TERMINATED" ? "离职" : status}
                </span>
              ) : null}
              {q ? (
                <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-[11px] font-semibold text-[#2563eb]">
                  搜索：{q}
                </span>
              ) : null}
              <Link
                href={adminHref({ dept: "", q: "", st: "", lp: 1, ccy: currency, lang, focus: "ledger" })}
                className="btn-press inline-flex touch-manipulation items-center rounded-full bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold text-zinc-700 active:bg-slate-200"
                scroll={false}
                data-haptic
              >
                清除筛选
              </Link>
            </div>
          ) : null}
        </div>

        {showAll ? (
          <LedgerHomePanels />
        ) : (
          <>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-[#f8fafc] p-4 md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50">
            <div className="text-xs text-zinc-500">当前列表</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">
              {total}
              <span className="ml-2 text-xs font-medium text-zinc-500">本页 {ledgerEmployees.length}</span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">每页最多 {pageSize} 人</div>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] p-4 md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50">
            <div className="text-xs text-zinc-500">已授予（合计）</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{formatInt(ledgerListGrantedShares)}</div>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] p-4 md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50">
            <div className="text-xs text-zinc-500">已成熟（合计）</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{formatInt(ledgerListVestedShares)}</div>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] p-4 md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50">
            <div className="text-xs text-zinc-500">已行权（合计）</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{formatInt(ledgerListExercisedShares)}</div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={adminHref({ lp: 1 })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                !dept && !q && !status
                  ? "bg-[#2563eb]/10 text-[#2563eb]"
                  : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
              }`}
              scroll={false}
            >
              全部
            </Link>
            <Link
              href={adminHref({ dept, q, st: "ACTIVE", lp: 1 })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                status === "ACTIVE"
                  ? "bg-[#2563eb]/10 text-[#2563eb]"
                  : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
              }`}
              scroll={false}
            >
              在职
            </Link>
            <Link
              href={adminHref({ dept, q, st: "TERMINATED", lp: 1 })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                status === "TERMINATED"
                  ? "bg-[#2563eb]/10 text-[#2563eb]"
                  : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
              }`}
              scroll={false}
            >
              离职
            </Link>
            {departments.map((d) => (
              <Link
                key={d}
                href={adminHref({ dept: d, q, st: status, lp: 1 })}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  dept === d
                    ? "bg-[#2563eb]/10 text-[#2563eb]"
                    : "bg-[#f8fafc] text-zinc-700 active:bg-slate-200 md:hover:bg-zinc-50"
                }`}
                scroll={false}
              >
                {d}
              </Link>
            ))}
          </div>

          <form action="/admin" method="get" className="mt-3 hidden md:flex flex-wrap items-center gap-2">
            {dept ? <input type="hidden" name="dept" value={dept} /> : null}
            {status ? <input type="hidden" name="st" value={status} /> : null}
            <input type="hidden" name="lp" value="1" />
            {currency !== "USD" ? <input type="hidden" name="ccy" value={currency} /> : null}
            {lang !== "zh-CN" ? <input type="hidden" name="lang" value={lang} /> : null}
            <DebouncedSearch
              defaultValue={q}
              className="h-9 w-full min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300 md:min-w-[240px]"
              placeholder="按姓名/部门搜索"
            />
            {hasLedgerFilters ? (
              <Link
                href={adminHref({ dept: "", q: "", st: "", lp: 1 })}
                className="h-9 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                scroll={false}
              >
                清空
              </Link>
            ) : null}
          </form>
        </div>

        {editingEmployee ? (
          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium text-zinc-600">编辑员工</div>
                <div className="text-sm font-semibold text-zinc-900">
                  {editingEmployee.name}
                </div>
              </div>
              <Link
                href={adminHref({ dept, q, st: status, ccy: currency })}
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
                scroll={false}
              >
                关闭
              </Link>
            </div>
            <form
              action={isSuperAdmin ? updateEmployeeDirect : submitEmployeeUpdateRequest}
              className="mt-4 grid grid-cols-1 gap-3"
            >
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="employeeId" value={editingEmployee.id} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-500">姓名</span>
                  <input
                    name="name"
                    defaultValue={editingEmployee.name}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="relative flex items-center justify-between text-xs text-zinc-500">
                    <span>部门</span>
                    <Link
                      href={adminHref({
                        dept,
                        q,
                        st: status,
                        edit,
                        ccy: currency,
                        lang,
                        modal: "dept_edit",
                        deptEdit: "",
                        deptDelete: "",
                      })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                      scroll={false}
                    >
                      +
                    </Link>
                    {modal === "dept_edit" ? (
                      <div className="absolute right-0 top-7 z-20 w-[min(92vw,360px)] rounded-xl border border-zinc-200 bg-white p-4 shadow-xl">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium text-zinc-900">创建部门</div>
                          <Link
                            href={adminHref({
                              dept,
                              q,
                              st: status,
                              edit,
                              ccy: currency,
                              lang,
                              modal: "",
                              deptEdit: "",
                              deptDelete: "",
                            })}
                            className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                            scroll={false}
                          >
                            关闭
                          </Link>
                        </div>
                        <form action={createDepartment} className="mt-3 flex items-center gap-2">
                          <input type="hidden" name="lang" value={lang} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={adminHref({
                              dept,
                              q,
                              st: status,
                              edit,
                              ccy: currency,
                              lang,
                              modal: "dept_edit",
                              deptEdit: deptEditId,
                              deptDelete: deptDeleteId,
                            })}
                          />
                          <input
                            name="departmentName"
                            className="h-9 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                            placeholder="研发 / Engineering"
                            required
                            autoFocus
                          />
                          <button className="btn-press btn-ripple h-9 touch-manipulation rounded-xl bg-zinc-900 px-3 text-xs font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                            创建
                          </button>
                        </form>
                        {err && (
                          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                            {err === "DEPARTMENT_IN_USE"
                              ? "删除失败：该部门下已有员工"
                              : err === "DUPLICATE_DEPARTMENT"
                                ? "修改失败：部门名称已存在"
                                : err === "RENAME_DEPARTMENT_FAILED"
                                  ? "修改失败：请稍后再试"
                                  : err === "DELETE_DEPARTMENT_FAILED"
                                    ? "删除失败：请稍后再试"
                                    : err === "CREATE_DEPARTMENT_FAILED"
                                      ? "创建失败：请检查名称是否重复"
                                      : err === "INVALID_DEPARTMENT"
                                        ? "操作失败：部门名称无效"
                                        : `操作失败：${err}`}
                          </div>
                        )}

                        <div className="mt-4 border-t border-zinc-200 pt-3">
                          <div className="text-xs font-medium text-zinc-900">已创建的部门</div>
                          {departmentsDb.length === 0 ? (
                            <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                              暂无部门
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-col gap-2">
                              {departmentsDb.map((d) => {
                                const isEditing = deptEditId === d.id;
                                const isDeleting = deptDeleteId === d.id;
                                if (isEditing) {
                                  return (
                                    <form
                                      key={d.id}
                                      action={renameDepartment}
                                      className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                                    >
                                      <input type="hidden" name="lang" value={lang} />
                                      <input type="hidden" name="departmentId" value={d.id} />
                                      <input
                                        type="hidden"
                                        name="returnTo"
                                        value={adminHref({
                                          dept,
                                          q,
                                          st: status,
                                          edit,
                                          ccy: currency,
                                          lang,
                                          modal: "dept_edit",
                                          deptEdit: d.id,
                                          deptDelete: "",
                                        })}
                                      />
                                      <input
                                        name="newDepartmentName"
                                        defaultValue={d.name}
                                        className="h-9 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                                        required
                                        autoFocus
                                      />
                                      <button className="btn-press btn-ripple h-9 touch-manipulation rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 active:scale-[0.98] hover:bg-zinc-50">
                                        保存
                                      </button>
                                      <Link
                                        href={adminHref({
                                          dept,
                                          q,
                                          st: status,
                                          edit,
                                          ccy: currency,
                                          lang,
                                          modal: "dept_edit",
                                          deptEdit: "",
                                          deptDelete: "",
                                        })}
                                        className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                                        scroll={false}
                                      >
                                        取消
                                      </Link>
                                    </form>
                                  );
                                }
                                if (isDeleting) {
                                  return (
                                    <div
                                      key={d.id}
                                      className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                                    >
                                      <div className="min-w-0 text-sm text-zinc-900">{d.name}</div>
                                      <div className="flex items-center gap-2">
                                        <form action={deleteDepartment}>
                                          <input type="hidden" name="lang" value={lang} />
                                          <input type="hidden" name="departmentId" value={d.id} />
                                          <input
                                            type="hidden"
                                            name="returnTo"
                                            value={adminHref({
                                              dept,
                                              q,
                                              st: status,
                                              edit,
                                              ccy: currency,
                                              lang,
                                              modal: "dept_edit",
                                              deptEdit: "",
                                              deptDelete: "",
                                            })}
                                          />
                                          <button className="btn-press btn-ripple h-8 touch-manipulation rounded-xl bg-zinc-900 px-3 text-xs font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                                            确认删除
                                          </button>
                                        </form>
                                        <Link
                                          href={adminHref({
                                            dept,
                                            q,
                                            st: status,
                                            edit,
                                            ccy: currency,
                                            lang,
                                            modal: "dept_edit",
                                            deptEdit: "",
                                            deptDelete: "",
                                          })}
                                          className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                                          scroll={false}
                                        >
                                          取消
                                        </Link>
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div
                                    key={d.id}
                                    className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                                  >
                                    <div className="min-w-0 text-sm text-zinc-900">{d.name}</div>
                                    <div className="flex items-center gap-2">
                                      <Link
                                        href={adminHref({
                                          dept,
                                          q,
                                          st: status,
                                          edit,
                                          ccy: currency,
                                          lang,
                                          modal: "dept_edit",
                                          deptEdit: d.id,
                                          deptDelete: "",
                                        })}
                                        className="btn-press inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                                        scroll={false}
                                      >
                                        <PencilLine width={14} height={14} strokeWidth={1.5} />
                                        编辑
                                      </Link>
                                      <Link
                                        href={adminHref({
                                          dept,
                                          q,
                                          st: status,
                                          edit,
                                          ccy: currency,
                                          lang,
                                          modal: "dept_edit",
                                          deptEdit: "",
                                          deptDelete: d.id,
                                        })}
                                        className="btn-press inline-flex items-center gap-1.5 text-xs font-semibold text-[#e11d48] hover:text-[#e11d48]"
                                        scroll={false}
                                      >
                                        <Trash2 width={14} height={14} strokeWidth={1.5} />
                                        删除
                                      </Link>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </span>
                  <select
                    name="department"
                    defaultValue={editingEmployee.department}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                    required
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-500">状态</span>
                  {editingEmployee.user?.role === "SUPER_ADMIN" || editingEmployee.user?.role === "FINANCE" ? (
                    <>
                      <input type="hidden" name="status" value={editingEmployee.status} />
                      <input
                        disabled
                        value={editingEmployee.status === "TERMINATED" ? "离职" : "在职"}
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                      />
                    </>
                  ) : (
                    <select
                      name="status"
                      defaultValue={editingEmployee.status}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                      required
                    >
                      <option value="ACTIVE">在职</option>
                      <option value="TERMINATED">离职</option>
                    </select>
                  )}
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-500">入职日期</span>
                  <input
                    name="startDate"
                    type="date"
                    defaultValue={ymdInTimeZone(editingEmployee.startDate, BUSINESS_TIMEZONE)}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-500">邮箱（选填）</span>
                  <input
                    name="email"
                    type="email"
                    defaultValue={editingEmployee.user?.email ?? ""}
                    disabled={!editingEmployee.user}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300 disabled:bg-zinc-100"
                    placeholder={editingEmployee.user ? "alice@company.com" : "该员工尚未创建登录账号"}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                  {isSuperAdmin ? "保存修改" : "提交审批"}
                </button>
              </div>
            </form>
            {editingEmployeeIsRootAccount ? (
              <button
                disabled
                className="mt-2 inline-flex h-10 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-400"
              >
                总管理员不可删除
              </button>
            ) : (
              <form
                action={canDeleteEditingEmployeeDirect ? deleteEmployeeDirect : submitEmployeeDeleteRequest}
                className="mt-2"
                data-lock-submit="1"
                data-undo="1"
                data-undo-sec="10"
                data-undo-title={canDeleteEditingEmployeeDirect ? "将删除员工" : "将提交删除申请"}
                data-undo-btn="撤销"
              >
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="employeeId" value={editingEmployee.id} />
                <button
                  className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-[#e11d48] active:scale-[0.98] hover:bg-rose-100"
                  data-lock-text={canDeleteEditingEmployeeDirect ? "删除中…" : "提交中…"}
                >
                  {canDeleteEditingEmployeeDirect ? "删除员工" : "申请删除"}
                </button>
              </form>
            )}
          </div>
        ) : null}

        <div className="mt-5 md:hidden">
          {ledgerEmployees.length === 0 ? (
            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-zinc-500 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">暂无数据</div>
          ) : (
            <div className="flex flex-col gap-3">
              {ledgerEmployees.map((e, idx) => renderLedgerCard(e, offset + idx))}
            </div>
          )}
        </div>

        <div className="mt-5 hidden rounded-xl border border-zinc-200 bg-white md:block">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-sm tabular-nums">
              <colgroup>
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col className="w-[70px]" />
                <col className="w-[110px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[70px]" />
              </colgroup>
              <thead className="bg-zinc-50">
                <tr className="text-xs text-zinc-600">
                  <th className="sticky left-0 z-20 bg-zinc-50 px-2 py-2 font-semibold text-zinc-700 sm:px-3 sm:py-3">员工</th>
                  <th className="px-2 py-2 font-medium sm:px-3 sm:py-3">部门</th>
                  <th className="px-2 py-2 font-medium sm:px-3 sm:py-3">状态</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3 sm:py-3">行权价</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3 sm:py-3">已授予</th>
                  <th className="px-2 py-2 text-right font-semibold text-zinc-700 sm:px-3 sm:py-3">已成熟</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3 sm:py-3">已行权</th>
                  <th className="px-2 py-2 font-medium sm:px-3 sm:py-3">成熟进度</th>
                  <th className="px-2 py-2 text-right font-semibold text-zinc-700 sm:px-3 sm:py-3">已成熟价值</th>
                  <th className="px-2 py-2 font-medium sm:px-3 sm:py-3">离职过期</th>
                  <th className="sticky right-0 z-20 bg-zinc-50 px-2 py-2 text-right font-medium sm:px-3 sm:py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {ledgerEmployees.length === 0 ? (
                  <tr>
                    <td className="px-2 py-4 text-zinc-500 sm:px-3" colSpan={11}>
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  ledgerEmployees.map((e, idx) => renderLedgerRow(e, offset + idx))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50 md:shadow-none">
            <Link
              href={adminHref({ dept, q, st: status, lp: Math.max(1, page - 1), ccy: currency, lang, focus: "ledger" })}
              className={`btn-press inline-flex h-10 touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-medium ${
                page <= 1 ? "pointer-events-none bg-zinc-100 text-zinc-400" : "bg-white text-zinc-900 hover:bg-zinc-50"
              }`}
              scroll={false}
            >
              上一页
            </Link>
            <div className="text-sm text-zinc-600">
              第 <span className="font-mono tabular-nums text-zinc-900">{page}</span> /{" "}
              <span className="font-mono tabular-nums text-zinc-900">{totalPages}</span> 页
            </div>
            <Link
              href={adminHref({ dept, q, st: status, lp: Math.min(totalPages, page + 1), ccy: currency, lang, focus: "ledger" })}
              className={`btn-press inline-flex h-10 touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-medium ${
                page >= totalPages ? "pointer-events-none bg-zinc-100 text-zinc-400" : "bg-white text-zinc-900 hover:bg-zinc-50"
              }`}
              scroll={false}
            >
              下一页
            </Link>
          </div>
        ) : null}

        <div
          id="ui-admin-ledger-drawer"
          className="fixed inset-0 z-[70] hidden md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="员工概览"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/30 ui-overlay-in"
            aria-label="关闭"
            data-ledger-close
          />
          <div className="absolute inset-x-0 bottom-0 z-10 pb-[env(safe-area-inset-bottom)] ui-stagger-in" data-ledger-panel>
            <div className="mx-auto w-full max-w-lg rounded-t-3xl border border-black/10 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-black/5 bg-white/80 px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-zinc-900" id="ui-ledger-name" />
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                    <span className="truncate" id="ui-ledger-dept" />
                    <span className="text-zinc-300">·</span>
                    <span id="ui-ledger-status" className="rounded-full border px-2 py-0.5 text-xs font-medium" />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 active:bg-slate-200 hover:bg-white"
                  data-ledger-close
                  data-haptic
                >
                  关闭
                </button>
              </div>

              <div className="px-5 pb-5 pt-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-500">已授予</div>
                    <div className="ui-sensitive mt-0.5 text-sm font-semibold text-zinc-900" id="ui-ledger-granted" />
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-500">已成熟</div>
                    <div className="ui-sensitive mt-0.5 text-sm font-semibold text-[#059669]" id="ui-ledger-vested" />
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-500">已行权</div>
                    <div className="ui-sensitive mt-0.5 text-sm font-semibold text-indigo-700" id="ui-ledger-exercised" />
                    <div className="mt-0.5 text-[11px] text-zinc-500" id="ui-ledger-last-exercise" />
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-500">已成熟价值</div>
                    <div className="ui-sensitive mt-0.5 truncate text-sm font-semibold text-[#059669]" id="ui-ledger-vested-value" />
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span id="ui-ledger-progress" />
                    <span className="min-w-0 truncate" id="ui-ledger-next-vest" />
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      id="ui-ledger-progress-bar"
                      className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300"
                      style={{ width: "0%" }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500" id="ui-ledger-end-vest" />
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <div className="text-[11px] font-medium text-zinc-500">均价行权</div>
                  <div className="ui-sensitive mt-0.5 text-sm font-semibold text-zinc-900" id="ui-ledger-avg-strike" />
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <div className="text-[11px] font-medium text-zinc-500">离职过期</div>
                  <div className="mt-0.5 text-xs text-zinc-700" id="ui-ledger-expiry" />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <a
                    id="ui-ledger-edit"
                    href="#"
                    className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 active:bg-slate-200 active:scale-[0.98]"
                    data-haptic
                  >
                    编辑员工
                  </a>
                  <a
                    id="ui-ledger-grants"
                    href="#"
                    className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 active:bg-slate-200 active:scale-[0.98]"
                    data-haptic
                  >
                    授予记录
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Script id="ui-admin-ledger-drawer" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-admin-ledger-drawer'); if(!root||root.dataset.bound==='1') return; root.dataset.bound='1'; var nameEl=document.getElementById('ui-ledger-name'); var deptEl=document.getElementById('ui-ledger-dept'); var statusEl=document.getElementById('ui-ledger-status'); var avgStrikeEl=document.getElementById('ui-ledger-avg-strike'); var grantedEl=document.getElementById('ui-ledger-granted'); var vestedEl=document.getElementById('ui-ledger-vested'); var exercisedEl=document.getElementById('ui-ledger-exercised'); var lastExEl=document.getElementById('ui-ledger-last-exercise'); var vestedValEl=document.getElementById('ui-ledger-vested-value'); var progressEl=document.getElementById('ui-ledger-progress'); var nextVestEl=document.getElementById('ui-ledger-next-vest'); var endVestEl=document.getElementById('ui-ledger-end-vest'); var expiryEl=document.getElementById('ui-ledger-expiry'); var barEl=document.getElementById('ui-ledger-progress-bar'); var editA=document.getElementById('ui-ledger-edit'); var grantsA=document.getElementById('ui-ledger-grants'); var lastH=0; var haptic=function(){try{var now=Date.now(); if(now-lastH<60) return; lastH=now; if(navigator&&typeof navigator.vibrate==='function') navigator.vibrate(8);}catch(_){}}; var show=function(){root.classList.remove('hidden');}; var hide=function(){root.classList.add('hidden');}; var closes=root.querySelectorAll('[data-ledger-close]'); for(var i=0;i<closes.length;i++){closes[i].addEventListener('click',function(e){e.preventDefault(); hide();},true); closes[i].addEventListener('touchstart',function(e){e.preventDefault(); hide();}, {passive:false,capture:true});} var setText=function(el,v){if(!el) return; el.textContent=v||'';}; var setHref=function(el,v){if(!el) return; el.setAttribute('href',v||'#');}; var setStatus=function(label){if(!statusEl) return; statusEl.textContent=label||''; if(label==='在职'){statusEl.className='rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-[#059669]';} else if(label==='离职'){statusEl.className='rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-[#e11d48]';} else {statusEl.className='rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700';}}; var onOpen=function(card){try{var d=card.dataset||{}; setText(nameEl,d.empName); setText(deptEl,d.empDept); setStatus(d.empStatus); setText(avgStrikeEl,d.empAvgStrike); setText(grantedEl,d.empGranted); setText(vestedEl,d.empVested); setText(exercisedEl,d.empExercised); setText(lastExEl,d.empLastExercise||''); if(lastExEl) lastExEl.style.display=(d.empLastExercise?'block':'none'); setText(vestedValEl,d.empVestedValue); setText(progressEl,'成熟进度 '+(d.empProgress||'')); setText(nextVestEl,d.empNextVest); setText(endVestEl,d.empEndVest||''); if(endVestEl) endVestEl.style.display=(d.empEndVest?'block':'none'); setText(expiryEl,d.empExpiry); var pct=parseInt(String(d.empProgress||'0').replace('%',''),10); if(!isFinite(pct)) pct=0; if(barEl) barEl.style.width=Math.max(0,Math.min(100,pct))+'%'; setHref(editA,d.empEditHref); setHref(grantsA,d.empGrantHref); haptic(); show();}catch(_){}}; var bindCards=function(){var cards=document.querySelectorAll('[data-ledger-open]'); for(var i=0;i<cards.length;i++){(function(card){if(card.dataset.bound==='1') return; card.dataset.bound='1'; card.addEventListener('click',function(e){e.preventDefault(); onOpen(card);},true); card.addEventListener('touchstart',function(e){try{e.preventDefault(); onOpen(card);}catch(_){}} ,{passive:false,capture:true});})(cards[i]);}}; bindCards();}catch(_){}})();",
          }}
        />
        <Script id="ui-admin-ledger-drawer-drag" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-admin-ledger-drawer'); if(!root||root.dataset.dragBound==='1') return; root.dataset.dragBound='1'; var panel=root.querySelector('[data-ledger-panel]'); if(!panel) return; var down=false; var startY=0; var dy=0; var reset=function(){try{panel.style.transition='transform 180ms ease-out'; panel.style.transform='translateY(0px)'; setTimeout(function(){try{panel.style.transition='';}catch(_){}} ,220);}catch(_){}}; var close=function(){try{root.classList.add('hidden'); panel.style.transition=''; panel.style.transform='translateY(0px)';}catch(_){}}; panel.addEventListener('pointerdown',function(e){try{down=true; startY=e.clientY||0; dy=0; panel.setPointerCapture&&panel.setPointerCapture(e.pointerId);}catch(_){}} ,{capture:true}); panel.addEventListener('pointermove',function(e){try{if(!down) return; var y=e.clientY||0; dy=Math.max(0,y-startY); if(dy<=0) return; panel.style.transition=''; panel.style.transform='translateY('+dy+'px)';}catch(_){}} ,{capture:true}); panel.addEventListener('pointerup',function(){try{if(!down) return; down=false; if(dy>88){close();} else {reset();}}catch(_){}} ,{capture:true}); panel.addEventListener('pointercancel',function(){try{down=false; reset();}catch(_){}} ,{capture:true});}catch(_){}})();",
          }}
        />

        </>
        )}
      </section>

      <div className="mt-10 text-xs text-zinc-600">
        口径：已成熟 = VestingRecord(VESTED)；离职后未成熟将置为 FORFEITED，并生成回购待办。
      </div>
      </>
    );
  }

  function renderToasts() {
    return (
      <>
        {errorToast ? (
          <ErrorToast
            toastId={errorToast.toastId}
            title={errorToast.title}
            lines={errorToast.lines}
            durationMs={errorToast.durationMs}
            clearKeys={errorToast.clearKeys}
            closeLabel={tr("关闭", "關閉", "Close")}
          />
        ) : null}
        {successToast ? (
          <SuccessToast
            toastId={successToast.toastId}
            title={successToast.title}
            lines={successToast.lines}
            durationMs={successToast.durationMs}
            clearKeys={successToast.clearKeys}
            actions={successToast.actions}
            closeLabel={tr("关闭", "關閉", "Close")}
          />
        ) : null}
      </>
    );
  }

  function renderStatusBanner() {
    if (!err) return null;

    if (err === "PASSWORD_RESET_OK") {
      return (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#059669]">
          密码已重置，目标账号已被强制下线，需要使用新密码重新登录。
        </div>
      );
    }
    if (err === "PAYMENT_CHECK_OK") {
      return (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#059669]">
          已检查到账：链上已确认。
        </div>
      );
    }
    if (/^PAYMENT_CHECKED_\d+_\d+$/.test(err)) {
      return (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#059669]">
          {(() => {
            const m = err.match(/^PAYMENT_CHECKED_(\d+)_(\d+)$/);
            const ok = Number(m?.[1] ?? 0);
            const fail = Number(m?.[2] ?? 0);
            return `批量检查完成：成功 ${ok} 条 / 失败 ${fail} 条。`;
          })()}
        </div>
      );
    }

    return (
      <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#e11d48]">
        {(() => {
          if (err === "FETCH_AVG30_FAILED") return "近30日均价抓取失败：请稍后再试或更换股票代码。";
          if (err === "NO_SELECTION") return "请先勾选至少一条记录。";
          if (err === "NO_BULK_OP") return "请选择要执行的批量操作。";
          if (err === "MISSING_PAYMENT_DATA") return "缺少链/收款地址/TxHash/应收金额，无法检查到账。";
          if (err === "MISSING_PAYMENT_PROOF") return "缺少转账截图：请先上传截图后再提交。";
          if (err === "INVALID_IMAGE") return "截图格式不正确：请选择图片文件。";
          if (err === "IMAGE_TOO_LARGE") return "截图过大：请压缩后再上传（建议 900KB 以内）。";
          if (err === "PAYMENT_NOT_FOUND") return "链上未找到满足金额与收款地址的 USDT 转账记录。";
          if (err === "TX_NOT_FOUND") return "交易不存在或尚未上链，请稍后重试。";
          if (err === "TX_FAILED") return "交易执行失败（status=0），请核对 TxHash。";
          if (/^TRON_API_\d+$/.test(err)) return "TronScan 接口异常，请稍后重试。";
          if (/^BSC_RPC_\d+$/.test(err)) return "BSC RPC 接口异常，请稍后重试。";
          if (err === "DUPLICATE_EMAIL") return "登录账号已存在：该邮箱已被占用。";
          if (err === "DUPLICATE_ACCOUNT") return "登录账号已存在：该账号已被占用。";
          if (err === "INVALID_USER_ACCOUNT") return "账号无效：请填写 1–80 位的登录名（建议英文/数字/下划线）。";
          if (err === "INVALID_EMAIL") return "邮箱格式不正确。";
          if (err === "PASSWORD_TOO_SHORT") return "初始密码至少 8 位（创建登录账号时必填）。";
          if (err === "INVALID_EMPLOYEE_ACCOUNT") return "创建登录账号需要填写账号与初始密码（至少 8 位）。";
          if (err === "UPDATE_EMPLOYEE_FAILED") return "员工信息更新失败，请稍后重试。";
          if (err === "POOL_EXCEEDED") return "期权池剩余额度不足：请先在设置里调整“期权池总股数”。";
          if (err === "PAYMENT_NOT_VERIFIED") return "请先点击“检查到账”，确认链上到账后再完成行权。";
          if (err === "MUST_FUND_BEFORE_COMPLETE") return "请先点击“检查到账”，链上确认后再点击“完成行权”。";
          if (err === "INVALID_STATUS_FLOW") return "该申请状态已发生变化（可能已确认到账/已完成），请刷新后再操作。";
          if (err === "INVALID_VESTING") return "成熟配置不正确：请检查总成熟时长与分期次数。";
          if (err === "INVALID_EMPLOYEE") return "员工不存在或已被删除：请刷新页面后重新选择员工。";
          if (err === "DUPLICATE_AGREEMENT_NO") return "协议编号已存在：请稍后重试。";
          if (err === "AGREEMENT_NO_GENERATION_FAILED") return "协议编号生成失败：历史协议编号格式异常，请联系管理员修复。";
          if (/^STATUS_UPDATED_(FUNDED|COMPLETED)_\d+_\d+$/.test(err)) {
            const m = err.match(/^STATUS_UPDATED_(FUNDED|COMPLETED)_(\d+)_(\d+)$/);
            const st = m?.[1] ?? "";
            const ok = Number(m?.[2] ?? 0);
            const fail = Number(m?.[3] ?? 0);
            const label = st === "FUNDED" ? "已确认到账" : "已完成行权";
            return `批量更新完成：${label} 成功 ${ok} 条 / 失败 ${fail} 条。`;
          }
          return `操作失败：${err}`;
        })()}
      </div>
    );
  }

  function renderModals() {
    return (
      <>
        {modal === "error" && err ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-[520px] max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl ui-modal-in">
              <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">操作失败</div>
                  <div className="mt-1 text-xs text-zinc-600">请根据提示修正后重试。</div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="px-5 py-4">
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#e11d48]">
                  {err === "POOL_EXCEEDED"
                    ? "期权池剩余额度不足：请先在“期权池/设置”里调整“期权池总股数”。"
                    : err === "INVALID_VESTING"
                      ? "成熟配置不正确：请检查总成熟时长与分期次数（需可整除）。"
                      : err === "INVALID_GRANT"
                        ? "授予信息不完整或格式错误：请检查员工、授予日、股数、行权价等字段。"
                        : err === "INVALID_EMPLOYEE"
                          ? "员工不存在或已被删除：请刷新页面后重新选择员工。"
                          : err === "DUPLICATE_AGREEMENT_NO"
                            ? "协议编号已存在：请稍后重试。"
                            : err === "DUPLICATE_VESTING_DATE"
                              ? "生成的归属日期发生冲突：请检查成熟配置后重试。"
                              : err === "AGREEMENT_NO_GENERATION_FAILED"
                                ? "协议编号生成失败：历史协议编号格式异常，请联系管理员修复。"
                                : err === "DB_REQUEST_FAILED" || err === "DB_PANIC" || err === "DB_INIT_FAILED"
                                  ? "数据库暂时不可用：请稍后重试。"
                                  : err === "GRANT_FAILED_UNKNOWN"
                                    ? "授予创建失败：系统内部错误，请稍后重试。"
                                    : `授予创建失败：${err}`}
                </div>

                {errMsg ? (
                  <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
                    细节：<span className="font-mono">{errMsg}</span>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  {err === "POOL_EXCEEDED" ? (
                    <Link
                      href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, focus: "pool", modal: "settings_edit" })}
                      className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                      scroll={false}
                    >
                      去设置期权池
                    </Link>
                  ) : null}
                  <Link
                    href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "" })}
                    className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                    scroll={false}
                  >
                    我知道了
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {modal === "grant_history" && grantHistoryEmployee ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, edit, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">授予记录</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {grantHistoryEmployee.name} · {grantHistoryEmployee.department} ·{" "}
                    {grantHistoryEmployee.status === "ACTIVE" ? "在职" : "离职"}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4">
                {grantHistoryGrants.length === 0 ? (
                  <div className="rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
                    暂无授予记录
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {grantHistoryGrants.map((g) => {
                      const audit = grantHistoryAuditByAgreementNo.get(g.agreementNo) ?? null;
                      const payload = audit ? jsonObject(audit.payload) : {};
                      const lockupMonths = Number(payload["lockupPeriodMonths"]);
                      const vestingType = jsonString(payload["vestingType"]);
                      const duration = Number(payload["totalVestingDurationMonths"]);
                      const installments = Number(payload["vestingInstallments"]);
                      const vestingLabel =
                        vestingType === "IMMEDIATE"
                          ? "立即成熟"
                          : vestingType === "CUSTOM_INSTALLMENTS"
                            ? `自定义分期（${Number.isFinite(duration) ? duration : "—"} 月 / ${Number.isFinite(installments) ? installments : "—"} 期）`
                            : "—";
                      const exercises = grantHistoryExercisesByGrantId.get(g.id) ?? [];
                      return (
                        <div
                          key={g.id}
                          className="rounded-xl border border-black/5 bg-zinc-50 p-4 shadow-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-zinc-900">
                              {g.agreementNo} · {formatInt(g.totalShares)} 股
                            </div>
                            <div className="text-xs text-zinc-500">{formatDate(g.grantDate, lang)}</div>
                          </div>
                          <div className="mt-1 text-xs text-zinc-600">
                            授予日 {formatDate(g.grantDate, lang)} · 行权价 {formatMoney(g.strikePrice, currency, baseCurrency)} · 锁定期{" "}
                            {Number.isFinite(lockupMonths) ? `${lockupMonths} 月` : "—"} · 成熟机制 {vestingLabel}
                          </div>
                          <div className="mt-1 text-xs text-zinc-600">
                            创建人 {audit ? audit.requestedByUser.email : "—"}
                          </div>

                          {exercises.length > 0 ? (
                            <div className="mt-3 rounded-xl border border-black/5 bg-white px-3 py-2">
                              <div className="text-[11px] font-semibold text-zinc-600">行权留痕</div>
                              <div className="mt-2 flex flex-col gap-2">
                                {exercises.slice(0, 3).map((ex) => {
                                  const tx = String(ex.paymentTxHash ?? "").trim();
                                  const chain = String(ex.paymentChain ?? "").trim();
                                  const proofUrl = String(ex.paymentProofDataUrl ?? "").trim();
                                  const proofHas = Boolean(proofUrl);
                                  const proofStatus = ex.paymentProofConfirmedAt
                                    ? "截图已确认"
                                    : proofHas
                                      ? "已上传截图（待确认）"
                                      : "";
                                  const grantHistoryReturnTo = adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal: "grant_history" });
                                  const proofViewHref = withModal(
                                    withParam(withParam(adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal }), "pid", ex.id), "back", grantHistoryReturnTo),
                                    "exercise_proof",
                                  );
                                  return (
                                    <div key={ex.id} className="rounded-xl border border-black/5 bg-[#f8fafc] px-3 py-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-xs font-medium text-zinc-900">
                                          {formatInt(ex.requestedShares)} 股 · {String(ex.status ?? "")}
                                        </div>
                                        <div className="text-[11px] text-zinc-500">{formatDateTime(ex.createdAt, lang)}</div>
                                      </div>
                                      <div className="mt-1 text-[11px] text-zinc-600">
                                        {tx ? (
                                          <span className="ui-sensitive font-mono">
                                            {chain || "—"} · {sensitiveReveal ? `${tx.slice(0, 10)}…${tx.slice(-8)}` : maskSensitive(tx)}
                                          </span>
                                        ) : proofStatus ? (
                                          <span className="ui-sensitive">{proofStatus}</span>
                                        ) : (
                                          <span className="text-zinc-500">未提供 TxHash / 截图</span>
                                        )}
                                      </div>
                                      {proofHas ? (
                                        <div className="mt-2">
                                          {!sensitiveReveal ? (
                                            <Link
                                              href={withModal(adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal }), "reveal_sensitive")}
                                              scroll={false}
                                              className="group relative block overflow-hidden rounded-xl border border-black/5 bg-white"
                                            >
                                              <img src={proofUrl} alt="转账截图缩略图" className="h-24 w-full object-cover blur-[10px] opacity-70" />
                                              <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="rounded-full border border-black/10 bg-white/85 px-3 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm backdrop-blur-md">
                                                  解锁后查看
                                                </div>
                                              </div>
                                            </Link>
                                          ) : (
                                            <Link
                                              href={proofViewHref}
                                              scroll={false}
                                              className="group relative block overflow-hidden rounded-xl border border-black/5 bg-white"
                                            >
                                              <img src={proofUrl} alt="转账截图缩略图" className="h-24 w-full object-cover" />
                                              <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                                <div className="rounded-full border border-black/10 bg-white/85 px-3 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm backdrop-blur-md">
                                                  点击查看
                                                </div>
                                              </div>
                                            </Link>
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                                {exercises.length > 3 ? (
                                  <div className="text-[11px] text-zinc-500">仅展示最近 3 条行权记录</div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {modal === "exercise_proof" && proofViewRequest ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={proofBack}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ui-modal-in">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">支付信息</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {proofViewRequest.employee.name} · {proofViewRequest.employee.department} · {proofViewRequest.grant?.agreementNo ?? "—"} · {formatInt(proofViewRequest.requestedShares)} 股
                  </div>
                </div>
                <Link
                  href={proofBack}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4">
                <div className="rounded-xl border border-black/5 bg-[#f8fafc] px-4 py-3 text-xs text-zinc-700">
                  <div>提交时间：{formatDateTime(proofViewRequest.createdAt, lang)}</div>
                  <div>
                    上传：{proofViewRequest.paymentProofUploadedAt ? formatDateTime(proofViewRequest.paymentProofUploadedAt, lang) : "—"} ·{" "}
                    {String(proofViewRequest.paymentProofUploadedByRole ?? "").trim() || "—"}
                  </div>
                  <div>
                    确认：{proofViewRequest.paymentProofConfirmedAt ? formatDateTime(proofViewRequest.paymentProofConfirmedAt, lang) : "—"} ·{" "}
                    {String(proofViewRequest.paymentProofConfirmedByRole ?? "").trim() || "—"}
                  </div>
                  <div className="ui-sensitive font-mono">
                    {String(proofViewRequest.paymentChain ?? "").trim() || "—"} ·{" "}
                    {sensitiveReveal ? String(proofViewRequest.paymentToAddress ?? "").trim() || "—" : maskSensitive(String(proofViewRequest.paymentToAddress ?? ""))} ·{" "}
                    {String(proofViewRequest.paymentTxHash ?? "").trim()
                      ? sensitiveReveal
                        ? `${String(proofViewRequest.paymentTxHash).slice(0, 10)}…${String(proofViewRequest.paymentTxHash).slice(-8)}`
                        : maskSensitive(String(proofViewRequest.paymentTxHash))
                      : "无 TxHash"}
                  </div>
                </div>

                {(() => {
                  const proofUrl = String(proofViewRequest.paymentProofDataUrl ?? "").trim();
                  if (!proofUrl) {
                    return (
                      <div className="mt-3 rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
                        未找到截图
                      </div>
                    );
                  }
                  if (!sensitiveReveal) {
                    return (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-black/5 bg-white">
                        <div className="relative">
                          <img src={proofUrl} alt="转账截图缩略图" className="h-64 w-full object-cover blur-[10px] opacity-70" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Link
                              href={withModal(adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, risk, tag, ccy: currency, lang, modal }), "reveal_sensitive")}
                              className="btn-press btn-ripple rounded-full border border-black/10 bg-white/85 px-4 py-2 text-xs font-semibold text-zinc-900 shadow-sm backdrop-blur-md"
                              scroll={false}
                            >
                              解锁后查看
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-black/5 bg-white">
                      <img src={proofUrl} alt="转账截图" className="h-auto w-full object-contain" />
                    </div>
                  );
                })()}

                {sensitiveReveal ? (
                  <div className="mt-4 rounded-2xl border border-black/5 bg-[#f8fafc] p-4">
                    <div className="text-xs font-semibold text-zinc-900">管理员可编辑</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <form action={updateExercisePaymentMeta} className="rounded-xl border border-black/5 bg-white p-3" data-lock-submit="1">
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="id" value={proofViewRequest.id} />
                        <input
                          type="hidden"
                          name="returnTo"
                          value={withModal(withParam(withParam(proofBack, "pid", proofViewRequest.id), "back", proofBack), "exercise_proof")}
                        />
                        <input type="hidden" name="op" value="save_tx" />
                        <div className="text-[11px] font-semibold text-zinc-600">TxHash</div>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <select
                            name="chain"
                            defaultValue={String(proofViewRequest.paymentChain ?? "").trim() || "BNB"}
                            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                          >
                            <option value="BNB">BNB</option>
                            <option value="TRX">TRX</option>
                          </select>
                          <input
                            name="txHash"
                            defaultValue={String(proofViewRequest.paymentTxHash ?? "").trim()}
                            placeholder="留空表示不填写"
                            className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                          />
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800">
                            保存
                          </button>
                        </div>
                      </form>

                      <div className="rounded-xl border border-black/5 bg-white p-3">
                        <div className="text-[11px] font-semibold text-zinc-600">转账截图</div>
                        <form action={updateExercisePaymentMeta} className="mt-2 flex flex-col gap-2" encType="multipart/form-data" data-lock-submit="1">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="id" value={proofViewRequest.id} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={withModal(withParam(withParam(proofBack, "pid", proofViewRequest.id), "back", proofBack), "exercise_proof")}
                          />
                          <input type="hidden" name="op" value="upload_proof" />
                          <input
                            type="file"
                            name="paymentProof"
                            accept="image/*"
                            className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 file:mr-3 file:rounded-xl file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-900"
                          />
                          <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800">
                            上传并替换
                          </button>
                        </form>

                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <form action={updateExercisePaymentMeta} data-lock-submit="1">
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="id" value={proofViewRequest.id} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={withModal(withParam(withParam(proofBack, "pid", proofViewRequest.id), "back", proofBack), "exercise_proof")}
                            />
                            <input type="hidden" name="op" value="clear_tx" />
                            <button className="btn-press btn-ripple inline-flex h-10 w-full touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">
                              清空 TxHash
                            </button>
                          </form>
                          <form action={updateExercisePaymentMeta} data-lock-submit="1">
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="id" value={proofViewRequest.id} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={withModal(withParam(withParam(proofBack, "pid", proofViewRequest.id), "back", proofBack), "exercise_proof")}
                            />
                            <input type="hidden" name="op" value="clear_proof" />
                            <button className="btn-press btn-ripple inline-flex h-10 w-full touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">
                              删除截图
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {modal === "reset_password" && resetPasswordEmployee ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, edit, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">
                    {resetPasswordEmployee.userId ? "重置密码" : "开通登录账号"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {resetPasswordEmployee.name} · {resetPasswordEmployee.department} ·{" "}
                    {resetPasswordEmployee.status === "ACTIVE" ? "在职" : "离职"}
                    {resetPasswordEmployee.user?.email ? ` · ${resetPasswordEmployee.user.email}` : ""}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <form action={resetPasswordEmployee.userId ? resetEmployeePassword : enableEmployeeAccount} className="px-5 py-4">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="employeeId" value={resetPasswordEmployee.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={adminHref({ dept, q, st: status, edit, emp: resetPasswordEmployee.id, ccy: currency, lang, modal: "reset_password" })}
                />
                {ok === "PASSWORD_RESET_OK" ? (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-[#059669]">
                    密码已重置，目标账号已被强制下线。
                  </div>
                ) : err ? (
                    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                      {err === "PASSWORD_TOO_SHORT"
                        ? "新密码至少 8 位。"
                        : err === "PASSWORD_MISMATCH"
                          ? "两次新密码输入不一致。"
                          : err === "NO_EMPLOYEE_ACCOUNT"
                            ? "该员工未创建登录账号。"
                            : err === "DUPLICATE_ACCOUNT"
                              ? "账号已被占用。"
                            : err === "DUPLICATE_EMAIL"
                              ? "邮箱已被占用。"
                              : err === "INVALID_USER_ACCOUNT"
                                ? "账号无效。"
                                : err === "INVALID_EMAIL"
                                  ? "邮箱格式不正确。"
                              : err === "EMPLOYEE_ALREADY_HAS_ACCOUNT"
                                ? "该员工已开通登录账号。"
                                : `操作失败：${err}`}
                    </div>
                ) : null}
                {!resetPasswordEmployee.userId ? (
                  <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    该员工尚未开通登录账号。开通后可使用“账号”或“邮箱”登录。
                  </div>
                ) : null}
                <div className="flex flex-col gap-3">
                  {!resetPasswordEmployee.userId ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-zinc-600">账号（必填）</span>
                        <input
                          name="account"
                          className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                          placeholder="alice"
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-zinc-600">邮箱（选填）</span>
                        <input
                          name="email"
                          type="email"
                          className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                          placeholder="alice@company.com"
                        />
                      </label>
                    </div>
                  ) : null}
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">
                      {resetPasswordEmployee.userId ? "新密码" : "初始密码"}
                    </span>
                    <input
                      name="newPassword"
                      type="password"
                      minLength={8}
                      autoComplete="new-password"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">确认密码</span>
                    <input
                      name="confirmPassword"
                      type="password"
                      minLength={8}
                      autoComplete="new-password"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                      required
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Link
                    href={adminHref({ dept, q, st: status, edit, ccy: currency, lang })}
                    className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                    scroll={false}
                  >
                    取消
                  </Link>
                  <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                    {resetPasswordEmployee.userId ? "重置" : "开通"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {modal === "cr_detail" && changeRequestDetail ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">审批与留痕详情</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {changeRequestTypeLabel(String(changeRequestDetail.type))} ·{" "}
                    {changeRequestStatusLabel(String(changeRequestDetail.status))} · 提交{" "}
                    {formatDateTime(changeRequestDetail.createdAt, lang)}
                    {changeRequestDetail.decidedAt ? ` · 决定 ${formatDateTime(changeRequestDetail.decidedAt, lang)}` : ""}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 shadow-sm">
                    <div className="text-xs font-medium text-zinc-600">申请信息</div>
                    <div className="mt-2 text-xs text-zinc-600">
                      <div>申请人：{changeRequestDetail.requestedByUser.email}</div>
                      <div>提交时间：{formatDateTime(changeRequestDetail.createdAt, lang)}</div>
                      <div>目标员工：{changeRequestDetail.targetEmployee?.name ?? "—"} · {changeRequestDetail.targetEmployee?.department ?? "—"}</div>
                      <div>目标协议：{changeRequestDetail.targetGrant?.agreementNo ?? "—"}</div>
                      <div>审批人：{changeRequestDetail.decidedByUser?.email ?? "—"}</div>
                      <div>审批时间：{changeRequestDetail.decidedAt ? formatDateTime(changeRequestDetail.decidedAt, lang) : "—"}</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 shadow-sm">
                    <div className="text-xs font-medium text-zinc-600">留痕时间线</div>
                    {changeRequestDetail.events.length === 0 ? (
                      <div className="mt-2 text-sm text-zinc-500">暂无留痕</div>
                    ) : (
                      <div className="mt-2 flex flex-col gap-2">
                        {changeRequestDetail.events.map((ev) => (
                          <div key={ev.id} className="rounded-lg border border-black/5 bg-white px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs font-medium text-zinc-900">
                                {changeRequestEventActionLabel(String(ev.action))}
                              </div>
                              <div className="text-xs text-zinc-500">{formatDateTime(ev.createdAt, lang)}</div>
                            </div>
                            <div className="mt-1 text-xs text-zinc-600">操作者：{ev.createdByUser.email}</div>
                            {ev.note ? <div className="mt-1 text-xs text-zinc-600">备注：{ev.note}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 shadow-sm">
                  <div className="text-xs font-medium text-zinc-600">变更内容</div>
                  <RenderPayload payload={changeRequestDetail.payload} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {modal === "emp_status_confirm" && statusConfirmEmployee && ns && isFinance ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, edit, emp: "", ccy: currency, lang, modal: "" })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-[520px] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ui-modal-in">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white/80 px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">提请审批</div>
                  <div className="mt-1 text-xs text-zinc-600">切换员工状态需要总管理员审批。</div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp: "", ccy: currency, lang, modal: "" })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  <div className="font-medium text-zinc-900">{statusConfirmEmployee.name}</div>
                  <div className="mt-1 text-xs text-zinc-600">{statusConfirmEmployee.department}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-zinc-500">当前：</span>
                    <span className={`rounded-full border px-2 py-0.5 font-medium ${statusConfirmEmployee.status === "ACTIVE" ? "border-emerald-200 bg-emerald-50 text-[#059669]" : "border-zinc-200 bg-white text-zinc-700"}`}>
                      {statusConfirmEmployee.status === "ACTIVE" ? "在职" : "离职"}
                    </span>
                    <span className="text-zinc-400">→</span>
                    <span className={`rounded-full border px-2 py-0.5 font-medium ${ns === "ACTIVE" ? "border-emerald-200 bg-emerald-50 text-[#059669]" : "border-zinc-200 bg-white text-zinc-700"}`}>
                      {ns === "ACTIVE" ? "在职" : "离职"}
                    </span>
                  </div>
                </div>

                <form action={submitEmployeeUpdateRequest} className="mt-4 flex items-center justify-end gap-2">
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, emp: statusConfirmEmployee.id, ccy: currency, lang, modal: "emp_status_confirm", ns })} />
                  <input type="hidden" name="successTo" value={adminHref({ dept, q, st: status, edit, emp: "", ccy: currency, lang, modal: "" })} />
                  <input type="hidden" name="employeeId" value={statusConfirmEmployee.id} />
                  <input type="hidden" name="name" value={statusConfirmEmployee.name} />
                  <input type="hidden" name="department" value={statusConfirmEmployee.department} />
                  <input type="hidden" name="startDate" value={ymdInTimeZone(statusConfirmEmployee.startDate, BUSINESS_TIMEZONE)} />
                  <input type="hidden" name="status" value={ns} />
                  <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-[#2563eb] px-4 text-sm font-semibold text-white active:scale-[0.98]">
                    提请审批
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : null}

        {modal === "employee_edit" && employeeEditEmployee ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">编辑员工</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {employeeEditEmployee.name} · {employeeEditEmployee.department} ·{" "}
                    {employeeEditEmployee.status === "ACTIVE" ? "在职" : "离职"}
                    {employeeEditEmployee.user?.account ? ` · ${employeeEditEmployee.user.account}` : ""}
                    {employeeEditEmployee.user?.email ? ` · ${employeeEditEmployee.user.email}` : ""}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto">
              <form action={isSuperAdmin ? updateEmployeeDirect : submitEmployeeUpdateRequest} className="px-5 py-4">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="employeeId" value={employeeEditEmployee.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={adminHref({ dept, q, st: status, ccy: currency, lang, emp: employeeEditEmployee.id, modal: "employee_edit" })}
                />
                <input
                  type="hidden"
                  name="successTo"
                  value={adminHref({ dept, q, st: status, ccy: currency, lang })}
                />
                {err ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                    {err === "INVALID_EMPLOYEE_UPDATE"
                      ? "员工信息无效。"
                      : err === "INVALID_EMPLOYEE_STATUS"
                        ? "员工状态无效。"
                        : err === "INVALID_DEPARTMENT"
                          ? "部门无效。"
                          : err === "INVALID_EMPLOYEE_ACCOUNT"
                            ? "邮箱格式无效。"
                            : err === "INVALID_USER_ACCOUNT"
                              ? "账号格式无效。"
                            : err === "NO_EMPLOYEE_ACCOUNT"
                              ? "该员工尚未创建登录账号（无法修改账号/邮箱）。"
                              : err === "DUPLICATE_ACCOUNT"
                                ? "账号已被占用。"
                              : `操作失败：${err}`}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">姓名</span>
                    <input
                      name="name"
                      defaultValue={employeeEditEmployee.name}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">部门</span>
                    <select
                      name="department"
                      defaultValue={employeeEditEmployee.department}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                      required
                    >
                      {departments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">状态</span>
                    {employeeEditEmployee.user?.role === "SUPER_ADMIN" || employeeEditEmployee.user?.role === "FINANCE" ? (
                      <>
                        <input type="hidden" name="status" value={employeeEditEmployee.status} />
                        <input
                          disabled
                          value={employeeEditEmployee.status === "TERMINATED" ? "离职" : "在职"}
                          className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none"
                        />
                      </>
                    ) : (
                      <select
                        name="status"
                        defaultValue={employeeEditEmployee.status}
                        className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                        required
                      >
                        <option value="ACTIVE">在职</option>
                        <option value="TERMINATED">离职</option>
                      </select>
                    )}
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">入职日期</span>
                    <input
                      name="startDate"
                      type="date"
                      defaultValue={ymdInTimeZone(employeeEditEmployee.startDate, BUSINESS_TIMEZONE)}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">登录名</span>
                    <input
                      name="account"
                      defaultValue={employeeEditEmployee.user?.account ?? ""}
                      disabled={!employeeEditEmployee.userId}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300 disabled:bg-zinc-100"
                      placeholder={employeeEditEmployee.userId ? "alice" : "该员工尚未创建登录账号"}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-zinc-500">邮箱（选填）</span>
                    <input
                      name="email"
                      type="email"
                      defaultValue={employeeEditEmployee.user?.email ?? ""}
                      disabled={!employeeEditEmployee.userId}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300 disabled:bg-zinc-100"
                      placeholder={employeeEditEmployee.userId ? "alice@company.com" : "该员工尚未创建登录账号"}
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Link
                    href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                    className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                    scroll={false}
                  >
                    取消
                  </Link>
                  <button
                    className={`btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium ${
                      isSuperAdmin
                        ? "border border-black/5 bg-white/80 text-zinc-900 hover:bg-white"
                        : "bg-zinc-900 text-white hover:bg-zinc-800"
                    }`}
                  >
                    {isSuperAdmin ? "保存修改" : "提交审批"}
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-black/5 bg-zinc-50 px-4 py-3 shadow-sm">
                  <div className="text-xs font-medium text-zinc-600">更多操作</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {isSuperAdmin ? (
                      <Link
                        href={adminHref({ dept, q, st: status, edit, emp: employeeEditEmployee.id, ccy: currency, lang, modal: "reset_password" })}
                        className="btn-press btn-ripple inline-flex h-9 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-3 text-sm font-medium text-zinc-900 hover:bg-white"
                        scroll={false}
                      >
                        重置密码
                      </Link>
                    ) : null}
                    {editingEmployeeIsRootAccount ? (
                      <span className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/70 px-3 text-sm font-medium text-zinc-400">
                        总管理员不可删除
                      </span>
                    ) : (
                      <Link
                        href={adminHref({ dept, q, st: status, emp: employeeEditEmployee.id, ccy: currency, lang, modal: "employee_delete" })}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-[#e11d48] hover:bg-rose-100"
                        scroll={false}
                      >
                        {isSuperAdmin ? "删除员工" : "申请删除"}
                      </Link>
                    )}
                  </div>
                </div>
              </form>
              </div>
            </div>
          </div>
        ) : null}

        {modal === "employee_delete" && employeeDeleteEmployee ? (
          <div
            id="ui-admin-employee-delete-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={canDeleteEmployeeDirect ? "删除员工" : "申请删除员工"}
          >
            <Link
              href={adminHref({ dept, q, st: status, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
              data-empdel-close
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">
                    {employeeDeleteIsRootAccount ? "总管理员不可删除" : canDeleteEmployeeDirect ? "删除员工" : "申请删除员工"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {employeeDeleteEmployee.name} · {employeeDeleteEmployee.department}
                    {employeeDeleteEmployee.user?.email ? ` · ${employeeDeleteEmployee.user.email}` : ""}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                  data-empdel-close
                >
                  关闭
                </Link>
              </div>
              <div className="flex-1 overflow-auto">
                {employeeDeleteIsRootAccount ? (
                  <div className="px-5 py-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                      总管理员账号为系统根账号，禁止删除。
                    </div>
                    <div className="mt-4 flex items-center justify-end">
                      <Link
                        href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                        className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                        scroll={false}
                      >
                        我知道了
                      </Link>
                    </div>
                  </div>
                ) : (
                  <form
                    action={canDeleteEmployeeDirect ? deleteEmployeeDirect : submitEmployeeDeleteRequest}
                    className="px-5 py-4"
                    data-lock-submit="1"
                    data-undo="1"
                    data-undo-sec="10"
                    data-undo-title={canDeleteEmployeeDirect ? "将删除员工" : "将提交删除申请"}
                    data-undo-btn="撤销"
                  >
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="employeeId" value={employeeDeleteEmployee.id} />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={adminHref({ dept, q, st: status, ccy: currency, lang, emp: employeeDeleteEmployee.id, modal: "employee_delete" })}
                    />
                    <input
                      type="hidden"
                      name="successTo"
                      value={adminHref({ dept, q, st: status, ccy: currency, lang })}
                    />
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                      {canDeleteEmployeeDirect
                        ? "删除会同时清理该员工的授予/成熟/行权等记录，请谨慎操作。"
                        : "提交后将进入审批流程，由初始总管理员审核。"}
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Link
                        href={adminHref({ dept, q, st: status, ccy: currency, lang })}
                        className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                        scroll={false}
                        data-empdel-close
                      >
                        取消
                      </Link>
                      <button
                        className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-[#e11d48] active:scale-[0.98] hover:bg-rose-100"
                        data-lock-text={canDeleteEmployeeDirect ? "删除中…" : "提交中…"}
                      >
                        {canDeleteEmployeeDirect ? "确认删除" : "提交申请"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {modal === "change_password" ? (
          <div
            id="ui-admin-change-password-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={tr("修改密码", "修改密碼", "Change password")}
          >
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
              data-acp-close
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white px-5 py-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">
                    {tr("修改密码", "修改密碼", "Change password")}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {tr("提交成功后会退出登录，需要重新登录。", "提交成功後會退出登入，需要重新登入。", "You'll be logged out after updating the password.")}
                  </div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                  data-acp-close
                >
                  {tr("关闭", "關閉", "Close")}
                </Link>
              </div>
              <div className="flex-1 overflow-auto">
              <form action={changePassword} className="px-5 py-4">
                <input type="hidden" name="lang" value={lang} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "change_password" })}
                />
                {err ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                    {err === "BAD_CURRENT_PASSWORD"
                      ? tr("当前密码不正确。", "目前密碼不正確。", "Current password is incorrect.")
                      : err === "PASSWORD_TOO_SHORT"
                        ? tr("新密码至少 8 位。", "新密碼至少 8 位。", "New password must be at least 8 characters.")
                        : err === "PASSWORD_MISMATCH"
                          ? tr("两次新密码输入不一致。", "兩次新密碼輸入不一致。", "New passwords do not match.")
                          : tr(`操作失败：${err}`, `操作失敗：${err}`, `Error: ${err}`)}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">
                      {tr("当前密码", "目前密碼", "Current password")}
                    </span>
                    <input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">
                      {tr("新密码", "新密碼", "New password")}
                    </span>
                    <input
                      name="newPassword"
                      type="password"
                      minLength={8}
                      autoComplete="new-password"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">
                      {tr("确认新密码", "確認新密碼", "Confirm new password")}
                    </span>
                    <input
                      name="confirmPassword"
                      type="password"
                      minLength={8}
                      autoComplete="new-password"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                      required
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Link
                    href={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang })}
                    className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                    scroll={false}
                  >
                    {tr("取消", "取消", "Cancel")}
                  </Link>
                  <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                    {tr("提交", "提交", "Update")}
                  </button>
                </div>
              </form>
              </div>
            </div>
          </div>
        ) : null}

        {modal === "reveal_sensitive" ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })}
              className="absolute inset-0 bg-black/30 ui-overlay-in"
              aria-label="关闭"
              scroll={false}
            >
              <span className="sr-only">关闭</span>
            </Link>
            <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl ui-modal-in">
              <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">解锁敏感信息</div>
                  <div className="mt-1 text-xs text-zinc-600">需二次验证密码，解锁有效期 5 分钟。</div>
                </div>
                <Link
                  href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })}
                  className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                  scroll={false}
                >
                  关闭
                </Link>
              </div>
              <form action={enableSensitiveReveal} className="px-5 py-4">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="returnTo" value={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })} />
                {err ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#e11d48]">
                    {err === "BAD_CURRENT_PASSWORD"
                      ? "密码不正确。"
                      : err === "PASSWORD_TOO_SHORT"
                        ? "密码至少 8 位。"
                        : `操作失败：${err}`}
                  </div>
                ) : null}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-zinc-600">管理员密码</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    minLength={8}
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-300"
                    required
                  />
                </label>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Link
                    href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "", view, focus })}
                    className="btn-press btn-ripple inline-flex h-10 items-center justify-center rounded-xl border border-black/5 bg-white/80 px-4 text-sm font-medium text-zinc-900 hover:bg-white"
                    scroll={false}
                  >
                    取消
                  </Link>
                  <button className="btn-press btn-ripple inline-flex h-10 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white active:scale-[0.98] hover:bg-zinc-800">
                    解锁
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderHeader() {
    return (
      <div className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
        <AdminHeader
          lang={lang}
          title={tr("ESOP管理后台", "ESOP管理後台", "ESOP Admin Dashboard")}
          subtitle={tr(
            "期权池、审批与留痕、员工台账总览。",
            "期權池、審批與留痕、員工台賬總覽。",
            "Option pool, approvals/audit trail, and employee ledger.",
          )}
          logoDataUrl={brandLogoDataUrl}
          logoReturnTo={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal })}
          uploadBrandLogoAction={uploadBrandLogo}
          changePasswordHref={adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "change_password" })}
          changePasswordLabel={tr("修改密码", "修改密碼", "Change password")}
          logoutHref={`/logout?next=${encodeURIComponent(lang === "zh-CN" ? "/" : `/?lang=${encodeURIComponent(lang)}`)}`}
          logoutAction={logout}
          logoutLabel={tr("退出登录", "退出登入", "Log out")}
          currencyLangSwitch={
            <AdminCurrencyLangSwitch
              variant="header"
              currencyPills={[
                { label: "USD", active: currency === "USD", href: adminHref({ dept, q, st: status, edit, ccy: "USD", lang }) },
                { label: "HKD", active: currency === "HKD", href: adminHref({ dept, q, st: status, edit, ccy: "HKD", lang }) },
                { label: "CNY", active: currency === "CNY", href: adminHref({ dept, q, st: status, edit, ccy: "CNY", lang }) },
              ]}
              currencyHint={tr("计价切换（按固定汇率换算）", "計價切換（按固定匯率換算）", "Display currency (fixed FX rates)")}
              langPills={[
                { label: "简体", active: lang === "zh-CN", href: adminHref({ dept, q, st: status, edit, ccy: currency, lang: "zh-CN" }) },
                { label: "繁體", active: lang === "zh-TW", href: adminHref({ dept, q, st: status, edit, ccy: currency, lang: "zh-TW" }) },
                { label: "EN", active: lang === "en", href: adminHref({ dept, q, st: status, edit, ccy: currency, lang: "en" }) },
              ]}
            />
          }
          mobileMenuButton={
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "mobile_menu", view, focus })}
              data-am-open
              scroll={false}
              className="btn-press btn-ripple inline-flex h-9 w-11 touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white/80 text-zinc-900 active:scale-[0.98]"
              aria-label={tr("菜单", "選單", "Menu")}
              data-haptic
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
          }
          currentUserEmail={`${authedUser.account}${authedUser.email ? ` · ${authedUser.email}` : ""}`}
          currentUserRole={authedUser.role}
          isRootSuperAdmin={isRootSuperAdmin}
        />
      </div>
    );
  }

  function renderTopNav(variant: "full" | "navOnly" | "extrasOnly" = "full") {
    const quickActions = (
      isSuperAdmin
        ? [
            { focus: "approvals", label: tr("处理变更审批", "處理變更審批", "Review approvals") },
            { focus: "workbench", label: tr("处理行权/回购", "處理行權/回購", "Handle exercises/buybacks") },
            { focus: "ledger", label: tr("查看员工台账", "查看員工台賬", "Open employee ledger") },
            { focus: "pool", label: tr("查看池水位", "查看池水位", "Check pool") },
          ]
        : isFinance
          ? [
              { focus: "ops", label: tr("发起申请", "發起申請", "Start requests") },
              { focus: "approvals", label: tr("看申请状态", "看申請狀態", "Track requests") },
              { focus: "ledger", label: tr("查询员工台账", "查詢員工台賬", "Search ledger") },
              { focus: "pool", label: tr("查看池水位", "查看池水位", "Check pool") },
            ]
          : []
    ).map((it) => ({
      href: adminHref({
        dept,
        q,
        st: status,
        edit,
        emp,
        cr: crId,
        crst,
        risk,
        tag,
        ccy: currency,
        lang,
        modal: "",
        view: "",
        focus: it.focus,
      }),
      label: it.label,
    }));

    const todoLines =
      isSuperAdmin
        ? [
            {
              label: tr("变更审批", "變更審批", "Approvals"),
              value: pendingChangeRequestCount,
              href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "", view: "", focus: "approvals" }),
            },
            {
              label: tr("行权/打款", "行權/打款", "Exercises"),
              value: pendingExerciseCount,
              href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "", view: "", focus: "workbench" }),
            },
            {
              label: tr("离职回购", "離職回購", "Buybacks"),
              value: pendingBuybackCount,
              href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "", view: "", focus: "workbench" }),
            },
          ]
        : isFinance
          ? [
              {
                label: tr("我提交的申请", "我提交的申請", "My requests"),
                value: myChangeRequestAllCount,
                href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "", view: "", focus: "approvals" }),
              },
              {
                label: tr("待审批", "待審批", "Pending"),
                value: myChangeRequestPendingCount,
                href: adminHref({ dept, q, st: status, edit, emp, ccy: currency, lang, modal: "", view: "", focus: "approvals" }),
              },
            ]
          : [];

    const tabs = [
      { key: "", view: "all", label: tr("首页", "首頁", "Home") },
      { key: "approvals", view: "", label: tr("变更审批", "變更審批", "Approvals") },
      { key: "pool", view: "", label: tr("期权池水位", "期權池水位", "Pool") },
      ...(isSuperAdmin ? [{ key: "workbench", view: "", label: tr("审批工作台", "審批工作台", "Workbench") }] : []),
      { key: "ops", view: "", label: tr("运营操作", "運營操作", "Operations") },
      { key: "ledger", view: "", label: tr("台账总览", "台賬總覽", "Ledger") },
    ].map((it) => ({
      href: adminHref({
        dept,
        q,
        st: status,
        edit,
        emp,
        cr: crId,
        crst,
        risk,
        tag,
        ccy: currency,
        lang,
        modal: "",
        view: it.view,
        focus: it.key,
      }),
      label: it.label,
      active: it.key ? focus === it.key : showAll,
    }));

    return (
      <AdminTopNav
        quickActionsTitle={tr("快捷入口", "快捷入口", "Quick actions")}
        quickActions={quickActions}
        todoTitle={tr("待办摘要", "待辦摘要", "To-do summary")}
        todoLines={todoLines}
        tabs={tabs}
        variant={variant}
      />
    );
  }

  function renderChrome() {
    const closeMobileMenuHref = adminHref({
      dept,
      q,
      st: status,
      edit,
      emp,
      cr: crId,
      crst,
      ap,
      risk,
      tag,
      ccy: currency,
      lang,
      modal: "",
      view,
      focus,
    });
    const mobileBackFallbackHref = adminHref({ ccy: currency, lang, modal: "", view: "", focus: "" });
    const showMobileBack = Boolean(modal || emp || edit || crId || q || dept || status || risk || tag || focus || view || crst || ap);

    const mobileNavTabs = [
      { key: "", label: tr("首页", "首頁", "Home"), focus: "" },
      { key: "approvals", label: tr("变更审批", "變更審批", "Approvals"), focus: "approvals" },
      { key: "pool", label: tr("期权池水位", "期權池水位", "Pool"), focus: "pool" },
      ...(isSuperAdmin ? [{ key: "workbench", label: tr("审批工作台", "審批工作台", "Workbench"), focus: "workbench" }] : []),
      { key: "ops", label: tr("运营操作", "運營操作", "Operations"), focus: "ops" },
      { key: "ledger", label: tr("台账总览", "台賬總覽", "Ledger"), focus: "ledger" },
    ];

    return (
      <>
        <AdminFocusScroll focus={focus} />
        <div className="md:hidden sticky top-0 z-50 h-16 bg-white/70 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:max-w-[76rem]">
            <div className="flex min-w-0 items-center gap-3">
              {showMobileBack ? (
                <BackButton
                  fallbackHref={mobileBackFallbackHref}
                  ariaLabel={tr("返回上一页", "返回上一頁", "Back")}
                  className="btn-press inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-zinc-900 active:bg-slate-200"
                />
              ) : null}
              <div className="h-9 w-9 overflow-hidden rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                {brandLogoDataUrl ? (
                  <img src={brandLogoDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-zinc-900">
                    ES
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {tr("ESOP 管理后台", "ESOP 管理後台", "ESOP Admin")}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {tr("期权管理系统", "期權管理系統", "Equity management")}
                </div>
              </div>
            </div>
            <Link
              href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "mobile_menu", view, focus })}
              data-am-open
              data-haptic
              scroll={false}
              className="btn-press inline-flex h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation items-center justify-center rounded-xl text-zinc-900 active:bg-slate-200"
              aria-label={tr("菜单", "選單", "Menu")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M5 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Link>
          </div>
        </div>

        <div className="md:hidden sticky top-16 z-40 bg-[#f8fafc]/85 px-4 py-3 backdrop-blur-md">
          <form action="/admin" method="get" className="mx-auto w-full max-w-6xl md:max-w-[76rem]">
            {dept ? <input type="hidden" name="dept" value={dept} /> : null}
            {status ? <input type="hidden" name="st" value={status} /> : null}
            {currency !== "USD" ? <input type="hidden" name="ccy" value={currency} /> : null}
            {lang !== "zh-CN" ? <input type="hidden" name="lang" value={lang} /> : null}
            <input type="hidden" name="focus" value="ledger" />
            <div className="flex items-center gap-2">
              <div className="flex h-12 flex-1 items-center gap-2 rounded-2xl bg-white px-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-zinc-400">
                  <path
                    d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <DebouncedSearch
                  defaultValue={q}
                  className="h-12 w-full bg-transparent text-base text-zinc-900 outline-none"
                  placeholder={tr("搜索员工姓名或部门", "搜尋員工姓名或部門", "Search name or department")}
                  forceParams={{ focus: "ledger" }}
                />
                <button
                  type="submit"
                  className="btn-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f8fafc] text-zinc-700 active:bg-slate-200"
                  aria-label={tr("搜索", "搜尋", "Search")}
                  data-haptic
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {q ? (
                <Link
                  href={adminHref({ dept, q: "", st: status, ccy: currency, lang, focus: "ledger" })}
                  scroll={false}
                  className="btn-press inline-flex h-12 touch-manipulation items-center justify-center rounded-2xl bg-[#f8fafc] px-3 text-sm font-semibold text-zinc-700 active:bg-slate-200"
                  data-haptic
                >
                  {tr("清空", "清空", "Clear")}
                </Link>
              ) : null}
            </div>
          </form>
        </div>

        <div className="hidden md:block sticky top-2 z-40">
          <div className="flex flex-col gap-3">
            {renderHeader()}
            <div className="hidden md:block">{renderTopNav("navOnly")}</div>
          </div>
        </div>
        {renderTopNav("extrasOnly")}
        {renderStatusBanner()}
        {renderModals()}

        <div
          id="ui-admin-mobile-menu"
          className={`fixed inset-0 z-[80] md:hidden ${modal === "mobile_menu" ? "" : "hidden"}`}
          data-close-href={closeMobileMenuHref}
          role="dialog"
          aria-modal="true"
          aria-label={tr("导航菜单", "導航選單", "Menu")}
        >
            <a
              href={closeMobileMenuHref}
              className="absolute inset-0 bg-white/70 backdrop-blur-md ui-overlay-in"
              aria-label="关闭"
              data-am-close
            >
              <span className="sr-only">关闭</span>
            </a>

            <div className="absolute inset-0 ui-drawer-in">
              <div className="absolute inset-y-0 right-0 w-[min(92vw,420px)] bg-white/90 backdrop-blur-md shadow-2xl">
                <div className="flex h-16 items-center justify-between px-4">
                  <div className="text-sm font-semibold text-zinc-900">{tr("导航菜单", "導航選單", "Menu")}</div>
                  <a
                    href={closeMobileMenuHref}
                    className="btn-press inline-flex items-center justify-center rounded-xl p-3 text-zinc-900 active:bg-slate-200"
                    data-am-close
                    data-haptic
                    aria-label={tr("关闭", "關閉", "Close")}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 7l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </a>
                </div>

                <div className="h-[calc(100dvh-64px-env(safe-area-inset-bottom))] overflow-auto px-4 pb-[env(safe-area-inset-bottom)]">
                  <div className="flex flex-col gap-3 pb-4">
                    <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                      <div className="text-[11px] font-semibold text-zinc-500">{tr("导航", "導航", "Navigation")}</div>
                      <div className="mt-3 grid grid-cols-1 gap-2">
                        {mobileNavTabs.map((it) => (
                          <a
                            key={it.key || "home"}
                            href={adminHref({
                              dept,
                              q,
                              st: status,
                              edit,
                              emp,
                              cr: crId,
                              crst,
                              ap,
                              risk,
                              tag,
                              ccy: currency,
                              lang,
                              modal: "",
                              view: it.key ? "" : "all",
                              focus: it.focus,
                            })}
                            data-am-nav
                            data-haptic
                            className="btn-press btn-ripple inline-flex h-12 touch-manipulation items-center justify-between rounded-2xl bg-[#f8fafc] px-4 text-base font-semibold text-zinc-900 active:bg-slate-200"
                          >
                            <span>{it.label}</span>
                            <span className="text-[#2563eb]">{">"}</span>
                          </a>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                      <div className="text-[11px] font-semibold text-zinc-500">{tr("计价与语言", "計價與語言", "Display")}</div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {(["USD", "HKD", "CNY"] as const).map((ccy) => (
                          <a
                            key={ccy}
                            href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy, lang, modal: "", view, focus })}
                            data-am-nav
                            data-haptic
                            className={`btn-press inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl px-3 text-sm font-semibold active:bg-slate-200 ${
                              currency === ccy ? "bg-[#2563eb]/10 text-[#2563eb]" : "bg-[#f8fafc] text-zinc-900"
                            }`}
                          >
                            {ccy}
                          </a>
                        ))}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {([
                          { k: "zh-CN", label: "简体" },
                          { k: "zh-TW", label: "繁體" },
                          { k: "en", label: "EN" },
                        ] as const).map((l) => (
                          <a
                            key={l.k}
                            href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang: l.k, modal: "", view, focus })}
                            data-am-nav
                            data-haptic
                            className={`btn-press inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl px-3 text-sm font-semibold active:bg-slate-200 ${
                              lang === l.k ? "bg-[#2563eb]/10 text-[#2563eb]" : "bg-[#f8fafc] text-zinc-900"
                            }`}
                          >
                            {l.label}
                          </a>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={adminHref({ dept, q, st: status, edit, emp, cr: crId, crst, ap, risk, tag, ccy: currency, lang, modal: "change_password", view, focus })}
                          data-am-nav
                          data-haptic
                          className="btn-press btn-ripple inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl bg-[#f8fafc] px-4 text-sm font-semibold text-zinc-900 active:bg-slate-200"
                        >
                          {tr("修改密码", "修改密碼", "Password")}
                        </a>
                        <a
                          href={`/logout?next=${encodeURIComponent(lang === "zh-CN" ? "/" : `/?lang=${encodeURIComponent(lang)}`)}`}
                          data-am-nav
                          target="_top"
                          data-haptic
                          className="btn-press btn-ripple inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#2563eb] px-4 text-sm font-semibold text-white active:scale-[0.98]"
                        >
                          {tr("退出登录", "退出登入", "Log out")}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        <Script id="ui-admin-ux" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var doc=document; if(doc.documentElement.dataset.adminUxBound==='1') return; doc.documentElement.dataset.adminUxBound='1'; var pressCls='ui-press-slate'; var lastH=0; var haptic=function(){try{var now=Date.now(); if(now-lastH<60) return; lastH=now; if(navigator&&typeof navigator.vibrate==='function') navigator.vibrate(8);}catch(_){}}; var onTouchStart=function(e){var t=e.target; if(!t||!t.closest) return; var el=t.closest('.btn-press,button,a'); if(!el) return; haptic(); if(el.classList&&el.classList.contains('btn-press')&&!el.hasAttribute('data-no-press')){el.classList.add(pressCls); var clear=function(){try{el.classList.remove(pressCls);}catch(_){} doc.removeEventListener('touchend',clear,true); doc.removeEventListener('touchcancel',clear,true);}; doc.addEventListener('touchend',clear,true); doc.addEventListener('touchcancel',clear,true); setTimeout(clear,180);} }; doc.addEventListener('touchstart',onTouchStart,{passive:true,capture:true}); var bindSwipe=function(){try{if(window.innerWidth>=768) return; var enabled=false; try{enabled=localStorage.getItem('esop_admin_swipe')==='1';}catch(_){enabled=false;} if(!enabled) return; var cards=doc.querySelectorAll('[data-swipe-card]'); for(var i=0;i<cards.length;i++){(function(card){var surface=card.querySelector('[data-swipe-surface]'); if(!surface||surface.dataset.swipeBound==='1') return; surface.dataset.swipeBound='1'; var sx=0,sy=0,dx=0,active=false; var start=function(ev){if(!ev.touches||ev.touches.length!==1) return; active=false; dx=0; sx=ev.touches[0].clientX; sy=ev.touches[0].clientY; surface.style.transition='';}; var move=function(ev){if(!ev.touches||ev.touches.length!==1) return; var cx=ev.touches[0].clientX; var cy=ev.touches[0].clientY; var ndx=cx-sx; var ndy=cy-sy; if(!active){if(Math.abs(ndx)>12&&Math.abs(ndx)>Math.abs(ndy)+6){active=true; surface.style.transition='none';} else {return;}} ev.preventDefault(); dx=ndx; surface.style.transform='translateX('+dx+'px)';}; var end=function(){if(!surface) return; surface.style.transition='transform 160ms ease-out'; var goRight=dx>80; var goLeft=dx<-80; surface.style.transform='translateX(0px)'; dx=0; active=false; if(goRight){var btn=surface.querySelector('[data-swipe-right]'); if(btn&&btn.click) btn.click();} else if(goLeft){var btn2=surface.querySelector('[data-swipe-left]'); if(btn2&&btn2.click) btn2.click();}}; surface.addEventListener('touchstart',start,{passive:true}); surface.addEventListener('touchmove',move,{passive:false}); surface.addEventListener('touchend',end,{passive:true}); surface.addEventListener('touchcancel',end,{passive:true});})(cards[i]);}}catch(_){}}; bindSwipe(); window.addEventListener('resize',bindSwipe); }catch(_){}})();",
          }}
        />
        <Script id="ui-admin-bulk-ux" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var doc=document; if(doc.documentElement.dataset.bulkUxBound==='1') return; doc.documentElement.dataset.bulkUxBound='1'; var ids=['bulkExercises','bulkBuybacks']; var byId=function(id){return doc.getElementById(id);}; var setDisabled=function(btn,disabled){try{btn.disabled=!!disabled; if(disabled){btn.classList.add('opacity-50');} else {btn.classList.remove('opacity-50');}}catch(_){}}; var update=function(form){try{var boxes=form.querySelectorAll('input[type=checkbox][name=\"ids\"]'); var selected=0; var pending=0; var funded=0; for(var i=0;i<boxes.length;i++){var b=boxes[i]; if(!b||!b.checked) continue; selected+=1; var st=(b.getAttribute('data-st')||'').toUpperCase(); if(st==='PENDING') pending+=1; if(st==='FUNDED') funded+=1;} var countEl=doc.querySelector('[data-bulk-count=\"'+form.id+'\"]'); if(countEl) countEl.textContent=String(selected); var menuBtns=form.querySelectorAll('button[data-bulk-op]'); for(var j=0;j<menuBtns.length;j++){var btn=menuBtns[j]; var op=String(btn.getAttribute('data-bulk-op')||''); var enable=selected>0; if(op==='fund') enable=pending>0; if(op==='complete') enable=funded>0; setDisabled(btn,!enable);} }catch(_){}}; for(var k=0;k<ids.length;k++){var f=byId(ids[k]); if(!f) continue; update(f); f.addEventListener('change',function(ev){try{var t=ev.target; if(!t||t.name!=='ids') return; update(ev.currentTarget);}catch(_){}} ,true);} doc.addEventListener('click',function(ev){try{var t=ev.target; if(!t||!t.closest) return; var sel=t.closest('button[data-bulk-select]'); if(sel){var formId=String(sel.getAttribute('data-bulk-form')||''); var mode=String(sel.getAttribute('data-bulk-select')||''); var form=byId(formId); if(!form) return; ev.preventDefault(); var boxes=form.querySelectorAll('input[type=checkbox][name=\"ids\"]'); for(var i=0;i<boxes.length;i++){boxes[i].checked=(mode==='all');} update(form); return;} var opBtn=t.closest('form#bulkExercises button[data-bulk-op], form#bulkBuybacks button[data-bulk-op]'); if(opBtn){var form=opBtn.form; if(form){form.dataset.bulkOp=String(opBtn.getAttribute('data-bulk-op')||'');} try{var det=opBtn.closest('details'); if(det) det.removeAttribute('open');}catch(_){}} }catch(_){}} ,true); doc.addEventListener('submit',function(ev){try{var form=ev.target; if(!form||!form.getAttribute) return; if(form.id!=='bulkExercises'&&form.id!=='bulkBuybacks') return; var op=String(form.dataset.bulkOp||''); var countEl=doc.querySelector('[data-bulk-count=\"'+form.id+'\"]'); var selected=countEl?Number(countEl.textContent||0):0; if(!op||!(selected>0)){ev.preventDefault(); ev.stopPropagation(); return;} if(op==='fund'||op==='complete'){try{form.setAttribute('data-undo','1'); form.setAttribute('data-undo-btn','撤销'); form.setAttribute('data-undo-title',op==='fund'?('将批量标记已打款 '+selected+' 条'):('将批量完成 '+selected+' 条'));}catch(_){}} }catch(_){}} ,true);}catch(_){}})();",
          }}
        />
      </>
    );
  }

  return (
    <div data-wm-bg={watermarkBg} className="flex min-h-[100dvh] w-full max-w-full flex-1 flex-col overflow-x-hidden overscroll-x-none bg-[#f8fafc] px-4 pb-5 pt-0 sm:px-6 sm:pb-8 sm:pt-8">
      {renderToasts()}
      <div
        id="ui-watermark"
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-30"
        style={{
          backgroundImage: watermarkBg,
          backgroundRepeat: "repeat",
          backgroundSize: "420px 280px",
          opacity: 0.12,
        }}
      />
      <Script id="ui-admin-watermark" strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html:
            "(function(){try{var doc=document; if(doc.documentElement.dataset.wmBound==='1') return; doc.documentElement.dataset.wmBound='1'; var getBg=function(){var root=doc.querySelector('[data-wm-bg]'); return root?root.getAttribute('data-wm-bg')||'':'';}; var ensure=function(){var bg=getBg(); if(!bg) return; var wm=doc.getElementById('ui-watermark'); if(!wm){wm=doc.createElement('div'); wm.id='ui-watermark'; wm.setAttribute('aria-hidden','true'); wm.style.position='fixed'; wm.style.inset='0'; wm.style.zIndex='30'; wm.style.pointerEvents='none'; doc.body.appendChild(wm);} wm.style.backgroundImage=bg; wm.style.backgroundRepeat='repeat'; wm.style.backgroundSize='420px 280px'; wm.style.opacity='0.12';}; ensure(); new MutationObserver(function(){ensure();}).observe(doc.body,{childList:true});}catch(_){}})();",
        }}
      />
      <div className="mx-auto w-full max-w-6xl max-w-full overflow-x-hidden md:max-w-[76rem]">
        {renderChrome()}

        {renderApprovalsSection()}
        {renderPoolWorkbenchSection()}
        {renderOpsSection()}
        {renderLedgerSection()}
      </div>
    </div>
  );
}
