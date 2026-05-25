import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import { prisma } from "@/lib/prisma";
import { CurrencyCode, Prisma } from "@prisma/client";
import { getSessionSecret, verifySession } from "@/lib/auth";
import { changePassword, logout } from "@/app/actions/session";
import { getDomainError, submitEmployeeExercise } from "@/lib/exerciseSubmit";
import { matureVestingRecords, verifyUsdtPaymentByTxHash } from "@/lib/esop";
import { meUrlWith, safeMeReturnTo } from "@/lib/meUrl";
import { fileToImageDataUrl, readImageFileFromFormData } from "@/lib/imageDataUrl";
import {
  AnimatedProgressBar,
  BackButton,
  CopyButton,
  CurrencyLangSwitcher,
  EquityAreaChart,
  ExerciseRequestForm,
  LiveCompanySharePrice,
  LiveSharePriceAvg30,
  PrivacyToggleButton,
  VisionTotalOptionValue,
} from "@/app/ClientAnimations";
import { computeSharePriceSeries } from "@/lib/sharePrice";
import { BUSINESS_TIMEZONE, ymdInTimeZone } from "@/lib/datetime";

type Currency = "USD" | "HKD" | "CNY";
type Lang = "zh-CN" | "zh-TW" | "en";
type UsdtChain = "BNB" | "TRX";

const exerciseRequestSelect = {
  id: true,
  grantId: true,
  requestedShares: true,
  totalCost: true,
  status: true,
  lockupUntil: true,
  createdAt: true,
  completedAt: true,
  paymentChain: true,
  paymentToAddress: true,
  paymentTxHash: true,
  paymentAmountUsdt: true,
  paymentCheckedAt: true,
  paymentVerifiedAt: true,
  paymentCheckError: true,
  paymentProofDataUrl: true,
  paymentProofUploadedByRole: true,
  paymentProofConfirmedAt: true,
  paymentRaw: true,
  grant: { select: { agreementNo: true, strikePrice: true } },
} satisfies Prisma.ExerciseRequestSelect;

type ExerciseRequestRow = Prisma.ExerciseRequestGetPayload<{
  select: typeof exerciseRequestSelect;
}>;

function jsonObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function readAllocationFromPaymentRaw(paymentRaw: unknown) {
  const root = jsonObj(paymentRaw);
  const alloc = root["allocation"];
  if (!Array.isArray(alloc)) return [] as Array<{ grantId: string; shares: number; lockupPeriodMonths?: number }>;
  const out: Array<{ grantId: string; shares: number; lockupPeriodMonths?: number }> = [];
  for (const it of alloc) {
    const o = jsonObj(it);
    const grantId = String(o["grantId"] ?? o["id"] ?? "").trim();
    const shares = Math.floor(Number(o["shares"]));
    const lockupPeriodMonthsRaw = Number(o["lockupPeriodMonths"]);
    const lockupPeriodMonths = Number.isFinite(lockupPeriodMonthsRaw) ? Math.max(0, Math.floor(lockupPeriodMonthsRaw)) : undefined;
    if (!grantId || !Number.isFinite(shares) || shares <= 0) continue;
    out.push({ grantId, shares, ...(typeof lockupPeriodMonths === "number" ? { lockupPeriodMonths } : {}) });
  }
  return out;
}

function parseLang(v: string | undefined): Lang {
  if (v === "zh-TW" || v === "en" || v === "zh-CN") return v;
  return "zh-CN";
}

const TEXT = {
  "zh-CN": {
    active: "在职",
    terminated: "离职",
    titleSuffix: "财富仪表盘",
    pricing: "计价切换",
    logout: "退出登录",
    changePassword: "修改密码",
    vestedShares: "当前已成熟股数",
    totalOptionValue: "我的期权总价值",
    optionValueFormula: "股价 ×（已成熟 + 未成熟）",
    floatingProfit: "我的当前浮盈价值",
    formula: "(股价 - 行权价) × 已成熟",
    vestingProgress: "期权成熟进度",
    readOnlyTitle: "权限说明",
    readOnlyBody: "查看授予与成熟进度；已成熟可申请行权。",
    marketRef: "股票信息（管理员设置）",
    ticker: "股票代码",
    sharePrice: "当前股价",
    avg30: "近30日均价",
    baseCurrency: "基准币种",
    updatedAt: "更新时间",
    autoUpdating: "自动更新",
    autoUpdateHint: "美股开盘约 15 秒/次；非开盘约 1 小时/次。",
    noTicker: "管理员尚未设置股票代码。",
    exercise: "申请行权",
    exerciseTitle: "行权申请",
    exerciseHint:
      "填行权股数 → 按地址打款 USDT → 填 TxHash 或上传截图提交 →（有 TxHash 时）可点“检查到账”校验。",
    viewCertificate: "查看权证",
    exerciseRecords: "行权记录",
    exerciseRecordsDesc: "可查看每次打款与系统核验结果。",
    status: "状态",
    agreement: "协议",
    shares: "股数",
    cost: "行权成本",
    txHash: "TxHash",
    chain: "链",
    verifiedAt: "核验时间",
    lockupUntil: "锁定到期",
    pending: "待确认（等待管理员）",
    funded: "待确认（可检查到账）",
    completed: "已行权完成",
    checkNow: "检查到账",
    submitted: "已提交凭证，等待确认。",
    paidNotFound: "未检测到到账，可稍后重试。",
    missingPayInfo: "管理员尚未配置 USDT 收款信息。",
    invalidTx: "TxHash 格式不正确。",
    txUsed: "该 TxHash 已被使用，请核对后再提交。",
    exerciseDone: "已检测到账，行权已完成。",
  },
  "zh-TW": {
    active: "在職",
    terminated: "離職",
    titleSuffix: "財富儀表板",
    pricing: "計價切換",
    logout: "退出登入",
    changePassword: "修改密碼",
    vestedShares: "目前已成熟股數",
    totalOptionValue: "我的期權總價值",
    optionValueFormula: "股價 ×（已成熟 + 未成熟）",
    floatingProfit: "目前浮盈價值",
    formula: "(股價 - 行權價) × 已成熟",
    vestingProgress: "期權成熟進度",
    readOnlyTitle: "權限說明",
    readOnlyBody: "查看授予與成熟進度；已成熟可申請行權。",
    marketRef: "股票資訊（管理員設定）",
    ticker: "股票代碼",
    sharePrice: "目前股價",
    avg30: "近30日均價",
    baseCurrency: "基準幣種",
    updatedAt: "更新時間",
    autoUpdating: "自動更新",
    autoUpdateHint: "美股開盤約 15 秒/次；非開盤約 1 小時/次。",
    noTicker: "管理員尚未設定股票代碼。",
    exercise: "申請行權",
    exerciseTitle: "行權申請",
    exerciseHint:
      "填行權股數 → 按地址打款 USDT → 填 TxHash 或上傳截圖提交 →（有 TxHash 時）可點「檢查到帳」校驗。",
    viewCertificate: "查看權證",
    exerciseRecords: "行權記錄",
    exerciseRecordsDesc: "可查看每次打款與系統核驗結果。",
    status: "狀態",
    agreement: "協議",
    shares: "股數",
    cost: "行權成本",
    txHash: "TxHash",
    chain: "鏈",
    verifiedAt: "核驗時間",
    lockupUntil: "鎖定到期",
    pending: "待確認（等待管理員）",
    funded: "待確認（可檢查到帳）",
    completed: "已行權完成",
    checkNow: "檢查到帳",
    submitted: "已提交憑證，等待確認。",
    paidNotFound: "未檢測到到帳，可稍後重試。",
    missingPayInfo: "管理員尚未配置 USDT 收款資訊。",
    invalidTx: "TxHash 格式不正確。",
    txUsed: "此 TxHash 已被使用，請核對後再提交。",
    exerciseDone: "已檢測到到帳，行權已完成。",
  },
  en: {
    active: "Active",
    terminated: "Terminated",
    titleSuffix: "Dashboard",
    pricing: "Pricing",
    logout: "Log out",
    changePassword: "Change password",
    vestedShares: "Vested shares",
    totalOptionValue: "Total option value",
    optionValueFormula: "Price × (vested + unvested)",
    floatingProfit: "Estimated profit",
    formula: "(Price - strike) × vested",
    vestingProgress: "Vesting progress",
    readOnlyTitle: "Permissions",
    readOnlyBody: "View grants/vesting. Exercise is available for vested shares.",
    marketRef: "Share Info (Admin Settings)",
    ticker: "Ticker",
    sharePrice: "Share price",
    avg30: "30d avg",
    baseCurrency: "Base currency",
    updatedAt: "Updated at",
    autoUpdating: "Auto",
    autoUpdateHint: "US market hours: ~15s; otherwise: ~1h.",
    noTicker: "Ticker is not configured by admin.",
    exercise: "Exercise",
    exerciseTitle: "Exercise request",
    exerciseHint:
      "Enter shares → pay USDT → paste Tx hash or upload a screenshot → submit → (with TxHash) “Check payment” to verify.",
    viewCertificate: "View certificate",
    exerciseRecords: "Exercise history",
    exerciseRecordsDesc: "Payment details and verification results.",
    status: "Status",
    agreement: "Grant",
    shares: "Shares",
    cost: "Exercise cost",
    txHash: "TxHash",
    chain: "Chain",
    verifiedAt: "Verified at",
    lockupUntil: "Lockup until",
    pending: "Pending (manual review)",
    funded: "Pending confirmation (can check)",
    completed: "Completed",
    checkNow: "Check payment",
    submitted: "Proof submitted. Waiting for confirmation.",
    paidNotFound: "Payment not found yet. Please retry later.",
    missingPayInfo: "USDT receiving info is not configured by admin.",
    invalidTx: "Invalid Tx hash format.",
    txUsed: "This Tx hash was already used. Please double-check.",
    exerciseDone: "Payment verified. Exercise completed.",
  },
} as const;

function formatInt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function parseCurrency(v: string | undefined): Currency {
  if (v === "HKD" || v === "CNY" || v === "USD") return v;
  return "USD";
}

function currencyRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

function convertMoney(amount: Prisma.Decimal, from: Currency, to: Currency) {
  if (from === to) return amount;
  const fromRate = currencyRate(from);
  const usd = from === "USD" ? amount : amount.div(fromRate);
  const toRate = currencyRate(to);
  return to === "USD" ? usd : usd.mul(toRate);
}

function addMonths(base: Date, months: number) {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) {
    d.setDate(0);
  }
  return d;
}

async function submitExercisePayment(formData: FormData) {
  "use server";
  const spLang = String(formData.get("lang") ?? "").trim() || undefined;
  const lang = parseLang(spLang);
  const returnTo = safeMeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/me";

  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const employeeId = payload?.eid ?? "";
  if (!payload || payload.role !== "EMPLOYEE" || !employeeId) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }

  const sessionUser = (await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      role: true;
      sessionVersion: true;
    },
  })) as unknown as { id: string; role: string; sessionVersion: number } | null;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!sessionUser || sessionUser.role !== "EMPLOYEE" || payloadSv !== sessionUser.sessionVersion) {
    redirect(lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`);
  }

  const shares = Math.floor(Number(formData.get("shares")));
  const chainRaw = String(formData.get("chain") ?? "").trim();
  const chain: UsdtChain = chainRaw === "BNB" || chainRaw === "TRX" ? (chainRaw as UsdtChain) : "BNB";
  const txHash = String(formData.get("txHash") ?? "").trim();
  const amountUsdtRaw = String(formData.get("amountUsdt") ?? "").trim();

  try {
    const proofFile = readImageFileFromFormData(formData, "paymentProof");
    const paymentProofDataUrl = proofFile ? await fileToImageDataUrl(proofFile, { maxBytes: 900 * 1024 }) : "";
    const result = await submitEmployeeExercise({
      userId: payload.uid,
      employeeId,
      returnTo,
      shares,
      chain,
      txHash,
      paymentProofDataUrl,
      amountUsdtRaw,
    });
    redirect(result.redirectTo);
  } catch (e) {
    const domain = getDomainError(e);
    if (domain) {
      redirect(meUrlWith(returnTo, { err: domain.code }));
    }
    throw e;
  }
}

async function checkExercisePayment(formData: FormData) {
  "use server";
  const spLang = String(formData.get("lang") ?? "").trim() || undefined;
  const lang = parseLang(spLang);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeMeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/me";

  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const employeeId = payload?.eid ?? "";
  if (!payload || payload.role !== "EMPLOYEE" || !employeeId) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }

  const sessionUser = (await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      role: true;
      sessionVersion: true;
    },
  })) as unknown as { id: string; role: string; sessionVersion: number } | null;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!sessionUser || sessionUser.role !== "EMPLOYEE" || payloadSv !== sessionUser.sessionVersion) {
    redirect(lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`);
  }

  if (!id) redirect(returnTo);

  const existing = await prisma.exerciseRequest.findFirst({
    where: { id, employeeId, isBuybackOrCancel: false },
    select: {
      id: true,
      status: true,
      grantId: true,
      paymentRaw: true,
      paymentChain: true,
      paymentToAddress: true,
      paymentTxHash: true,
      paymentAmountUsdt: true,
    },
  });
  if (!existing) redirect(meUrlWith(returnTo, { err: "NO_REQUEST" }));
  if (existing.status === "COMPLETED") {
    redirect(meUrlWith(returnTo, { modal: "exercise_detail", rid: id, err: "EXERCISE_COMPLETED" }));
  }

  const chain = (existing.paymentChain ?? "") as UsdtChain | "";
  const toAddress = String(existing.paymentToAddress ?? "").trim();
  const txHash = String(existing.paymentTxHash ?? "").trim();
  const expectedUsdt = existing.paymentAmountUsdt ?? null;
  if (!chain || (chain !== "BNB" && chain !== "TRX") || !toAddress || !txHash || !expectedUsdt) {
    redirect(meUrlWith(returnTo, { modal: "exercise_detail", rid: id, err: "MISSING_PAYMENT_DATA" }));
  }

  const check = await verifyUsdtPaymentByTxHash({
    chain,
    txHash,
    toAddress,
    expectedUsdt,
  });

  if (!check.ok) {
    const mergedRaw = { ...jsonObj(existing.paymentRaw), paymentCheck: check.raw ?? null } as unknown as Prisma.JsonObject;
    await prisma.exerciseRequest.update({
      where: { id },
      data: {
        paymentCheckedAt: check.checkedAt,
        paymentCheckError: check.error,
        paymentRaw: mergedRaw,
      },
    });
    const err = check.error === "PAYMENT_NOT_FOUND" ? "PAYMENT_NOT_FOUND" : check.error;
    redirect(meUrlWith(returnTo, { modal: "exercise_detail", rid: id, err }));
  }

  const alloc = readAllocationFromPaymentRaw(existing.paymentRaw);
  const allocLockupMax = alloc.reduce((m, a) => Math.max(m, Number(a.lockupPeriodMonths ?? 0)), 0);
  const lockupMonths =
    allocLockupMax > 0
      ? allocLockupMax
      : existing.grantId
        ? Number((await prisma.grant.findUnique({ where: { id: existing.grantId }, select: { lockupPeriodMonths: true } }))?.lockupPeriodMonths ?? 0)
        : 0;
  const lockupUntil = lockupMonths > 0 ? addMonths(new Date(), lockupMonths) : null;

  const mergedRaw = { ...jsonObj(existing.paymentRaw), paymentCheck: check.raw ?? null } as unknown as Prisma.JsonObject;
  await prisma.exerciseRequest.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      lockupUntil,
      paymentCheckedAt: check.checkedAt,
      paymentVerifiedAt: check.checkedAt,
      paymentCheckError: null,
      paymentRaw: mergedRaw,
    },
  });

  redirect(meUrlWith(returnTo, { modal: "exercise_detail", rid: id, err: "EXERCISE_COMPLETED" }));
}

async function confirmBuybackPayment(formData: FormData) {
  "use server";
  const spLang = String(formData.get("lang") ?? "").trim() || undefined;
  const lang = parseLang(spLang);
  const id = String(formData.get("id") ?? "").trim();
  const returnTo = safeMeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/me";

  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const employeeId = payload?.eid ?? "";
  if (!payload || payload.role !== "EMPLOYEE" || !employeeId) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }

  const sessionUser = (await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      role: true;
      sessionVersion: true;
    },
  })) as unknown as { id: string; role: string; sessionVersion: number } | null;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!sessionUser || sessionUser.role !== "EMPLOYEE" || payloadSv !== sessionUser.sessionVersion) {
    redirect(lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`);
  }

  if (!id) redirect(returnTo);

  const existing = await prisma.exerciseRequest.findFirst({
    where: { id, employeeId, isBuybackOrCancel: true },
    select: {
      id: true,
      status: true,
      paymentProofDataUrl: true,
      paymentProofUploadedByRole: true,
      paymentProofConfirmedAt: true,
    },
  });
  if (!existing) redirect(meUrlWith(returnTo, { err: "NO_REQUEST" }));
  if (existing.status === "COMPLETED") redirect(meUrlWith(returnTo, { err: "BUYBACK_CONFIRMED" }));

  const proof = String(existing.paymentProofDataUrl ?? "").trim();
  const uploader = String(existing.paymentProofUploadedByRole ?? "").trim();
  if (!proof || uploader === "EMPLOYEE") redirect(meUrlWith(returnTo, { err: "MISSING_PAYMENT_PROOF" }));
  if (existing.paymentProofConfirmedAt) redirect(meUrlWith(returnTo, { err: "BUYBACK_CONFIRMED" }));

  const now = new Date();
  await prisma.exerciseRequest.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: now,
      lockupUntil: null,
      paymentCheckedAt: now,
      paymentVerifiedAt: now,
      paymentCheckError: null,
      paymentProofConfirmedAt: now,
      paymentProofConfirmedByRole: "EMPLOYEE",
    },
  });

  redirect(meUrlWith(returnTo, { err: "BUYBACK_CONFIRMED" }));
}

function formatMoney(d: Prisma.Decimal, currency: Currency, baseCurrency: Currency) {
  const converted = convertMoney(d, baseCurrency, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(converted.toFixed(2)));
}

function formatPaymentCheckError(err: string | null | undefined, lang: Lang) {
  const e = String(err ?? "").trim();
  if (!e) return "";
  if (e === "PAYMENT_NOT_FOUND") {
    return lang === "en"
      ? "No matching USDT transfer found on-chain. Please double-check chain / TxHash / recipient."
      : lang === "zh-TW"
        ? "鏈上未找到符合條件的 USDT 轉帳，請確認網路 / TxHash / 收款地址。"
        : "链上未找到符合条件的 USDT 转账，请确认网络 / TxHash / 收款地址。";
  }
  if (e === "TX_NOT_FOUND") {
    return lang === "en" ? "TxHash not found on-chain." : lang === "zh-TW" ? "鏈上未找到該 TxHash。" : "链上未找到该 TxHash。";
  }
  if (e === "TX_FAILED") {
    return lang === "en"
      ? "Transaction failed on-chain."
      : lang === "zh-TW"
        ? "鏈上交易狀態為失敗。"
        : "链上交易状态为失败。";
  }
  if (e.startsWith("TRON_API_") || e.startsWith("BSC_RPC_")) {
    return lang === "en"
      ? "Chain RPC/API error. Please retry later."
      : lang === "zh-TW"
        ? "鏈上查詢服務異常，請稍後重試。"
        : "链上查询服务异常，请稍后重试。";
  }
  return e;
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

export default async function MeDashboard({
  searchParams,
}: {
  searchParams?: Promise<{ ccy?: string; lang?: string; modal?: string; err?: string; rid?: string; gid?: string; hp?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const currency = parseCurrency((sp.ccy ?? "").trim() || undefined);
  const lang = parseLang((sp.lang ?? "").trim() || undefined);
  const modal = (sp.modal ?? "").trim();
  const err = (sp.err ?? "").trim();
  const rid = (sp.rid ?? "").trim();
  const gid = (sp.gid ?? "").trim();
  const historyPageRaw = (sp.hp ?? "").trim();
  const historyPage = Math.max(1, Math.floor(Number(historyPageRaw || "1") || 1));
  const historyPageSize = 20;
  const historySkip = (historyPage - 1) * historyPageSize;
  const t = TEXT[lang];
  const logoutHref = `/logout?next=${encodeURIComponent(lang === "zh-CN" ? "/" : `/?lang=${encodeURIComponent(lang)}`)}`;

  const exerciseSubmittedDismissHref = meUrlWith(meModalHref({ modal: "exercise" }), { err: null, rid: null });
  const exerciseSubmittedDetailHref = rid
    ? meUrlWith(meModalHref({}), { modal: "exercise_detail", rid, err: null })
    : "";

  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  const employeeId = payload?.eid ?? "";
  if (!payload || payload.role !== "EMPLOYEE" || !employeeId) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }

  await matureVestingRecords(new Date());

  function meHref(params: { ccy?: Currency; lang?: Lang }) {
    const p = new URLSearchParams();
    const c = params.ccy ?? currency;
    const lg = params.lang ?? lang;
    if (c && c !== "USD") p.set("ccy", c);
    if (lg && lg !== "zh-CN") p.set("lang", lg);
    const qs = p.toString();
    return qs ? `/me?${qs}` : "/me";
  }

  function meModalHref(params: { modal?: string; err?: string }) {
    const p = new URLSearchParams();
    if (currency !== "USD") p.set("ccy", currency);
    if (lang !== "zh-CN") p.set("lang", lang);
    if (params.modal) p.set("modal", params.modal);
    if (params.err) p.set("err", params.err);
    const qs = p.toString();
    return qs ? `/me?${qs}` : "/me";
  }

  const sessionUser = (await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, role: true, sessionVersion: true } as unknown as {
      id: true;
      role: true;
      sessionVersion: true;
    },
  })) as unknown as { id: string; role: string; sessionVersion: number } | null;
  const payloadSv = typeof payload.sv === "number" ? payload.sv : 0;
  if (!sessionUser || sessionUser.role !== "EMPLOYEE" || payloadSv !== sessionUser.sessionVersion) {
    redirect(lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`);
  }

  const [employee, settings, grants, vestedAgg, grantAgg, unvestedAgg, forfeitedAgg, buybacksToConfirm, exerciseRequests, exerciseRequestCount] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        department: true,
        status: true,
        terminatedAt: true,
        updatedAt: true,
        user: { select: { account: true, email: true } },
      },
    }),
    prisma.globalSettings.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        companySharePrice: true,
        brandLogoDataUrl: true,
        companyName: true,
        sharePriceCurrency: true,
        sharePriceTicker: true,
        sharePriceAvg30Usd: true,
        updatedAt: true,
        usdtBnbAddress: true,
        usdtTrxAddress: true,
        terminationOptionExpiryDays: true,
      } as unknown as {
        companySharePrice: true;
        brandLogoDataUrl: true;
        companyName: true;
        sharePriceCurrency: true;
        sharePriceTicker: true;
        sharePriceAvg30Usd: true;
        updatedAt: true;
        usdtBnbAddress: true;
        usdtTrxAddress: true;
        terminationOptionExpiryDays: true;
      },
    }),
    prisma.grant.findMany({
      where: { employeeId },
      orderBy: { grantDate: "desc" },
      include: {
        vestingRecords: {
          orderBy: { vestDate: "asc" },
          select: { vestDate: true, shares: true, status: true },
        },
      },
    }),
    prisma.vestingRecord.aggregate({
      where: { employeeId, status: "VESTED" },
      _sum: { shares: true },
    }),
    prisma.grant.aggregate({
      where: { employeeId },
      _sum: { totalShares: true },
    }),
    prisma.vestingRecord.aggregate({
      where: { employeeId, status: "UNVESTED" },
      _sum: { shares: true },
    }),
    prisma.vestingRecord.aggregate({
      where: { employeeId, status: "FORFEITED" },
      _sum: { shares: true },
    }),
    prisma.exerciseRequest.findMany({
      where: {
        employeeId,
        isBuybackOrCancel: true,
        status: "FUNDED",
        paymentProofDataUrl: { not: null },
        paymentProofConfirmedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        requestedShares: true,
        totalCost: true,
        createdAt: true,
        paymentProofDataUrl: true,
        paymentProofUploadedAt: true,
      },
      take: 10,
    }),
    prisma.exerciseRequest.findMany({
      where: { employeeId, isBuybackOrCancel: false },
      orderBy: { createdAt: "desc" },
      select: exerciseRequestSelect,
      take: historyPageSize,
      skip: historySkip,
    }),
    prisma.exerciseRequest.count({ where: { employeeId, isBuybackOrCancel: false } }),
  ]);

  if (!employee) {
    const next = lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
    redirect(`/logout?next=${encodeURIComponent(next)}`);
  }

  const baseCurrency =
    ((settings as unknown as { sharePriceCurrency?: Currency | null } | null)?.sharePriceCurrency ??
      "USD") as Currency;
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
  const brandLogoDataUrl = String(((settings as unknown as { brandLogoDataUrl?: string | null } | null)?.brandLogoDataUrl ?? "") || "").trim();
  const companyName = String(((settings as unknown as { companyName?: string | null } | null)?.companyName ?? "") || "").trim();
  const sharePriceTicker =
    String(((settings as unknown as { sharePriceTicker?: string | null } | null)?.sharePriceTicker ?? "") || "").trim();
  const sharePriceAvg30Usd =
    ((settings as unknown as { sharePriceAvg30Usd?: Prisma.Decimal | null } | null)?.sharePriceAvg30Usd ??
      null) || null;
  const sharePriceUpdatedAt =
    useManualCompanySharePrice && manualCompanySharePriceUpdatedAt ? manualCompanySharePriceUpdatedAt : settings?.updatedAt ?? null;
  const usdtBnbAddress = String(settings?.usdtBnbAddress ?? "").trim();
  const usdtTrxAddress = String(settings?.usdtTrxAddress ?? "").trim();
  const vestedShares = vestedAgg._sum.shares ?? 0;
  const totalGranted = grantAgg._sum.totalShares ?? 0;
  const unvestedShares = unvestedAgg._sum.shares ?? 0;
  const forfeitedShares = forfeitedAgg._sum.shares ?? 0;
  const terminationOptionExpiryDays = (settings?.terminationOptionExpiryDays ?? 90) as number;
  const progress = totalGranted > 0 ? Math.min(vestedShares / totalGranted, 1) : 0;
  const exerciseHistoryTotalPages = Math.max(1, Math.ceil((exerciseRequestCount ?? 0) / historyPageSize));

  const vestedByGrant = await prisma.vestingRecord.groupBy({
    by: ["grantId"],
    where: { employeeId, status: "VESTED" },
    _sum: { shares: true },
  });
  const unvestedByGrant = await prisma.vestingRecord.groupBy({
    by: ["grantId"],
    where: { employeeId, status: "UNVESTED" },
    _sum: { shares: true },
  });
  const vestedByGrantMap = new Map(
    vestedByGrant.map((g) => [g.grantId, g._sum.shares ?? 0] as const),
  );
  const unvestedByGrantMap = new Map(
    unvestedByGrant.map((g) => [g.grantId, g._sum.shares ?? 0] as const),
  );

  const strikeByGrant = new Map(
    grants.map((g) => [g.id, g.strikePrice] as const),
  );

  const now = new Date();
  const lockedByGrant = new Map<string, number>();
  for (const r of exerciseRequests) {
    if (r.status !== "COMPLETED") continue;
    const gid = String(r.grantId ?? "");
    if (!gid) continue;
    const lockupUntil = r.lockupUntil ? new Date(r.lockupUntil) : null;
    if (!lockupUntil || lockupUntil.getTime() <= now.getTime()) continue;
    const shares = Number(r.requestedShares ?? 0);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    lockedByGrant.set(gid, (lockedByGrant.get(gid) ?? 0) + shares);
  }

  const optionValueBreakdown = vestedByGrant.reduce(
    (acc, g) => {
      const vested = g._sum.shares ?? 0;
      const locked = Math.min(vested, lockedByGrant.get(g.grantId) ?? 0);
      const unlocked = Math.max(0, vested - locked);
      acc.vestedLockedShares += locked;
      acc.vestedUnlockedShares += unlocked;
      acc.vestedLockedValue = acc.vestedLockedValue.add(companySharePrice.mul(locked));
      acc.vestedUnlockedValue = acc.vestedUnlockedValue.add(companySharePrice.mul(unlocked));
      return acc;
    },
    {
      vestedLockedShares: 0,
      vestedUnlockedShares: 0,
      vestedLockedValue: new Prisma.Decimal(0),
      vestedUnlockedValue: new Prisma.Decimal(0),
    },
  );

  const unvestedOption = unvestedByGrant.reduce(
    (acc, g) => {
      const shares = g._sum.shares ?? 0;
      acc.unvestedShares += shares;
      acc.unvestedValue = acc.unvestedValue.add(companySharePrice.mul(shares));
      return acc;
    },
    { unvestedShares: 0, unvestedValue: new Prisma.Decimal(0) },
  );

  const vestedOptionValue = optionValueBreakdown.vestedLockedValue.add(optionValueBreakdown.vestedUnlockedValue);
  const totalOptionValue = vestedOptionValue.add(unvestedOption.unvestedValue);
  const totalOptionShares =
    optionValueBreakdown.vestedLockedShares + optionValueBreakdown.vestedUnlockedShares + unvestedOption.unvestedShares;


  const msPerDay = 24 * 60 * 60 * 1000;
  const vestedEventsByDate = new Map<string, number>();
  for (const g of grants) {
    for (const vr of g.vestingRecords) {
      if (vr.status !== "VESTED") continue;
      const date = ymdInTimeZone(vr.vestDate, BUSINESS_TIMEZONE);
      vestedEventsByDate.set(date, (vestedEventsByDate.get(date) ?? 0) + Number(vr.shares ?? 0));
    }
  }
  const vestedEvents = Array.from(vestedEventsByDate.entries())
    .map(([date, shares]) => ({ date, shares: Math.max(0, Math.floor(Number(shares) || 0)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const earliestVestedDate = vestedEvents[0]?.date ?? "";
  const allDays =
    earliestVestedDate && !Number.isNaN(new Date(`${earliestVestedDate}T00:00:00.000Z`).getTime())
      ? Math.max(
          30,
          Math.min(
            3650,
            Math.ceil((now.getTime() - new Date(`${earliestVestedDate}T00:00:00.000Z`).getTime()) / msPerDay) + 14,
          ),
        )
      : 90;
  const cutoffIso = ymdInTimeZone(new Date(now.getTime() - allDays * msPerDay), BUSINESS_TIMEZONE);
  const todayIso = ymdInTimeZone(now, BUSINESS_TIMEZONE);

  let equityCurvePoints: Array<{ date: string; vestedShares: number; sharePriceBase: number; value: number }> = [];
  if (sharePriceTicker) {
    const cached = await prisma.sharePriceHistory.findMany({
      where: { ticker: sharePriceTicker, date: { gte: cutoffIso } },
      orderBy: { date: "asc" },
      select: { date: true, close: true, currency: true },
    });
    const merged = new Map<string, { close: Prisma.Decimal; currency: Currency }>();
    cached.forEach((r) => {
      merged.set(r.date, { close: r.close, currency: r.currency as unknown as Currency });
    });

    const lastCachedDate = cached[cached.length - 1]?.date ?? "";
    const needFetch = cached.length < 2 || lastCachedDate < todayIso;
    if (needFetch) {
      try {
        const fetchDays = process.env.NODE_ENV === "production" ? allDays : Math.min(allDays, 260);
        const fetched = await computeSharePriceSeries({ sharePriceTicker, tradingDays: fetchDays });
        const existing = new Set<string>();
        const dates = fetched.series.map((p) => p.date);
        for (let i = 0; i < dates.length; i += 400) {
          const chunk = dates.slice(i, i + 400);
          const rows = await prisma.sharePriceHistory.findMany({
            where: { ticker: fetched.sharePriceTicker, date: { in: chunk } },
            select: { date: true },
          });
          rows.forEach((r) => existing.add(r.date));
        }
        const toCreate = fetched.series.filter((p) => !existing.has(p.date));
        for (let i = 0; i < toCreate.length; i += 200) {
          const chunk = toCreate.slice(i, i + 200);
          if (chunk.length === 0) continue;
          await prisma.sharePriceHistory.createMany({
            data: chunk.map((p) => ({
              ticker: fetched.sharePriceTicker,
              currency: fetched.sharePriceCurrency as unknown as CurrencyCode,
              date: p.date,
              close: p.close,
            })),
          });
        }
        fetched.series.forEach((p) => {
          merged.set(p.date, { close: p.close, currency: fetched.sharePriceCurrency as Currency });
        });
      } catch {
      }
    }

    const series = Array.from(merged.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, close: v.close, currency: v.currency }));

    const seriesClean = series.filter((p) => {
      try {
        return (p.close as unknown as { gt?: (n: number) => boolean })?.gt?.(0) ?? Number(p.close) > 0;
      } catch {
        return false;
      }
    });
    const seriesForCalendarBase = seriesClean.length > 0 ? seriesClean : series;

    const calStart = new Date(`${cutoffIso}T00:00:00.000Z`);
    const calEnd = new Date(`${todayIso}T00:00:00.000Z`);
    const calendarSeries: typeof series = [];
    let last: (typeof series)[number] | null = seriesForCalendarBase[0] ?? null;
    let si = 0;
    for (let t = calStart.getTime(); t <= calEnd.getTime(); t += msPerDay) {
      const dIso = ymdInTimeZone(new Date(t), BUSINESS_TIMEZONE);
      while (si < seriesForCalendarBase.length && seriesForCalendarBase[si].date <= dIso) {
        last = seriesForCalendarBase[si];
        si += 1;
      }
      if (last) calendarSeries.push({ date: dIso, close: last.close, currency: last.currency });
    }
    const seriesForCurve =
      calendarSeries.length >= 2
        ? calendarSeries
        : Number(companySharePrice) > 0
          ? [
              {
                date: cutoffIso,
                close: new Prisma.Decimal(Number(companySharePrice)),
                currency: baseCurrency,
              },
              {
                date: todayIso,
                close: new Prisma.Decimal(Number(companySharePrice)),
                currency: baseCurrency,
              },
            ]
          : series;

    const sharesUsed = Math.max(0, Math.floor(Number(totalOptionShares || 0)));
    for (const p of seriesForCurve) {
      const closeInBase =
        p.currency === baseCurrency ? p.close : convertMoney(p.close, p.currency, baseCurrency);
      const valueBase = closeInBase.mul(sharesUsed);
      const v = Number(convertMoney(valueBase, baseCurrency, currency).toFixed(2));
      equityCurvePoints.push({
        date: p.date,
        vestedShares: sharesUsed,
        sharePriceBase: Number(closeInBase.toFixed(6)),
        value: Number.isFinite(v) ? v : 0,
      });
    }
  }
  if (equityCurvePoints.length < 2) {
    const fallbackDays = 30;
    const dates = Array.from({ length: fallbackDays }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (fallbackDays - 1 - i));
      return ymdInTimeZone(d, BUSINESS_TIMEZONE);
    });
    equityCurvePoints = dates.map((date) => ({ date, vestedShares: 0, sharePriceBase: 0, value: 0 }));
  }

  const completedByGrant = new Map<string, number>();
  exerciseRequests
    .filter((r) => r.status === "COMPLETED")
    .forEach((r) => {
      if (r.grantId) {
        const gid = String(r.grantId ?? "");
        const prev = completedByGrant.get(gid) ?? 0;
        completedByGrant.set(gid, prev + Number(r.requestedShares ?? 0));
        return;
      }
      const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
      for (const a of alloc) {
        const prev = completedByGrant.get(a.grantId) ?? 0;
        completedByGrant.set(a.grantId, prev + a.shares);
      }
    });

  const exercisableGrants = grants
    .map((g) => {
      const vested = vestedByGrantMap.get(g.id) ?? 0;
      const exercised = completedByGrant.get(g.id) ?? 0;
      const remaining = Math.max(0, vested - exercised);
      return {
        id: g.id,
        agreementNo: g.agreementNo,
        grantDateIso: ymdInTimeZone(g.grantDate, BUSINESS_TIMEZONE),
        strikePriceBase: Number(g.strikePrice.toFixed(6)),
        remainingVestedShares: remaining,
      };
    })
    .filter((g) => g.remainingVestedShares > 0);

  const exercisedSharesTotal = Array.from(completedByGrant.values()).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const remainingVestedToExercise = Math.max(0, vestedShares - exercisedSharesTotal);
  const nextOverallVestingDate = grants
    .flatMap((g) => g.vestingRecords)
    .filter((v) => v.status === "UNVESTED")
    .map((v) => v.vestDate)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const finalOverallUnvestedDate =
    grants
      .flatMap((g) => g.vestingRecords)
      .filter((v) => v.status === "UNVESTED")
      .map((v) => v.vestDate)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const exitCostYears =
    finalOverallUnvestedDate && finalOverallUnvestedDate.getTime() > now.getTime()
      ? Math.max(1, Math.ceil((finalOverallUnvestedDate.getTime() - now.getTime()) / (365 * 24 * 60 * 60 * 1000)))
      : 0;

  const exitCostUnvestedUsd = Math.max(
    0,
    Math.floor(Number(convertMoney(unvestedOption.unvestedValue, baseCurrency, "USD").toFixed(0))),
  );
  const boundAssetUsd = Math.max(
    0,
    Math.floor(Number(convertMoney(totalOptionValue, baseCurrency, "USD").toFixed(0))),
  );

  const terminationExpiry =
    employee.status === "TERMINATED"
      ? (() => {
          const terminatedAt = employee.terminatedAt ?? employee.updatedAt;
          const expiryAt = new Date(terminatedAt.getTime() + terminationOptionExpiryDays * 24 * 60 * 60 * 1000);
          const msLeft = expiryAt.getTime() - now.getTime();
          const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
          return { expiryAt, daysLeft };
        })()
      : null;

  const detail: ExerciseRequestRow | null =
    modal === "exercise_detail" && rid ? exerciseRequests.find((r) => r.id === rid) ?? null : null;
  const certificateGrant =
    modal === "certificate" && gid ? grants.find((g) => g.id === gid) ?? null : null;
  const certificateOpen = Boolean(certificateGrant);
  const employeeAccount = String(employee.user?.account ?? employee.user?.email ?? "").trim();
  const watermarkText = `${employee.name} · ${employee.department} · ${employeeAccount || employee.id}`;
  const closeAllModalsHref = meUrlWith(meModalHref({}), { modal: null, err: null, rid: null, gid: null });
  const showMobileBack = Boolean(modal && modal !== "mobile_menu");

  return (
    <div data-wm-text={watermarkText} className="relative flex flex-1 flex-col overflow-x-hidden px-4 pt-[calc(4.25rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-10">
      <div id="ui-watermark" data-wm-text={watermarkText} aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 w-[min(1600px,220vw)] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] select-none">
          <div className="grid grid-cols-1 gap-x-40 gap-y-28 sm:grid-cols-2 sm:gap-x-56 sm:gap-y-36">
            {Array.from({ length: 18 }, (_, i) => (
              <div
                key={`wm-${i}`}
                className="max-w-[78vw] break-words text-[30px] font-semibold leading-tight tracking-widest text-zinc-900/6 sm:max-w-[40vw] sm:text-[34px] md:max-w-none md:text-[44px] md:text-zinc-900/7"
              >
                {watermarkText}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Script
        id="me-watermark"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html:
            "(function(){try{var doc=document; if(doc.documentElement.dataset.meWmBound==='1') return; doc.documentElement.dataset.meWmBound='1'; var ensure=function(){var wm=doc.getElementById('ui-watermark'); if(wm) return; var host=doc.querySelector('[data-wm-text]'); var txt=host?host.getAttribute('data-wm-text')||'':''; if(!host||!txt) return; wm=doc.createElement('div'); wm.id='ui-watermark'; wm.setAttribute('aria-hidden','true'); wm.style.position='fixed'; wm.style.inset='0'; wm.style.zIndex='0'; wm.style.pointerEvents='none'; wm.style.overflow='hidden'; var inner=doc.createElement('div'); inner.style.position='absolute'; inner.style.left='50%'; inner.style.top='50%'; inner.style.width='min(1600px,220vw)'; inner.style.transform='translate(-50%,-50%) rotate(-18deg)'; inner.style.userSelect='none'; var grid=doc.createElement('div'); grid.style.display='grid'; grid.style.gridTemplateColumns=window.innerWidth>=640?'1fr 1fr':'1fr'; grid.style.gap='7rem 10rem'; for(var i=0;i<18;i++){var t=doc.createElement('div'); t.textContent=txt; t.style.maxWidth=window.innerWidth>=640?'40vw':'78vw'; t.style.wordBreak='break-word'; t.style.fontWeight='600'; t.style.letterSpacing='0.15em'; t.style.fontSize=window.innerWidth>=768?'44px':'34px'; t.style.lineHeight='1.15'; t.style.color='rgba(15,23,42,0.085)'; grid.appendChild(t);} inner.appendChild(grid); wm.appendChild(inner); try{host.insertBefore(wm, host.firstChild||null);}catch(_){try{host.appendChild(wm);}catch(_2){}} }; ensure(); new MutationObserver(function(){ensure();}).observe(doc.body,{childList:true,subtree:true});}catch(_){}})();",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <div className="fixed inset-x-0 top-0 z-50 md:hidden">
          <div className="mx-auto w-full max-w-5xl px-4 pt-[env(safe-area-inset-top)]">
            <div className="ui-ambient flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-md">
              <div className="flex min-w-0 items-center gap-3">
                {showMobileBack ? (
                  <BackButton
                    fallbackHref={closeAllModalsHref}
                    ariaLabel={lang === "en" ? "Back" : "返回"}
                    className="btn-press inline-flex h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md active:bg-white"
                  />
                ) : null}
                <div className="flex min-w-0 items-center gap-2">
                  {brandLogoDataUrl ? (
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                      <Image
                        src={brandLogoDataUrl}
                        alt="Logo"
                        width={36}
                        height={36}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-700">
                      ESOP
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-zinc-900" title={companyName || "ESOP"}>
                      {companyName || "ESOP"}
                    </div>
                    <div className="mt-0.5 truncate text-xs font-medium text-zinc-500">
                      {employee.name} · {employee.department} · {employee.status === "ACTIVE" ? t.active : t.terminated}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PrivacyToggleButton className="btn-press btn-ripple inline-flex h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 shadow-sm backdrop-blur-md active:bg-white" />
                <Link
                  href={meModalHref({ modal: "mobile_menu" })}
                  className="inline-flex h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md active:bg-white"
                  aria-label={lang === "en" ? "Menu" : "菜单"}
                  data-mm-open
                  scroll={false}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="ui-ambient sticky top-0 z-40 hidden rounded-2xl border border-black/5 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md md:block md:top-2 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 items-center gap-3">
                {brandLogoDataUrl ? (
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                    <Image
                      src={brandLogoDataUrl}
                      alt="Logo"
                      width={40}
                      height={40}
                      unoptimized
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
                    ESOP
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-zinc-700" title={companyName || "ESOP"}>
                    {companyName || "ESOP"}
                  </div>
                  <div className="text-xs font-medium text-zinc-500">
                    {employee.department} · {employee.status === "ACTIVE" ? t.active : t.terminated}
                    {terminationExpiry ? (
                      <>
                        {" "}
                        · {lang === "en" ? "Expires" : "到期"} {formatDate(terminationExpiry.expiryAt, lang)} ·{" "}
                        {terminationExpiry.daysLeft > 0
                          ? lang === "en"
                            ? `${terminationExpiry.daysLeft}d left`
                            : `剩余${terminationExpiry.daysLeft}天`
                          : lang === "en"
                            ? "expired"
                            : "已到期"}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">
                {employee.name} · {t.titleSuffix}
              </h1>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <PrivacyToggleButton />
                <CurrencyLangSwitcher
                  currency={currency}
                  lang={lang}
                  pricingLabel={t.pricing}
                  languageLabel={lang === "en" ? "Language" : "语言"}
                  currencyOptions={[
                    { label: "USD", href: meHref({ ccy: "USD" }), active: currency === "USD" },
                    { label: "HKD", href: meHref({ ccy: "HKD" }), active: currency === "HKD" },
                    { label: "CNY", href: meHref({ ccy: "CNY" }), active: currency === "CNY" },
                  ]}
                  langOptions={[
                    { label: "简体", href: meHref({ lang: "zh-CN" }), active: lang === "zh-CN" },
                    { label: "繁體", href: meHref({ lang: "zh-TW" }), active: lang === "zh-TW" },
                    { label: "EN", href: meHref({ lang: "en" }), active: lang === "en" },
                  ]}
                />
              </div>
              <div className="hidden items-center gap-3 md:flex">
                <Link
                  href={meModalHref({ modal: "change_password" })}
                  data-cp-open
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 md:h-9 md:px-3"
                  scroll={false}
                >
                  {t.changePassword}
                </Link>
                <a
                  href={logoutHref}
                  target="_top"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 md:h-9 md:px-3"
                >
                  {t.logout}
                </a>
              </div>
            </div>
          </div>
        </div>

        {terminationExpiry ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 ${
              terminationExpiry.daysLeft > 0 ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div
                  className={`text-sm font-semibold ${
                    terminationExpiry.daysLeft > 0 ? "text-amber-900" : "text-rose-900"
                  }`}
                >
                  {terminationExpiry.daysLeft > 0
                    ? lang === "en"
                      ? `Your exercise window closes in ${terminationExpiry.daysLeft} days`
                      : lang === "zh-TW"
                        ? `您的行權窗口還剩 ${terminationExpiry.daysLeft} 天關閉`
                        : `您的行权窗口还剩 ${terminationExpiry.daysLeft} 天关闭`
                    : lang === "en"
                      ? "Your exercise window is closed"
                      : lang === "zh-TW"
                        ? "您的行權窗口已關閉"
                        : "您的行权窗口已关闭"}
                </div>
                <div
                  className={`mt-1 text-xs ${
                    terminationExpiry.daysLeft > 0 ? "text-amber-700" : "text-rose-700"
                  }`}
                >
                  {lang === "en"
                    ? `Expiry date: ${formatDate(terminationExpiry.expiryAt, lang)}`
                    : lang === "zh-TW"
                      ? `到期日：${formatDate(terminationExpiry.expiryAt, lang)}`
                      : `到期日：${formatDate(terminationExpiry.expiryAt, lang)}`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={`text-[11px] font-medium ${
                    terminationExpiry.daysLeft > 0 ? "text-amber-700" : "text-rose-700"
                  }`}
                >
                  {lang === "en" ? "Days left" : lang === "zh-TW" ? "剩餘天數" : "剩余天数"}
                </div>
                <div
                  className={`mt-0.5 text-2xl font-extrabold tracking-tight ${
                    terminationExpiry.daysLeft > 0 ? "text-amber-900" : "text-rose-900"
                  }`}
                >
                  {Math.max(0, terminationExpiry.daysLeft)}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div
          id="ui-mobile-menu"
          className={`fixed inset-0 z-50 md:hidden ${modal === "mobile_menu" ? "" : "hidden"}`}
          data-close-href={closeAllModalsHref}
          role="dialog"
          aria-modal="true"
          aria-label={lang === "en" ? "Menu" : lang === "zh-TW" ? "選單" : "菜单"}
        >
            <a
              href={closeAllModalsHref}
              className="absolute inset-0 touch-manipulation bg-black/30 backdrop-blur-sm ui-overlay-in"
              aria-label="关闭"
              data-mm-close
            >
              <span className="sr-only">关闭</span>
            </a>
            <div className="absolute inset-x-0 bottom-0 z-10 pb-[env(safe-area-inset-bottom)] ui-stagger-in" data-mm-panel>
              <div className="mx-auto w-full max-w-lg rounded-t-3xl border border-black/10 bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-black/5 bg-white/80 px-5 py-4 backdrop-blur-md">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">
                      {employee.name} · {t.titleSuffix}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-600">
                      {employee.department} · {employee.status === "ACTIVE" ? t.active : t.terminated}
                    </div>
                  </div>
                  <a
                    href={closeAllModalsHref}
                    className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                    data-mm-close
                  >
                    {lang === "en" ? "Close" : lang === "zh-TW" ? "關閉" : "关闭"}
                  </a>
                </div>
                <div className="px-5 pb-5 pt-4">
                  <div className="text-[11px] font-semibold text-zinc-500">{t.pricing}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <a
                      href={meHref({ ccy: "USD" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        currency === "USD"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      USD
                    </a>
                    <a
                      href={meHref({ ccy: "HKD" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        currency === "HKD"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      HKD
                    </a>
                    <a
                      href={meHref({ ccy: "CNY" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        currency === "CNY"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      CNY
                    </a>
                  </div>

                  <div className="mt-5 text-[11px] font-semibold text-zinc-500">
                    {lang === "en" ? "Language" : lang === "zh-TW" ? "語言" : "语言"}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <a
                      href={meHref({ lang: "zh-CN" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        lang === "zh-CN"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      简体
                    </a>
                    <a
                      href={meHref({ lang: "zh-TW" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        lang === "zh-TW"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      繁體
                    </a>
                    <a
                      href={meHref({ lang: "en" })}
                      data-mm-nav
                      className={`inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border px-3 text-sm font-semibold ${
                        lang === "en"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      EN
                    </a>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <a
                      href={meModalHref({ modal: "change_password" })}
                      data-cp-open
                      data-mm-close
                      className="inline-flex h-11 touch-manipulation items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900"
                    >
                      {t.changePassword}
                    </a>
                    <a
                      href={logoutHref}
                      data-mm-nav
                      target="_top"
                      className="inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-semibold text-white"
                    >
                      {t.logout}
                    </a>
                  </div>
                </div>
              </div>
            </div>
        </div>

        <div
          id="ui-exercise-modal"
          data-close-href={closeAllModalsHref}
          role="dialog"
          aria-modal="true"
          aria-label={lang === "en" ? "Exercise" : lang === "zh-TW" ? "申請行權" : "申请行权"}
          className={`fixed inset-0 z-50 ${modal === "exercise" ? "flex" : "hidden"} items-center justify-center p-4 sm:p-6`}
        >
          <a
            href={closeAllModalsHref}
            data-ex-close
            className="absolute inset-0 touch-manipulation bg-black/30 ui-overlay-in"
            aria-label="关闭"
          >
            <span className="sr-only">关闭</span>
          </a>
          <div className="relative z-10 w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ui-modal-in">
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white/80 px-5 py-4 backdrop-blur-md">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">{t.exerciseTitle}</div>
                <div className="mt-1 text-xs text-zinc-600">{t.exerciseHint}</div>
              </div>
              <a
                href={closeAllModalsHref}
                data-ex-close
                className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
              >
                {lang === "en" ? "Close" : lang === "zh-TW" ? "關閉" : "关闭"}
              </a>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4" style={{ WebkitOverflowScrolling: "touch" }}>
              {err ? (
                err === "EXERCISE_COMPLETED" ? (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {t.exerciseDone}
                  </div>
                ) : err === "PAYMENT_NOT_FOUND" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {t.paidNotFound}
                  </div>
                ) : err === "MISSING_PAYINFO" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {t.missingPayInfo}
                  </div>
                ) : err === "INVALID_TXHASH" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {t.invalidTx}
                  </div>
                ) : err === "TXHASH_ALREADY_USED" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {t.txUsed}
                  </div>
                ) : err === "MISSING_PAYMENT_PROOF" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {lang === "en"
                      ? "Please provide TxHash or upload a transfer screenshot."
                      : lang === "zh-TW"
                        ? "請填寫 TxHash 或上傳轉帳截圖。"
                        : "请填写 TxHash 或上传转账截图。"}
                  </div>
                ) : err === "INVALID_IMAGE" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {lang === "en" ? "Invalid screenshot format." : lang === "zh-TW" ? "截圖格式不正確。" : "截图格式不正确。"}
                  </div>
                ) : err === "IMAGE_TOO_LARGE" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {lang === "en"
                      ? "Screenshot is too large. Please compress and retry."
                      : lang === "zh-TW"
                        ? "截圖過大，請壓縮後重試。"
                        : "截图过大，请压缩后重试。"}
                  </div>
                ) : err === "AMOUNT_TAMPERED" ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {lang === "en"
                      ? "Security check failed: payment amount mismatch."
                      : lang === "zh-TW"
                        ? "安全校驗失敗：應付金額不一致。"
                        : "安全校验失败：应付金额不一致。"}
                  </div>
                ) : err === "SUBMITTED" ? null : (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {`${lang === "en" ? "Error" : "操作失败"}：${err}`}
                  </div>
                )
              ) : null}
              <ExerciseRequestForm
                action={submitExercisePayment}
                apiEndpoint="/api/exercise/submit"
                lang={lang}
                returnTo={meModalHref({ modal: "exercise" })}
                baseCurrency={baseCurrency}
                displayCurrency={currency}
                companySharePriceBase={Number(companySharePrice.toFixed(6))}
                grants={exercisableGrants}
                usdtBnbAddress={usdtBnbAddress}
                usdtTrxAddress={usdtTrxAddress}
              />
            </div>
          </div>

          {err === "SUBMITTED" ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/20 ui-overlay-in" />
              <div className="relative w-[min(92vw,420px)] rounded-2xl border border-black/10 bg-white p-5 shadow-2xl ui-stagger-in">
                <div className="text-sm font-semibold text-zinc-900">
                  {lang === "en" ? "Submitted" : lang === "zh-TW" ? "已提交" : "已提交"}
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">{t.submitted}</div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  {exerciseSubmittedDetailHref ? (
                    <a
                      href={exerciseSubmittedDetailHref}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                    >
                      {lang === "en" ? "View details" : "查看详情"}
                    </a>
                  ) : null}
                  <a
                    href={exerciseSubmittedDismissHref}
                    data-ex-close
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    {lang === "en" ? "OK" : lang === "zh-TW" ? "知道了" : "知道了"}
                  </a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <Script
          id="me-exercise-modal"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-exercise-modal'); if(!root||root.dataset.bound==='1') return; root.dataset.bound='1'; var closeHref=root.getAttribute('data-close-href')||''; var show=function(href,push){try{root.classList.remove('hidden'); root.classList.add('flex');}catch(_){ } try{if(push&&href){history.pushState({__ex:1},'',href);}}catch(_){}}; var hide=function(href,push){try{root.classList.add('hidden'); root.classList.remove('flex');}catch(_){ } try{if(push&&href){history.pushState({},'',href);}}catch(_){}}; var sync=function(){try{var u=new URL(location.href); var m=u.searchParams.get('modal'); if(m==='exercise'){show('',false);} else {hide('',false);}}catch(_){}}; var onOpen=function(a){try{var href=a&&a.getAttribute?a.getAttribute('href')||'':''; show(href,true);}catch(_){}}; var onClose=function(a){try{var href=a&&a.getAttribute?a.getAttribute('href')||'':closeHref; hide(href||closeHref,true);}catch(_){}}; document.addEventListener('click',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('[data-ex-open]'); if(a){e.preventDefault(); e.stopPropagation(); onOpen(a); return;} var c=t.closest('[data-ex-close]'); if(c){e.preventDefault(); e.stopPropagation(); onClose(c); return;}}catch(_){}} ,true); document.addEventListener('touchstart',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('[data-ex-open]'); if(a){e.preventDefault(); e.stopPropagation(); onOpen(a); return;} var c=t.closest('[data-ex-close]'); if(c){e.preventDefault(); e.stopPropagation(); onClose(c); return;}}catch(_){}} ,{passive:false,capture:true}); window.addEventListener('popstate',function(){sync();}); sync();}catch(_){}})();",
          }}
        />

        <div
          id="ui-exercise-detail-modal"
          data-close-href={closeAllModalsHref}
          role="dialog"
          aria-modal="true"
          aria-label={lang === "en" ? "Payment details" : lang === "zh-TW" ? "打款詳情" : "打款详情"}
          className="fixed inset-0 z-50 hidden items-center justify-center p-4 sm:p-6"
        >
          <a
            href={closeAllModalsHref}
            data-exd-close
            className="absolute inset-0 touch-manipulation bg-black/30 ui-overlay-in"
            aria-label="关闭"
          >
            <span className="sr-only">关闭</span>
          </a>
          <div className="relative z-10 w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-2xl ui-modal-in overflow-hidden">
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-black/5 bg-white/80 px-5 py-4 backdrop-blur-md">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">
                  {lang === "en" ? "Payment details" : lang === "zh-TW" ? "打款詳情" : "打款详情"}
                </div>
                <div className="mt-1 text-xs text-zinc-600">
                  {lang === "en" ? "Created" : lang === "zh-TW" ? "建立於" : "创建于"}{" "}
                  <span id="ui-exd-created" className="font-mono" />
                </div>
              </div>
              <a
                href={closeAllModalsHref}
                data-exd-close
                className="btn-press btn-ripple shrink-0 rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
              >
                {lang === "en" ? "Close" : lang === "zh-TW" ? "關閉" : "关闭"}
              </a>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.status}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900" id="ui-exd-status" />
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.shares}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="ui-sensitive font-mono" id="ui-exd-shares" />
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.cost}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="ui-sensitive font-mono" id="ui-exd-cost" />
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.chain}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="font-mono" id="ui-exd-chain" />
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">
                    {lang === "en" ? "Receiving address" : lang === "zh-TW" ? "收款地址" : "收款地址"}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-zinc-900" id="ui-exd-to" />
                </div>
                <div className="rounded-xl border border-black/5 bg-white px-4 py-3 sm:col-span-2">
                  <div className="text-[11px] font-medium text-zinc-600">{t.txHash}</div>
                  <div className="mt-1 break-all font-mono text-xs text-indigo-700" id="ui-exd-tx" />
                </div>
                <div className="rounded-xl border border-black/5 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.verifiedAt}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="font-mono" id="ui-exd-verified" />
                  </div>
                </div>
                <div className="rounded-xl border border-black/5 bg-white px-4 py-3" id="ui-exd-checkerr-wrap">
                  <div className="text-[11px] font-medium text-zinc-600">
                    {lang === "en" ? "Check error" : lang === "zh-TW" ? "核驗錯誤" : "核验错误"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900" id="ui-exd-checkerr" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <Script
          id="me-exercise-detail-modal"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-exercise-detail-modal'); if(!root||root.dataset.bound==='1') return; root.dataset.bound='1'; var closeHref=root.getAttribute('data-close-href')||''; var elCreated=document.getElementById('ui-exd-created'); var elStatus=document.getElementById('ui-exd-status'); var elShares=document.getElementById('ui-exd-shares'); var elCost=document.getElementById('ui-exd-cost'); var elChain=document.getElementById('ui-exd-chain'); var elTo=document.getElementById('ui-exd-to'); var elTx=document.getElementById('ui-exd-tx'); var elVerified=document.getElementById('ui-exd-verified'); var elCheckWrap=document.getElementById('ui-exd-checkerr-wrap'); var elCheck=document.getElementById('ui-exd-checkerr'); var setText=function(el,v){if(!el) return; el.textContent=(v&&String(v).trim())?String(v):'—';}; var show=function(href,ds,push){try{root.classList.remove('hidden'); root.classList.add('flex');}catch(_){ } try{setText(elCreated, ds.exdCreated); setText(elStatus, ds.exdStatus); setText(elShares, ds.exdShares); setText(elCost, ds.exdCost); setText(elChain, ds.exdChain); setText(elTo, ds.exdTo); setText(elTx, ds.exdTx); setText(elVerified, ds.exdVerified); var ce=(ds.exdCheckerr||'').trim(); if(elCheckWrap){elCheckWrap.style.display=ce?'block':'none';} setText(elCheck, ce||'');}catch(_){ } try{var ex=document.getElementById('ui-exercise-modal'); if(ex){ex.classList.add('hidden'); ex.classList.remove('flex');}}catch(_){ } try{if(push&&href){history.pushState({__exd:1},'',href);}}catch(_){}}; var hide=function(href,push){try{root.classList.add('hidden'); root.classList.remove('flex');}catch(_){ } try{if(push&&href){history.pushState({},'',href);}}catch(_){}}; var openFromAnchor=function(a,push){if(!a) return; var href=a.getAttribute('href')||''; var ds=a.dataset||{}; show(href,ds,push);}; var findByRid=function(rid){try{var safe=String(rid||'').replace(/\"/g,''); return document.querySelector('a[data-exd-open][data-exd-rid=\"'+safe+'\"]');}catch(_){return null;}}; var sync=function(){try{var u=new URL(location.href); var m=u.searchParams.get('modal'); var rid=u.searchParams.get('rid')||''; if(m==='exercise_detail'&&rid){var a=findByRid(rid); if(a){openFromAnchor(a,false);} else {hide('',false);} return;} hide('',false);}catch(_){}}; document.addEventListener('click',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('a[data-exd-open]'); if(a){e.preventDefault(); e.stopPropagation(); openFromAnchor(a,true); return;} var c=t.closest('[data-exd-close]'); if(c){e.preventDefault(); e.stopPropagation(); hide(closeHref||c.getAttribute('href')||'',true); return;}}catch(_){}} ,true); document.addEventListener('touchstart',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('a[data-exd-open]'); if(a){e.preventDefault(); e.stopPropagation(); openFromAnchor(a,true); return;} var c=t.closest('[data-exd-close]'); if(c){e.preventDefault(); e.stopPropagation(); hide(closeHref||c.getAttribute('href')||'',true); return;}}catch(_){}} ,{passive:false,capture:true}); window.addEventListener('popstate',function(){sync();}); sync();}catch(_){}})();",
          }}
        />

        <div
          id="ui-change-password-modal"
          data-close-href={meModalHref({})}
          role="dialog"
          aria-modal="true"
          aria-label={lang === "en" ? "Change password" : lang === "zh-TW" ? "修改密碼" : "修改密码"}
          className={`fixed inset-0 z-50 ${modal === "change_password" ? "flex" : "hidden"} items-center justify-center p-4`}
        >
            <a
              href={meModalHref({})}
              data-cp-close
              className="absolute inset-0 touch-manipulation bg-black/30 ui-overlay-in"
              aria-label="关闭"
            >
              <span className="sr-only">关闭</span>
            </a>
            <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-xl backdrop-blur-md">
              <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">{t.changePassword}</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {lang === "en"
                      ? "You'll be logged out after updating the password."
                      : lang === "zh-TW"
                        ? "提交成功後會退出登入，需要重新登入。"
                        : "提交成功后会退出登录，需要重新登录。"}
                  </div>
                </div>
                <a
                  href={meModalHref({})}
                  data-cp-close
                  className="shrink-0 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                >
                  {lang === "en" ? "Close" : lang === "zh-TW" ? "關閉" : "关闭"}
                </a>
              </div>
              <form action={changePassword} className="px-5 py-4">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="returnTo" value={meModalHref({ modal: "change_password" })} />
                {err ? (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {err === "BAD_CURRENT_PASSWORD"
                      ? lang === "en"
                        ? "Current password is incorrect."
                        : lang === "zh-TW"
                          ? "目前密碼不正確。"
                          : "当前密码不正确。"
                      : err === "PASSWORD_TOO_SHORT"
                        ? lang === "en"
                          ? "New password must be at least 8 characters."
                          : lang === "zh-TW"
                            ? "新密碼至少 8 位。"
                            : "新密码至少 8 位。"
                        : err === "PASSWORD_MISMATCH"
                          ? lang === "en"
                            ? "New passwords do not match."
                            : lang === "zh-TW"
                              ? "兩次新密碼輸入不一致。"
                              : "两次新密码输入不一致。"
                          : `${lang === "en" ? "Error" : "操作失败"}：${err}`}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-zinc-600">
                      {lang === "en" ? "Current password" : lang === "zh-TW" ? "目前密碼" : "当前密码"}
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
                      {lang === "en" ? "New password" : lang === "zh-TW" ? "新密碼" : "新密码"}
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
                      {lang === "en" ? "Confirm new password" : lang === "zh-TW" ? "確認新密碼" : "确认新密码"}
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
                  <a
                    href={meModalHref({})}
                    data-cp-close
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    {lang === "en" ? "Cancel" : "取消"}
                  </a>
                  <button className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
                    {lang === "en" ? "Update" : "提交"}
                  </button>
                </div>
              </form>
            </div>
        </div>
        <Script
          id="me-change-password-modal"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-change-password-modal'); if(!root||root.dataset.bound==='1') return; root.dataset.bound='1'; var closeHref=root.getAttribute('data-close-href')||''; var show=function(href,push){try{root.classList.remove('hidden'); root.classList.add('flex');}catch(_){ } try{if(push&&href){history.pushState({__cp:1},'',href);}}catch(_){}}; var hide=function(href,push){try{root.classList.add('hidden'); root.classList.remove('flex');}catch(_){ } try{if(push&&href){history.pushState({},'',href);}}catch(_){}}; var sync=function(){try{var u=new URL(location.href); var m=u.searchParams.get('modal'); if(m==='change_password'){show('',false);} else {hide('',false);}}catch(_){}}; var onOpen=function(a){try{var href=a&&a.getAttribute?a.getAttribute('href')||'':''; show(href,true);}catch(_){}}; var onClose=function(a){try{var href=a&&a.getAttribute?a.getAttribute('href')||'':closeHref; hide(href||closeHref,true);}catch(_){}}; document.addEventListener('click',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('[data-cp-open]'); if(a){e.preventDefault(); e.stopPropagation(); onOpen(a); return;} var c=t.closest('[data-cp-close]'); if(c){e.preventDefault(); e.stopPropagation(); onClose(c); return;}}catch(_){}} ,true); document.addEventListener('touchstart',function(e){try{var t=e.target; if(!t||!t.closest) return; var a=t.closest('[data-cp-open]'); if(a){e.preventDefault(); e.stopPropagation(); onOpen(a); return;} var c=t.closest('[data-cp-close]'); if(c){e.preventDefault(); e.stopPropagation(); onClose(c); return;}}catch(_){}} ,{passive:false,capture:true}); window.addEventListener('popstate',function(){sync();}); sync();}catch(_){}})();",
          }}
        />

        <div
          id="ui-certificate-modal"
          data-close-href={closeAllModalsHref}
          role="dialog"
          aria-modal="true"
          aria-label={lang === "en" ? "Digital equity certificate" : lang === "zh-TW" ? "電子權證預覽" : "电子权证预览"}
          className={`fixed inset-0 z-50 ${certificateOpen ? "flex" : "hidden"} items-center justify-center p-4 sm:p-6`}
        >
          <a
            href={closeAllModalsHref}
            className="absolute inset-0 touch-manipulation bg-black/30 ui-overlay-in"
            aria-label="关闭"
            data-cert-close
          >
            <span className="sr-only">关闭</span>
          </a>
          <div className="relative z-10 w-full max-w-3xl flex flex-col max-h-[calc(100vh-2rem)] rounded-2xl border border-black/10 bg-zinc-100 shadow-2xl ui-modal-in overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-4 p-6 bg-zinc-100 border-b border-black/5">
              <div className="text-sm font-semibold text-zinc-900">
                {lang === "en" ? "Digital equity certificate" : lang === "zh-TW" ? "電子權證預覽" : "电子权证预览"}
              </div>
              <a
                href={closeAllModalsHref}
                className="btn-press btn-ripple rounded-lg border border-black/5 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
                data-cert-close
              >
                {lang === "en" ? "Close" : lang === "zh-TW" ? "關閉" : "关闭"}
              </a>
            </div>

            <div className="flex-1 overflow-auto p-6 pt-4">
              <div className="rounded-2xl bg-[#f8fafc] p-[1px] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <div className="relative overflow-hidden rounded-2xl bg-white px-8 py-8">
                  {brandLogoDataUrl ? (
                    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.03]">
                      <div
                        className="absolute -inset-[40%] rotate-[-18deg]"
                        style={{
                          backgroundImage: `url(${brandLogoDataUrl})`,
                          backgroundRepeat: "repeat",
                          backgroundSize: "160px 160px",
                        }}
                      />
                    </div>
                  ) : (
                    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.03]">
                      <div className="absolute -inset-[40%] rotate-[-18deg]">
                        <div className="grid grid-cols-2 gap-x-24 gap-y-16">
                          {Array.from({ length: 24 }, (_, i) => (
                            <div key={`cert-wm-${i}`} className="whitespace-nowrap text-[28px] font-semibold tracking-widest text-zinc-900">
                              ESOP
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="relative z-10">
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-3">
                        {brandLogoDataUrl ? (
                          <div className="h-10 w-10 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                            <Image
                              src={brandLogoDataUrl}
                              alt="Logo"
                              width={40}
                              height={40}
                              unoptimized
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                            ESOP
                          </div>
                        )}
                        <div>
                          <div className="text-xs font-medium tracking-wide text-zinc-500">
                            {lang === "en" ? "CERTIFICATE" : lang === "zh-TW" ? "權證" : "权证"}
                          </div>
                          <div className="text-lg font-semibold tracking-tight text-zinc-900">
                            {lang === "en" ? "Equity Certificate" : lang === "zh-TW" ? "股權證書" : "股权证书"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-medium text-zinc-500">
                          {lang === "en" ? "Agreement No." : lang === "zh-TW" ? "協議編號" : "协议编号"}
                        </div>
                        <div id="ui-cert-agreement-no" className="font-mono text-sm font-semibold text-zinc-900">
                          {certificateGrant ? certificateGrant.agreementNo : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-medium text-zinc-600">
                          {lang === "en" ? "Granted shares" : lang === "zh-TW" ? "授予股數" : "授予股数"}
                        </div>
                        <div id="ui-cert-total-shares" className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-900">
                          {certificateGrant ? formatInt(certificateGrant.totalShares) : "—"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-medium text-zinc-600">
                          {lang === "en" ? "Exercise price" : lang === "zh-TW" ? "行權價格" : "行权价格"}
                        </div>
                        <div id="ui-cert-strike-price" className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-900">
                          {certificateGrant ? formatMoney(certificateGrant.strikePrice, currency, baseCurrency) : "—"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 sm:col-span-2">
                        <div className="text-[11px] font-medium text-zinc-600">
                          {lang === "en" ? "Grant date" : lang === "zh-TW" ? "授予日期" : "授予日期"}
                        </div>
                        <div id="ui-cert-grant-date" className="mt-1 text-sm font-semibold text-zinc-900">
                          {certificateGrant ? formatDate(certificateGrant.grantDate, lang) : "—"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 sm:col-span-2">
                        <div className="text-[11px] font-medium text-zinc-600">
                          {lang === "en" ? "Effective date" : lang === "zh-TW" ? "生效日期" : "生效日期"}
                        </div>
                        <div id="ui-cert-effective-date" className="mt-1 text-sm font-semibold text-zinc-900">
                          {formatDate(new Date(), lang)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-10 flex items-end justify-between gap-6">
                      <div className="text-xs leading-5 text-zinc-500">
                        {lang === "en"
                          ? `Issued to ${employee.name}.`
                          : lang === "zh-TW"
                            ? `簽發給：${employee.name}`
                            : `签发给：${employee.name}`}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          {companyName ? (
                            <div className="max-w-[220px] truncate text-[11px] font-semibold text-zinc-700" title={companyName}>
                              {companyName}
                            </div>
                          ) : null}
                          <div className="text-[11px] font-medium text-zinc-500">
                            {lang === "en" ? "Company seal" : lang === "zh-TW" ? "公司印章" : "公司印章"}
                          </div>
                          <div className="text-[11px] text-zinc-500">{formatDate(new Date(), lang)}</div>
                        </div>
                        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-indigo-300/60 bg-indigo-50/40 text-indigo-700">
                          <svg width="46" height="46" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.6" />
                            <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
                            <path
                              d="M16 28.5c2.2-4.5 6.2-7 8-7s5.8 2.5 8 7"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                            <path d="M19 18.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <path d="M21 32h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Script
          id="me-certificate-modal"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var root=document.getElementById('ui-certificate-modal'); if(!root||root.dataset.bound==='1') return; root.dataset.bound='1'; var closeHref=root.getAttribute('data-close-href')||''; var agreementEl=document.getElementById('ui-cert-agreement-no'); var sharesEl=document.getElementById('ui-cert-total-shares'); var strikeEl=document.getElementById('ui-cert-strike-price'); var dateEl=document.getElementById('ui-cert-grant-date'); var setText=function(el,v){if(!el) return; el.textContent=(v&&String(v).trim())?String(v):'—';}; var show=function(href,ds,push){try{root.classList.remove('hidden'); root.classList.add('flex');}catch(_){} try{setText(agreementEl, ds.agreementNo); setText(sharesEl, ds.totalShares); setText(strikeEl, ds.strikeLabel); setText(dateEl, ds.grantDateLabel);}catch(_){} try{if(push&&href){history.pushState({__cert:1},'',href);}}catch(_){}}; var hide=function(href,push){try{root.classList.add('hidden'); root.classList.remove('flex');}catch(_){} try{if(push&&href){history.pushState({},'',href);}}catch(_){}}; var openFromAnchor=function(a,push){if(!a) return; var ds=a.dataset||{}; var href=a.getAttribute('href')||''; show(href,ds,push);}; var findByGid=function(gid){try{var safe=String(gid||'').replace(/\"/g,''); return document.querySelector('a[data-cert-open][data-cert-gid=\"'+safe+'\"]');}catch(_){return null;}}; var sync=function(){try{var u=new URL(location.href); var m=u.searchParams.get('modal'); var gid=u.searchParams.get('gid')||''; if(m==='certificate'&&gid){var a=findByGid(gid); if(a){openFromAnchor(a,false);} else {hide('',false);} return;} hide('',false);}catch(_){}}; document.addEventListener('click',function(e){var t=e.target; if(!t) return; var a=t.closest&&t.closest('a[data-cert-open]'); if(a){e.preventDefault(); e.stopPropagation(); openFromAnchor(a,true); return;} var c=t.closest&&t.closest('[data-cert-close]'); if(c){e.preventDefault(); e.stopPropagation(); hide(closeHref||c.getAttribute('href')||'',true); return;}},true); window.addEventListener('popstate',function(){sync();}); sync();}catch(_){}})();",
          }}
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-3">
          <section className="ui-card p-4 md:p-6 lg:col-span-2">
            <div className="hidden md:block mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-5 shadow-[0_8px_30px_rgb(16,185,129,0.1)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-zinc-700">{t.marketRef}</div>
                <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700">
                  {t.autoUpdating}
                </span>
              </div>
              {!sharePriceTicker ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t.noTicker}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-zinc-600">{t.autoUpdateHint}</div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-emerald-100 bg-white/60 px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.ticker}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="font-mono">{sharePriceTicker || "—"}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-white/60 px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.baseCurrency}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    <span className="font-mono">{baseCurrency}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-white/60 px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">
                    <span className="inline-flex items-center gap-1">
                      <span>{t.sharePrice}</span>
                      {useManualCompanySharePrice ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          {lang === "en" ? "Settlement" : "清算"}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-emerald-500">
                    {sharePriceTicker ? (
                      <LiveCompanySharePrice
                        key={`${sharePriceTicker}|${currency}|${baseCurrency}|${companySharePrice.toFixed(6)}`}
                        initialPriceBase={Number(companySharePrice.toFixed(6))}
                        initialBaseCurrency={baseCurrency}
                        displayCurrency={currency}
                        sharePriceTicker={sharePriceTicker}
                        className="font-mono tabular-nums"
                      />
                    ) : (
                      <span className="font-mono tabular-nums">—</span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-white/60 px-4 py-3">
                  <div className="text-[11px] font-medium text-zinc-600">{t.avg30}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    {sharePriceTicker ? (
                      <LiveSharePriceAvg30
                        key={`${sharePriceTicker}|${currency}|${sharePriceAvg30Usd ? sharePriceAvg30Usd.toFixed(6) : ""}`}
                        initialAvg30Usd={sharePriceAvg30Usd ? Number(sharePriceAvg30Usd.toFixed(6)) : null}
                        displayCurrency={currency}
                        sharePriceTicker={sharePriceTicker}
                        className="font-mono"
                      />
                    ) : (
                      <span className="font-mono">—</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-zinc-600">
                {t.updatedAt} {sharePriceUpdatedAt ? formatDateTime(sharePriceUpdatedAt, lang) : "—"}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <div className="order-2 ui-card p-4 md:order-1 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs font-medium text-zinc-600">{t.vestedShares}</div>
                  <div className="flex flex-col items-end">
                    <a
                      href={meModalHref({ modal: "exercise" })}
                      data-ex-open
                      className={`btn-press btn-ripple inline-flex h-11 items-center justify-center rounded-xl px-4 text-xs font-semibold md:h-8 md:px-3 ${
                        remainingVestedToExercise > 0
                          ? "bg-[#2563eb] text-white shadow-[0_10px_30px_rgba(37,99,235,0.22)] hover:bg-[#1d4ed8]"
                          : "border border-black/5 bg-white/80 text-zinc-700 hover:bg-white"
                      }`}
                    >
                      {t.exercise}
                    </a>
                  </div>
                </div>
                <div className="ui-sensitive mt-2 font-mono tabular-nums text-3xl font-semibold tracking-tight text-emerald-400 md:text-4xl">
                  {formatInt(vestedShares)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                  <div>
                    {lang === "en" ? "Exercisable" : "可行权"} ·{" "}
                    <span className="ui-sensitive font-mono text-zinc-800">{formatInt(remainingVestedToExercise)}</span>
                  </div>
                  <div>
                    {lang === "en" ? "Exercised" : "已行权"} ·{" "}
                    <span className="ui-sensitive font-mono text-zinc-800">{formatInt(exercisedSharesTotal)}</span>
                  </div>
                  <div>
                    {lang === "en" ? "Unvested" : "未成熟"} ·{" "}
                    <span className="ui-sensitive font-mono text-zinc-800">{formatInt(unvestedShares)}</span>
                  </div>
                  {forfeitedShares > 0 ? (
                    <div>
                      {lang === "en" ? "Forfeited" : "已失效"} ·{" "}
                      <span className="ui-sensitive font-mono text-zinc-800">{formatInt(forfeitedShares)}</span>
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
              </div>
              <div className="order-1 rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-[0_8px_30px_rgb(16,185,129,0.1)] md:order-2 md:p-5">
                <div className="text-xs font-medium text-zinc-600">
                  {t.totalOptionValue}
                </div>
                <div className="mt-2 max-w-full min-w-0">
                  <VisionTotalOptionValue
                    lang={lang}
                    totalShares={totalOptionShares}
                    vestedShares={vestedShares}
                    unvestedShares={unvestedOption.unvestedShares}
                    baseCurrency={baseCurrency}
                    companySharePriceBase={Number(companySharePrice)}
                    displayCurrency={currency}
                    boundAssetUsdBase={boundAssetUsd}
                    exitCostUnvestedUsdBase={exitCostUnvestedUsd}
                    className="ui-sensitive block max-w-full whitespace-nowrap text-indigo-700"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute -inset-1 inline-flex animate-ping rounded-full bg-emerald-500/50" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  <span>{lang === "en" ? "Live" : lang === "zh-TW" ? "即時" : "实时"}</span>
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  {t.optionValueFormula}
                </div>
                <div className="mt-2 text-xs text-zinc-600">
                  <span className="ui-sensitive font-mono tabular-nums text-zinc-900">{formatInt(totalOptionShares)}</span>{" "}
                  {lang === "en" ? "shares" : "股"}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>{t.vestingProgress}</span>
                <span>
                  {formatInt(vestedShares)} / {formatInt(totalGranted)}
                  <span className="ml-2 font-mono tabular-nums text-zinc-600">{`${Math.round(progress * 100)}%`}</span>
                </span>
              </div>
              <AnimatedProgressBar
                percent={progress}
                barClassName="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300"
                heightClassName="h-3 sm:h-2"
              />
              {unvestedShares > 0 ? (
                <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-4 py-4 text-xs leading-5 text-zinc-500">
                  <span>
                    {lang === "en" ? "Bound asset now: " : lang === "zh-TW" ? "目前已綁定資產：" : "当前已绑定资产："}
                  </span>
                  <span id="ui-bound-asset-usd" className="ui-sensitive font-mono tabular-nums text-amber-600">
                    US${formatInt(boundAssetUsd)}
                  </span>
                  <span>
                    {lang === "en"
                      ? ". If you exit now, you will give up unvested options worth about "
                      : lang === "zh-TW"
                        ? "。若此時離職，您將放棄未來 "
                        : "。若此时离职，您将放弃未来 "}
                  </span>
                  <span className="font-mono tabular-nums text-amber-600">
                    {exitCostYears > 0 ? `${exitCostYears}${lang === "en" ? "y" : "年"}` : lang === "en" ? "the next years" : "数年"}
                  </span>
                  <span>{lang === "en" ? " worth about " : lang === "zh-TW" ? " 內價值約 " : " 内价值约 "}</span>
                  <span id="ui-exit-unvested-usd" className="font-mono tabular-nums text-amber-600">US${formatInt(exitCostUnvestedUsd)}</span>
                  <span>{lang === "en" ? " in unvested options." : lang === "zh-TW" ? " 的待成熟期權。" : " 的待成熟期权。"}</span>
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 shadow-[0_8px_30px_rgb(16,185,129,0.1)]">
                  <div className="text-xs text-zinc-500">{lang === "en" ? "Vested option value" : "已成熟期权价值"}</div>
                  <div className="mt-1 text-sm font-extrabold text-emerald-600">
                    <span id="ui-vested-option-value" className="ui-sensitive font-mono">
                      {formatMoney(vestedOptionValue, currency, baseCurrency)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-zinc-600">
                    <div className="flex items-center justify-between">
                      <span>
                        {lang === "en" ? "Unlocked" : "已解锁"} ·{" "}
                        <span className="ui-sensitive font-mono">{formatInt(optionValueBreakdown.vestedUnlockedShares)}</span> 股
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        {lang === "en" ? "Locked" : "未解锁"} ·{" "}
                        <span className="ui-sensitive font-mono">{formatInt(optionValueBreakdown.vestedLockedShares)}</span> 股
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="text-xs text-zinc-500">{lang === "en" ? "Unvested option value" : "未成熟期权价值"}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-700">
                    <span id="ui-unvested-option-value" className="ui-sensitive font-mono">
                      {formatMoney(unvestedOption.unvestedValue, currency, baseCurrency)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-600">
                    <span className="ui-sensitive font-mono">{formatInt(unvestedOption.unvestedShares)}</span> 股
                  </div>
                </div>
              </div>

              <details className="mt-4 rounded-xl border border-emerald-100 bg-white/70 p-4 md:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-zinc-900">
                  <span>{t.marketRef}</span>
                  <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700">
                    {t.autoUpdating}
                  </span>
                </summary>
                {!sharePriceTicker ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {t.noTicker}
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] text-zinc-600">{t.autoUpdateHint}</div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-100 bg-white/60 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-600">{t.ticker}</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-900">
                      <span className="font-mono">{sharePriceTicker || "—"}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-white/60 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-600">{t.sharePrice}</div>
                    <div className="mt-1 text-sm font-extrabold text-emerald-500">
                      {sharePriceTicker ? (
                        <LiveCompanySharePrice
                          key={`${sharePriceTicker}|${currency}|${baseCurrency}|${companySharePrice.toFixed(6)}`}
                          initialPriceBase={Number(companySharePrice.toFixed(6))}
                          initialBaseCurrency={baseCurrency}
                          displayCurrency={currency}
                          sharePriceTicker={sharePriceTicker}
                          className="font-mono tabular-nums"
                        />
                      ) : (
                        <span className="font-mono tabular-nums">—</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-white/60 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-600">{t.avg30}</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-900">
                      {sharePriceTicker ? (
                        <LiveSharePriceAvg30
                          key={`${sharePriceTicker}|${currency}|${sharePriceAvg30Usd ? sharePriceAvg30Usd.toFixed(6) : ""}`}
                          initialAvg30Usd={sharePriceAvg30Usd ? Number(sharePriceAvg30Usd.toFixed(6)) : null}
                          displayCurrency={currency}
                          sharePriceTicker={sharePriceTicker}
                          className="font-mono"
                        />
                      ) : (
                        <span className="font-mono">—</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-white/60 px-3 py-2">
                    <div className="text-[11px] font-medium text-zinc-600">{t.updatedAt}</div>
                    <div className="mt-1 text-[11px] font-medium text-zinc-700">
                      <span className="font-mono">{sharePriceUpdatedAt ? formatDateTime(sharePriceUpdatedAt, lang) : "—"}</span>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </section>
          <div className="flex min-w-0 flex-col gap-6 self-start">
            <section className="ui-card p-4 md:p-5">
              <details className="md:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-900">
                  <span>{t.readOnlyTitle}</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{t.readOnlyBody}</p>
              </details>
              <div className="hidden md:flex flex-col gap-2">
                <h2 className="text-sm font-medium text-zinc-900">{t.readOnlyTitle}</h2>
                <p className="text-xs leading-5 text-zinc-500">{t.readOnlyBody}</p>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-[0_8px_30px_rgb(16,185,129,0.1)] md:p-5">
              <div id="ui-equity-chart" data-eq-wrapper="1">
                <div id="ui-equity-chart-points" className="hidden" suppressHydrationWarning>
                  {JSON.stringify(equityCurvePoints)}
                </div>
                <EquityAreaChart
                  points={equityCurvePoints}
                  lang={lang}
                  baseCurrency={baseCurrency}
                  displayCurrency={currency}
                  sharePriceTicker={sharePriceTicker}
                  useManualCompanySharePrice={useManualCompanySharePrice}
                  initialCompanySharePriceBase={Number(companySharePrice)}
                />
                <Script
                  id="me-equity-chart"
                  strategy="afterInteractive"
                  dangerouslySetInnerHTML={{
                    __html:
                      "(function(){try{var wrap=document.getElementById('ui-equity-chart'); if(!wrap||wrap.dataset.bound==='1') return; wrap.dataset.bound='1'; var dataEl=document.getElementById('ui-equity-chart-points'); var raw=dataEl?String(dataEl.textContent||'').trim():''; var points=[]; try{points=raw?JSON.parse(raw):[];}catch(_){points=[];} if(!points||!points.length) return; var init=function(){try{var root=wrap.querySelector('[data-eq-root=\"1\"]'); if(root&&root.getAttribute('data-eq-hydrated')==='1') return; var surface=root?root.querySelector('[data-eq-surface=\"1\"]'):null; if(!surface) return; var svg=surface.querySelector('[data-eq-svg=\"1\"]'); var line=surface.querySelector('[data-eq-line=\"1\"]'); var area=surface.querySelector('[data-eq-area=\"1\"]'); var vline=surface.querySelector('[data-eq-vline=\"1\"]'); var hline=surface.querySelector('[data-eq-hline=\"1\"]'); var dot=surface.querySelector('[data-eq-dot=\"1\"]'); var tip=surface.querySelector('[data-eq-tooltip=\"1\"]'); var tipDate=surface.querySelector('[data-eq-tooltip-date=\"1\"]'); var tipVal=surface.querySelector('[data-eq-tooltip-value=\"1\"]'); var startTxt=surface.querySelector('[data-eq-start=\"1\"]'); var endTxt=surface.querySelector('[data-eq-end=\"1\"]'); var btns=root?root.querySelectorAll('[data-eq-range-btn]'):[]; var state={range:'30D', subset:[]}; var pad={l:14,r:14,t:10,b:18}; var fmtDate=function(iso){try{var s=String(iso||''); if(s.length>=10){var m=s.slice(5,7); var d=s.slice(8,10); return m+'/'+d;} return s;}catch(_){return ''+iso;}}; var moneyFmt=(function(){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});}catch(_){return null;}})(); var fmtMoney=function(v){var num=Number(v); if(!isFinite(num)) num=0; if(moneyFmt) return moneyFmt.format(num); var sign=num<0?'-':''; num=Math.abs(num); var fixed=(Math.round(num*100)/100).toFixed(2); return sign+'$'+fixed;}; var sliceRange=function(r){var all=points.slice(); if(r==='7D') return all.slice(Math.max(0,all.length-7)); if(r==='30D') return all.slice(Math.max(0,all.length-30)); return all;}; var buildPath=function(sub){var rect=surface.getBoundingClientRect(); var w=Math.max(1,Math.floor(rect.width)); var h=Math.max(1,Math.floor(rect.height)); if(svg){try{svg.setAttribute('width',''+w); svg.setAttribute('height',''+h);}catch(_){}} var plotW=Math.max(1,w-pad.l-pad.r); var plotH=Math.max(1,h-pad.t-pad.b); var vals=[]; for(var i=0;i<sub.length;i++){var v=Number(sub[i]&&sub[i].value); vals.push(isFinite(v)?v:0);} var vmin=vals.length?Math.min.apply(null,vals):0; var vmax=vals.length?Math.max.apply(null,vals):0; var vr=vmax-vmin; var min=vr>0?Math.max(0,vmin-vr*0.06):0; var max=vr>0?(vmax+vr*0.06):(vmax>0?vmax*1.06:1); var den=Math.max(1e-9,max-min); var toX=function(i){return pad.l+(sub.length<=1?0:(i/(sub.length-1))*plotW);}; var toY=function(v){var vv=isFinite(v)?v:0; var t=Math.max(0,Math.min(1,(vv-min)/den)); return pad.t+plotH-(t*plotH);}; var d=''; for(var i=0;i<sub.length;i++){var x=toX(i), y=toY(vals[i]); d+=(i===0?'M ':' L ')+x.toFixed(2)+' '+y.toFixed(2);} var baseY=(pad.t+plotH).toFixed(2); var firstX=toX(0).toFixed(2); var lastX=toX(sub.length-1).toFixed(2); var areaD=d+' L '+lastX+' '+baseY+' L '+firstX+' '+baseY+' Z'; if(line) try{line.setAttribute('d',d);}catch(_){} if(area) try{area.setAttribute('d',areaD);}catch(_){} if(startTxt&&sub[0]) startTxt.textContent=fmtDate(sub[0].date); if(endTxt&&sub[sub.length-1]) endTxt.textContent=fmtDate(sub[sub.length-1].date); state.subset=sub; state._geom={w:w,h:h,plotW:plotW,plotH:plotH,min:min,max:max,den:den,toX:toX,toY:toY,vals:vals};}; var setRange=function(r){state.range=r; buildPath(sliceRange(r)); for(var i=0;i<btns.length;i++){var b=btns[i]; var k=b.getAttribute('data-eq-range-btn'); if(k===r){b.classList.add('bg-white'); b.classList.add('text-zinc-900'); b.classList.add('shadow-sm'); b.classList.remove('text-zinc-600');} else {b.classList.remove('bg-white'); b.classList.remove('text-zinc-900'); b.classList.remove('shadow-sm'); b.classList.add('text-zinc-600');}}; if(tip) tip.style.opacity='0'; if(vline) vline.setAttribute('opacity','0'); if(hline) hline.setAttribute('opacity','0'); if(dot) dot.setAttribute('opacity','0');}; var pickAt=function(clientX){if(!state._geom||!state.subset||state.subset.length<1) return; var rect=surface.getBoundingClientRect(); var xRaw=clientX-rect.left-pad.l; var x=Math.max(0,Math.min(state._geom.plotW,xRaw)); var n=state.subset.length; var idx=n<=1?0:Math.round((x/state._geom.plotW)*(n-1)); idx=Math.max(0,Math.min(n-1,idx)); var p=state.subset[idx]; var xv=state._geom.toX(idx); var yv=state._geom.toY(state._geom.vals[idx]); if(vline){vline.setAttribute('x1',xv); vline.setAttribute('x2',xv); vline.setAttribute('y1',pad.t); vline.setAttribute('y2',pad.t+state._geom.plotH); vline.setAttribute('opacity','1');} if(hline){hline.setAttribute('x1',pad.l); hline.setAttribute('x2',pad.l+state._geom.plotW); hline.setAttribute('y1',yv); hline.setAttribute('y2',yv); hline.setAttribute('opacity','1');} if(dot){dot.setAttribute('cx',xv); dot.setAttribute('cy',yv); dot.setAttribute('opacity','1');} if(tip){var left=Math.max(12,Math.min(state._geom.w-12,xv)); var boxH=102; var above=yv-boxH-10; var below=yv+10; var top=above>=8?above:(below<=state._geom.h-boxH-8?below:Math.max(8,Math.min(state._geom.h-boxH-8,above))); var preferLeft=xv>state._geom.w*0.55; tip.style.left=left+'px'; tip.style.top=top+'px'; tip.style.transform=preferLeft?'translateX(-100%)':'translateX(0)'; tip.style.marginLeft=preferLeft?'-10px':'10px'; tip.style.opacity='1';} if(tipDate) tipDate.textContent=String(p&&p.date?p.date:''); if(tipVal) tipVal.textContent=fmtMoney(p&&p.value);}; var onTouch=function(e){try{var t=e.touches&&e.touches[0]; if(!t) return; pickAt(t.clientX);}catch(_){}}; surface.addEventListener('touchstart',function(e){onTouch(e);},{passive:true}); surface.addEventListener('touchmove',function(e){onTouch(e);},{passive:true}); surface.addEventListener('click',function(e){try{pickAt(e.clientX);}catch(_){}}); for(var i=0;i<btns.length;i++){(function(b){var k=b.getAttribute('data-eq-range-btn'); if(!k) return; b.addEventListener('click',function(e){try{e.preventDefault();}catch(_){} setRange(k);},true);})(btns[i]);} setRange('30D');}catch(_){}}; setTimeout(init,650);}catch(_){}})();",
                  }}
                />
              </div>
            </section>
          </div>

        {err === "BUYBACK_CONFIRMED" ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 lg:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <div>{lang === "en" ? "Buyback confirmed." : lang === "zh-TW" ? "已確認收到回購款。" : "已确认收到回购款。"}</div>
              <a
                href={meUrlWith(meHref({}), { err: null })}
                className="btn-press inline-flex h-8 touch-manipulation items-center justify-center rounded-full border border-emerald-200 bg-white px-3 text-[11px] font-semibold text-emerald-700"
              >
                {lang === "en" ? "OK" : "知道了"}
              </a>
            </div>
          </div>
        ) : null}

        {buybacksToConfirm.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-[0_8px_30px_rgb(245,158,11,0.12)] md:p-5 lg:col-span-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">{lang === "en" ? "Buyback confirmation" : "离职回购待确认"}</h2>
              <p className="text-xs leading-5 text-zinc-600">
                {lang === "en"
                  ? "Finance/admin uploaded the transfer proof. Please confirm after you have received the payment."
                  : lang === "zh-TW"
                    ? "財務/管理員已上傳回購轉帳憑證。請在確認收到款項後點擊確認。"
                    : "财务/管理员已上传回购转账凭证。请在确认收到款项后点击确认。"}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {(buybacksToConfirm as Array<{
                id: string;
                requestedShares: number;
                totalCost: Prisma.Decimal;
                createdAt: Date;
                paymentProofDataUrl: string | null;
                paymentProofUploadedAt: Date | null;
              }>).map((r) => (
                <div key={r.id} className="rounded-2xl border border-amber-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3 text-xs text-zinc-600">
                    <div>
                      {lang === "en" ? "Shares" : "股数"} · <span className="font-mono text-zinc-900">{formatInt(Number(r.requestedShares ?? 0))}</span>
                    </div>
                    <div>
                      {lang === "en" ? "Amount" : "金额"} ·{" "}
                      <span className="font-mono font-semibold text-emerald-700">{formatMoney(r.totalCost, currency, baseCurrency)}</span>
                    </div>
                  </div>
                  {r.paymentProofDataUrl ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                      <img src={r.paymentProofDataUrl} alt={lang === "en" ? "Transfer proof" : "回购转账截图"} className="h-auto w-full object-contain" />
                    </div>
                  ) : null}
                  <form action={confirmBuybackPayment} className="mt-3" data-lock-submit="1">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="returnTo" value={meHref({})} />
                    <button className="btn-press inline-flex h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-amber-600 px-4 text-sm font-semibold text-white active:bg-amber-700">
                      {lang === "en" ? "Confirm received" : lang === "zh-TW" ? "確認已收到" : "确认已收到"}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="ui-card mt-6 p-4 md:p-6 lg:col-span-3">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-zinc-900">{t.exerciseRecords}</h2>
              <p className="text-xs leading-5 text-zinc-500">{t.exerciseRecordsDesc}</p>
            </div>
          </div>
          {exerciseRequests.length === 0 ? (
            <div className="mt-4 rounded-xl bg-[#f8fafc] px-4 py-8 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
              <div className="mx-auto flex max-w-md flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/5 bg-white text-zinc-700">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M6 8.5C6 6.01472 8.01472 4 10.5 4H13.5C15.9853 4 18 6.01472 18 8.5V19.5C18 20.3284 17.3284 21 16.5 21H7.5C6.67157 21 6 20.3284 6 19.5V8.5Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path d="M9 9H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M9 13H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M9 17H13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="mt-3 text-sm font-medium text-zinc-900">
                  {lang === "en" ? "No exercise records yet" : lang === "zh-TW" ? "暫無行權記錄" : "暂无行权记录"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {lang === "en"
                    ? "When you submit an exercise request, it will appear here."
                    : lang === "zh-TW"
                      ? "提交行權申請後，會在這裡顯示記錄。"
                      : "提交行权申请后，会在这里显示记录。"}
                </div>
                {remainingVestedToExercise > 0 ? (
                  <div className="mt-4 text-xs text-zinc-500">
                    {lang === "en"
                      ? "Use the Exercise button above to submit an exercise request."
                      : lang === "zh-TW"
                        ? "可在上方點「申請行權」提交申請。"
                        : "可在上方点「申请行权」提交申请。"}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:hidden">
                {exerciseRequests.map((r) => {
                  const chain = (r.paymentChain ?? "") as UsdtChain | "";
                  const tx = r.paymentTxHash ?? "";
                  const explorer =
                    chain === "BNB"
                      ? `https://bscscan.com/tx/${tx}`
                      : chain === "TRX"
                        ? `https://tronscan.org/#/transaction/${tx}`
                        : "";
                  const detailHref = `${meModalHref({ modal: "exercise_detail" })}&rid=${encodeURIComponent(r.id)}`;
                  const canCheckPayment = Boolean(tx) && r.status !== "COMPLETED";
                  const statusLabel =
                    r.status === "COMPLETED" ? t.completed : tx ? t.funded : t.pending;
                  const sharesLabel = formatInt(Number(r.requestedShares ?? 0));
                  const costLabel = formatMoney(r.totalCost, currency, baseCurrency);
                  const createdLabel = formatDate(new Date(r.createdAt), lang);
                  const verifiedLabel = r.paymentVerifiedAt ? formatDate(new Date(r.paymentVerifiedAt), lang) : "—";
                  const lockupLabel = r.lockupUntil ? formatDate(new Date(r.lockupUntil), lang) : "—";
                  return (
                    <div key={r.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                                r.status === "COMPLETED"
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : canCheckPayment
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                    : "border-zinc-200 bg-zinc-50 text-zinc-600"
                              }`}
                            >
                              {r.status === "COMPLETED" ? `· ${t.completed}` : canCheckPayment ? `· ${t.funded}` : t.pending}
                            </span>
                            <span className="max-w-full break-all font-mono text-xs text-zinc-600">
                              {r.grant?.agreementNo
                                ? r.grant.agreementNo
                                : (() => {
                                    const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
                                    const n = alloc.length;
                                    if (n > 1) return lang === "en" ? "Multiple" : "多个协议";
                                    if (n === 1) return lang === "en" ? "Single" : "自动分配";
                                    return "—";
                                  })()}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                            <div>
                              {t.shares} ·{" "}
                              <span className="ui-sensitive font-mono tabular-nums text-zinc-900">
                                {sharesLabel}
                              </span>
                            </div>
                            <div>
                              {t.cost} ·{" "}
                              <span className="ui-sensitive font-mono tabular-nums text-zinc-900">
                                {costLabel}
                              </span>
                            </div>
                            <div>
                              {t.chain} · <span className="font-mono text-zinc-900">{chain || "—"}</span>
                            </div>
                            <div className="min-w-0">
                              {t.txHash} ·{" "}
                              {tx && explorer ? (
                                <span className="inline-flex min-w-0 items-center gap-1">
                                  <a
                                    href={explorer}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 truncate font-mono text-indigo-600 hover:text-indigo-700"
                                  >
                                    {tx.slice(0, 10)}…{tx.slice(-8)}
                                  </a>
                                  <CopyButton value={tx} label={lang === "en" ? "Copy TxHash" : "复制 TxHash"} />
                                </span>
                              ) : (
                                <span className="text-zinc-500">—</span>
                              )}
                            </div>
                            <div>
                              {t.verifiedAt} · <span className="font-mono text-zinc-700">{verifiedLabel}</span>
                            </div>
                            <div>
                              {t.lockupUntil} · <span className="font-mono text-zinc-700">{lockupLabel}</span>
                            </div>
                          </div>
                        </div>
                        <a
                          href={detailHref}
                          data-exd-open
                          data-exd-rid={r.id}
                          data-exd-created={createdLabel}
                          data-exd-status={statusLabel}
                          data-exd-shares={sharesLabel}
                          data-exd-cost={costLabel}
                          data-exd-chain={chain || "—"}
                          data-exd-to={r.paymentToAddress ?? ""}
                          data-exd-tx={tx}
                          data-exd-verified={verifiedLabel}
                          data-exd-checkerr={formatPaymentCheckError(r.paymentCheckError, lang)}
                          className="btn-press btn-ripple inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
                        >
                          {lang === "en" ? "View" : "查看"}
                        </a>
                      </div>

                      {canCheckPayment ? (
                        <div className="mt-3 flex items-center gap-2">
                          <form action={checkExercisePayment} className="flex-1" data-lock-submit="1">
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="returnTo" value={detailHref} />
                            <button
                              className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
                              data-lock-text={lang === "en" ? "Checking…" : "检查中…"}
                            >
                              {t.checkNow}
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-black/5 bg-white sm:block">
                <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                <thead className="bg-[#f8fafc] text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t.status}</th>
                    <th className="px-4 py-3 font-medium">{t.agreement}</th>
                    <th className="px-4 py-3 font-medium">{t.shares}</th>
                    <th className="px-4 py-3 font-medium">{t.cost}</th>
                    <th className="px-4 py-3 font-medium">{t.chain}</th>
                    <th className="px-4 py-3 font-medium">{t.txHash}</th>
                    <th className="px-4 py-3 font-medium">{t.verifiedAt}</th>
                    <th className="px-4 py-3 font-medium">{t.lockupUntil}</th>
                    <th className="px-4 py-3 font-medium">{lang === "en" ? "Details" : "详情"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {exerciseRequests.map((r) => {
                    const chain = (r.paymentChain ?? "") as UsdtChain | "";
                    const tx = r.paymentTxHash ?? "";
                    const explorer =
                      chain === "BNB"
                        ? `https://bscscan.com/tx/${tx}`
                        : chain === "TRX"
                          ? `https://tronscan.org/#/transaction/${tx}`
                          : "";
                    const detailHref = `${meModalHref({ modal: "exercise_detail" })}&rid=${encodeURIComponent(r.id)}`;
                    const canCheckPayment = Boolean(tx) && r.status !== "COMPLETED";
                    const statusLabel =
                      r.status === "COMPLETED" ? t.completed : tx ? t.funded : t.pending;
                    const sharesLabel = formatInt(Number(r.requestedShares ?? 0));
                    const costLabel = formatMoney(r.totalCost, currency, baseCurrency);
                    const createdLabel = formatDate(new Date(r.createdAt), lang);
                    const verifiedLabel = r.paymentVerifiedAt ? formatDate(new Date(r.paymentVerifiedAt), lang) : "—";
                    const lockupLabel = r.lockupUntil ? formatDate(new Date(r.lockupUntil), lang) : "—";
                    return (
                      <tr key={r.id} className="transition-colors hover:bg-[#f8fafc]">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
                              r.status === "COMPLETED"
                                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                : canCheckPayment
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                  : "border-black/5 bg-[#f8fafc] text-zinc-600"
                            }`}
                          >
                            {r.status === "COMPLETED"
                              ? `· ${t.completed}`
                              : canCheckPayment
                                ? `· ${t.funded}`
                                : t.pending}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          <span
                            className="inline-block max-w-[180px] truncate font-mono"
                            title={
                              r.grant?.agreementNo
                                ? r.grant.agreementNo
                                : (() => {
                                    const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
                                    const n = alloc.length;
                                    if (n > 1) return lang === "en" ? "Multiple" : "多个协议";
                                    if (n === 1) return lang === "en" ? "Single" : "自动分配";
                                    return "—";
                                  })()
                            }
                          >
                            {r.grant?.agreementNo
                              ? r.grant.agreementNo
                              : (() => {
                                  const alloc = readAllocationFromPaymentRaw(r.paymentRaw);
                                  const n = alloc.length;
                                  if (n > 1) return lang === "en" ? "Multiple" : "多个协议";
                                  if (n === 1) return lang === "en" ? "Single" : "自动分配";
                                  return "—";
                                })()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-900">
                          <span className="ui-sensitive font-mono tabular-nums">{sharesLabel}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-900">
                          <span className="ui-sensitive font-mono tabular-nums">{costLabel}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          <span className="font-mono">{chain || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {tx && explorer ? (
                            <span className="inline-flex items-center gap-1">
                              <a
                                href={explorer}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-indigo-600 hover:text-indigo-700"
                              >
                                {tx.slice(0, 10)}…{tx.slice(-8)}
                              </a>
                              <CopyButton value={tx} label={lang === "en" ? "Copy TxHash" : "复制 TxHash"} />
                            </span>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {verifiedLabel}
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {lockupLabel}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {canCheckPayment ? (
                              <form action={checkExercisePayment} data-lock-submit="1">
                                <input type="hidden" name="lang" value={lang} />
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="returnTo" value={detailHref} />
                                <button
                                  className="h-7 rounded-lg bg-indigo-600 px-2 text-[11px] font-medium text-white hover:bg-indigo-700"
                                  data-lock-text={lang === "en" ? "Checking…" : "检查中…"}
                                >
                                  {t.checkNow}
                                </button>
                              </form>
                            ) : null}
                            <a
                              href={detailHref}
                              data-exd-open
                              data-exd-rid={r.id}
                              data-exd-created={createdLabel}
                              data-exd-status={statusLabel}
                              data-exd-shares={sharesLabel}
                              data-exd-cost={costLabel}
                              data-exd-chain={chain || "—"}
                              data-exd-to={r.paymentToAddress ?? ""}
                              data-exd-tx={tx}
                              data-exd-verified={verifiedLabel}
                              data-exd-checkerr={formatPaymentCheckError(r.paymentCheckError, lang)}
                              className="text-indigo-600 hover:text-indigo-700"
                            >
                              {lang === "en" ? "View" : "查看"}
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

              {exerciseHistoryTotalPages > 1 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:rounded-xl md:border md:border-zinc-200 md:bg-zinc-50 md:shadow-none">
                  <Link
                    href={meUrlWith(meModalHref({}), { hp: String(Math.max(1, historyPage - 1)) })}
                    className={`btn-press inline-flex h-10 touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-medium ${
                      historyPage <= 1 ? "pointer-events-none bg-zinc-100 text-zinc-400" : "bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                    scroll={false}
                  >
                    上一页
                  </Link>
                  <div className="text-sm text-zinc-600">
                    第 <span className="font-mono tabular-nums text-zinc-900">{historyPage}</span> /{" "}
                    <span className="font-mono tabular-nums text-zinc-900">{exerciseHistoryTotalPages}</span> 页
                  </div>
                  <Link
                    href={meUrlWith(meModalHref({}), { hp: String(Math.min(exerciseHistoryTotalPages, historyPage + 1)) })}
                    className={`btn-press inline-flex h-10 touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-medium ${
                      historyPage >= exerciseHistoryTotalPages
                        ? "pointer-events-none bg-zinc-100 text-zinc-400"
                        : "bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                    scroll={false}
                  >
                    下一页
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </section>
        </div>

        <section className="ui-card mt-6 p-4 md:p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-zinc-900">我的协议记录</h2>
              <p className="text-xs leading-5 text-zinc-500">授予记录 + 未来每笔成熟时间表</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4">
            {grants.length === 0 ? (
              <div className="rounded-2xl bg-[#f8fafc] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl border border-black/5 bg-white p-2 text-zinc-500">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M7 3.75H17C18.2426 3.75 19.25 4.75736 19.25 6V18C19.25 19.2426 18.2426 20.25 17 20.25H7C5.75736 20.25 4.75 19.2426 4.75 18V6C4.75 4.75736 5.75736 3.75 7 3.75Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path d="M8 8H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M8 12H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900">
                      {lang === "en" ? "No grant yet" : lang === "zh-TW" ? "暫無授予協議" : "暂无授予协议"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-zinc-500">
                      {lang === "en"
                        ? "Once your grants are created by the admin, they will appear here with vesting schedules."
                        : lang === "zh-TW"
                          ? "管理員建立授予後，將在此顯示授予記錄與成熟時間表。"
                          : "管理员创建授予后，将在此显示授予记录与成熟时间表。"}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              grants.map((g) => {
                const vested = g.vestingRecords
                  .filter((v) => v.status === "VESTED")
                  .reduce((sum, v) => sum + v.shares, 0);
                const unvested = g.vestingRecords
                  .filter((v) => v.status === "UNVESTED")
                  .reduce((sum, v) => sum + v.shares, 0);
                const forfeited = g.vestingRecords
                  .filter((v) => v.status === "FORFEITED")
                  .reduce((sum, v) => sum + v.shares, 0);
                const exercised = completedByGrant.get(g.id) ?? 0;
                const exercisable = Math.max(0, vested - exercised);
                const schedulePreview = g.vestingRecords;
                const scheduleForProgress = schedulePreview.filter((v) => v.status !== "FORFEITED");
                const gDenom = scheduleForProgress.reduce((sum, v) => sum + v.shares, 0);
                const gProgress = gDenom > 0 ? Math.min(vested / gDenom, 1) : 0;
                const nextV = schedulePreview.find((v) => v.status === "UNVESTED")?.vestDate ?? null;
                const endV = schedulePreview[schedulePreview.length - 1]?.vestDate ?? null;
                const gMarkers = (() => {
                  const rows = scheduleForProgress;
                  const n = rows.length;
                  if (n <= 1 || gDenom <= 0) return [];
                  const target = 6;
                  const step = Math.max(1, Math.ceil(n / target));
                  const idxs: number[] = [];
                  for (let i = step - 1; i < n; i += step) idxs.push(i);
                  if (!idxs.includes(n - 1)) idxs.push(n - 1);
                  let cum = 0;
                  const out: number[] = [];
                  const idxSet = new Set(idxs);
                  for (let i = 0; i < n; i += 1) {
                    cum += Math.max(0, Math.floor(rows[i]!.shares));
                    if (!idxSet.has(i)) continue;
                    const pct = gDenom > 0 ? cum / gDenom : 0;
                    out.push(pct);
                  }
                  return out;
                })();

                return (
                  <div
                    key={g.id}
                    className="ui-card ui-card-hover p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900">协议 {g.agreementNo}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          授予日期 {formatDate(g.grantDate, lang)} · 行权价{" "}
                          <span className="font-mono">{formatMoney(g.strikePrice, currency, baseCurrency)}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 md:mt-0 md:items-end">
                        <div className="flex items-center justify-end">
                          <Link
                            href={meUrlWith(meModalHref({}), { modal: "certificate", gid: g.id })}
                            data-cert-open
                            data-cert-gid={g.id}
                            data-agreement-no={g.agreementNo}
                            data-total-shares={formatInt(g.totalShares)}
                            data-strike-label={formatMoney(g.strikePrice, currency, baseCurrency)}
                            data-grant-date-label={formatDate(g.grantDate, lang)}
                            className="btn-press btn-ripple inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 md:h-8 md:px-3"
                            scroll={false}
                          >
                            {t.viewCertificate}
                          </Link>
                        </div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-xl bg-[#f8fafc] px-3 py-2 sm:px-4 sm:py-3">
                          <div className="text-xs text-zinc-500">授予总股数</div>
                          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900">
                            {formatInt(g.totalShares)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-[#f8fafc] px-3 py-2 sm:px-4 sm:py-3">
                          <div className="text-xs text-zinc-500">已成熟</div>
                          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900">
                            {formatInt(vested)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-[#f8fafc] px-3 py-2 sm:px-4 sm:py-3">
                          <div className="text-xs text-zinc-500">未成熟</div>
                          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900">
                            {formatInt(unvested)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-[#f8fafc] px-3 py-2 sm:px-4 sm:py-3">
                          <div className="text-xs text-zinc-500">可行权</div>
                          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900">
                            {formatInt(exercisable)}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">
                            已行权 <span className="font-mono tabular-nums text-zinc-800">{formatInt(exercised)}</span>
                          </div>
                        </div>
                        </div>
                      </div>
                    </div>
                    {forfeited > 0 ? (
                      <div className="mt-3 text-xs text-zinc-500">
                        已失效 <span className="font-mono text-zinc-800">{formatInt(forfeited)}</span> 股
                      </div>
                    ) : null}

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>成熟进度 {Math.round(gProgress * 100)}%</span>
                        <span>
                          {nextV ? `下次成熟 ${formatDate(nextV, lang)}` : "—"}
                          {endV ? ` · 完全成熟 ${formatDate(endV, lang)}` : ""}
                        </span>
                      </div>
                      <AnimatedProgressBar
                        percent={gProgress}
                        barClassName="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300"
                        heightClassName="h-3 sm:h-2"
                        markers={gMarkers}
                        markerActiveClassName="bg-emerald-400"
                        markerInactiveClassName="bg-zinc-300"
                      />
                    </div>

                    {(() => {
                      const upcoming = schedulePreview.filter((v) => v.status === "UNVESTED").slice(0, 3);
                      return (
                        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-medium text-zinc-700">成熟时间表</div>
                            <div className="text-[11px] text-zinc-500">共 {schedulePreview.length} 条</div>
                          </div>

                          {upcoming.length === 0 ? (
                            <div className="mt-2 text-xs text-zinc-600">当前协议已无未成熟记录。</div>
                          ) : (
                            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                              {upcoming.map((v) => (
                                <div key={`${g.id}-up-${v.vestDate.toISOString()}`} className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                                  <div className="text-[11px] text-zinc-500">预计成熟</div>
                                  <div className="mt-0.5 text-sm font-semibold text-zinc-900">{formatDate(v.vestDate, lang)}</div>
                                  <div className="mt-0.5 text-[11px] text-zinc-600">
                                    <span className="font-mono tabular-nums text-zinc-900">{formatInt(v.shares)}</span> 股
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <details className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
                            <summary className="cursor-pointer text-xs font-medium text-zinc-900">
                              查看完整时间表
                            </summary>
                            <div className="mt-3 max-h-[420px] overscroll-contain overflow-auto rounded-xl border border-black/5 bg-white">
                              <div className="flex flex-col gap-2 p-3 sm:hidden">
                                {schedulePreview.map((v) => (
                                  <div key={`${g.id}-${v.vestDate.toISOString()}`} className="rounded-xl border border-black/5 bg-white px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[11px] text-zinc-500">归属日期</div>
                                        <div className="mt-0.5 text-sm font-semibold text-zinc-900">{formatDate(v.vestDate, lang)}</div>
                                      </div>
                                      <span
                                        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs ${
                                          v.status === "VESTED"
                                            ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                            : v.status === "FORFEITED"
                                              ? "border-black/5 bg-[#f8fafc] text-zinc-600"
                                              : "border-amber-200 bg-amber-50 text-amber-800"
                                        }`}
                                      >
                                        {v.status === "VESTED" ? "· 已成熟" : v.status === "FORFEITED" ? "已失效" : "未成熟"}
                                      </span>
                                    </div>
                                    <div className="mt-2 text-[11px] text-zinc-600">
                                      归属股数 · <span className="font-mono tabular-nums text-zinc-900">{formatInt(v.shares)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <table className="hidden w-full border-collapse text-left text-xs sm:table">
                                <thead className="bg-[#f8fafc] text-zinc-600">
                                  <tr>
                                    <th className="px-3 py-2 font-medium sm:px-4 sm:py-3">归属日期</th>
                                    <th className="px-3 py-2 font-medium sm:px-4 sm:py-3">归属股数</th>
                                    <th className="px-3 py-2 font-medium sm:px-4 sm:py-3">状态</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5">
                                  {schedulePreview.map((v) => (
                                    <tr key={`${g.id}-${v.vestDate.toISOString()}`} className="transition-colors hover:bg-[#f8fafc]">
                                      <td className="px-3 py-2 text-zinc-700 sm:px-4">{formatDate(v.vestDate, lang)}</td>
                                      <td className="px-3 py-2 font-mono tabular-nums text-zinc-900 sm:px-4">{formatInt(v.shares)}</td>
                                      <td className="px-3 py-2 sm:px-4">
                                        <span
                                          className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
                                            v.status === "VESTED"
                                              ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                              : v.status === "FORFEITED"
                                                ? "border-black/5 bg-[#f8fafc] text-zinc-600"
                                                : "border-amber-200 bg-amber-50 text-amber-800"
                                          }`}
                                        >
                                          {v.status === "VESTED" ? "· 已成熟" : v.status === "FORFEITED" ? "已失效" : "未成熟"}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
