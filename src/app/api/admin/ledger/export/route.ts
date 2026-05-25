import { prisma } from "@/lib/prisma";
import { getSessionSecret, verifySession } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { BUSINESS_TIMEZONE, ymdInTimeZone } from "@/lib/datetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Currency = "USD" | "HKD" | "CNY";

function parseCurrency(v: string | null): Currency {
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

function formatInt(n: number) {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(n) ? n : 0);
}

function formatMoney(d: Prisma.Decimal, currency: Currency, baseCurrency: Currency) {
  const converted = convertMoney(d, baseCurrency, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(converted.toFixed(2)));
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toYmd(now: Date) {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  if (!payload) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  if (payload.role !== "SUPER_ADMIN" && payload.role !== "FINANCE") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const dept = String(url.searchParams.get("dept") ?? "").trim();
  const stRaw = String(url.searchParams.get("st") ?? "").trim();
  const status = stRaw === "ACTIVE" || stRaw === "TERMINATED" ? stRaw : "";
  const currency = parseCurrency(url.searchParams.get("ccy"));

  const settings = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      companySharePrice: true,
      sharePriceCurrency: true,
      terminationOptionExpiryDays: true,
      updatedAt: true,
    },
  });

  const companySharePrice = settings?.companySharePrice ?? new Prisma.Decimal(0);
  const baseCurrency = parseCurrency(String(settings?.sharePriceCurrency ?? "USD"));
  const terminationOptionExpiryDays = settings?.terminationOptionExpiryDays ?? 90;

  const employees = (await prisma.employee.findMany({
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
      terminatedAt: true,
      updatedAt: true,
      user: { select: { account: true } as never } as never,
    },
    take: 5000,
  } as never)) as unknown as Array<{
    id: string;
    name: string;
    department: string;
    status: "ACTIVE" | "TERMINATED";
    terminatedAt: Date | null;
    updatedAt: Date;
    user: { account: string } | null;
  }>;

  const employeeIds = employees.map((e) => e.id);
  const now = new Date();

  const [grantByEmployee, vestedByEmployee, exercisedByEmployee, nextVest, endVest, grantsForStrike] =
    employeeIds.length > 0
      ? await Promise.all([
          prisma.grant.groupBy({
            by: ["employeeId"],
            _sum: { totalShares: true },
            where: { employeeId: { in: employeeIds } },
          }),
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            _sum: { shares: true },
            where: { employeeId: { in: employeeIds }, status: "VESTED" },
          }),
          prisma.exerciseRequest.groupBy({
            by: ["employeeId"],
            _sum: { requestedShares: true },
            _max: { completedAt: true },
            where: { employeeId: { in: employeeIds }, status: "COMPLETED", isBuybackOrCancel: false },
          }),
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            where: { employeeId: { in: employeeIds }, status: "UNVESTED" },
            _min: { vestDate: true },
          }),
          prisma.vestingRecord.groupBy({
            by: ["employeeId"],
            where: { employeeId: { in: employeeIds } },
            _max: { vestDate: true },
          }),
          prisma.grant.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, totalShares: true, strikePrice: true },
          }),
        ])
      : [[], [], [], [], [], []];

  const totalGrantedByEmployee = new Map(grantByEmployee.map((x) => [x.employeeId, x._sum.totalShares ?? 0]));
  const vestedByEmployeeMap = new Map(vestedByEmployee.map((x) => [x.employeeId, x._sum.shares ?? 0]));
  const exercisedByEmployeeMap = new Map(exercisedByEmployee.map((x) => [x.employeeId, x._sum.requestedShares ?? 0]));
  const lastExerciseAtByEmployee = new Map(exercisedByEmployee.map((x) => [x.employeeId, x._max.completedAt ?? null] as const));
  const nextVestByEmployee = new Map(nextVest.map((x) => [x.employeeId, x._min.vestDate ?? null] as const));
  const endVestByEmployee = new Map(endVest.map((x) => [x.employeeId, x._max.vestDate ?? null] as const));

  const strikeAggByEmployee = new Map<
    string,
    { sumShares: number; sumStrikeValue: Prisma.Decimal; minStrike: Prisma.Decimal | null; maxStrike: Prisma.Decimal | null }
  >();
  for (const g of grantsForStrike) {
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

  const header = [
    "员工",
    "账号",
    "部门",
    "状态",
    "行权价(均价)",
    "行权价范围",
    "已授予",
    "已成熟",
    "已行权",
    "成熟进度",
    "已成熟价值",
    "下次成熟",
    "完全成熟",
    "离职到期日",
    "离职剩余天",
    "最近行权",
  ];

  const rows = employees.map((e) => {
    const totalGranted = totalGrantedByEmployee.get(e.id) ?? 0;
    const vestedShares = vestedByEmployeeMap.get(e.id) ?? 0;
    const exercisedShares = exercisedByEmployeeMap.get(e.id) ?? 0;
    const lastExerciseAt = (lastExerciseAtByEmployee.get(e.id) as unknown as Date | null) ?? null;
    const progress = totalGranted > 0 ? Math.min(vestedShares / totalGranted, 1) : 0;
    const nextV = (nextVestByEmployee.get(e.id) as unknown as Date | null) ?? null;
    const endV = (endVestByEmployee.get(e.id) as unknown as Date | null) ?? null;

    const vestedValue = companySharePrice.mul(vestedShares);
    const strikeAgg = strikeAggByEmployee.get(e.id);
    const avgStrike =
      strikeAgg && strikeAgg.sumShares > 0 ? strikeAgg.sumStrikeValue.div(strikeAgg.sumShares) : null;
    const strikeMin = strikeAgg?.minStrike ?? null;
    const strikeMax = strikeAgg?.maxStrike ?? null;

    const terminatedAt = e.terminatedAt ?? e.updatedAt;
    const expiryAt =
      e.status === "TERMINATED"
        ? new Date(terminatedAt.getTime() + terminationOptionExpiryDays * 24 * 60 * 60 * 1000)
        : null;
    const daysLeft =
      expiryAt && e.status === "TERMINATED"
        ? Math.ceil((expiryAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null;

    return [
      e.name,
      e.user?.account ?? "",
      e.department,
      e.status === "ACTIVE" ? "在职" : "离职",
      avgStrike ? formatMoney(avgStrike, currency, baseCurrency) : "",
      strikeMin && strikeMax && !strikeMin.equals(strikeMax)
        ? `${formatMoney(strikeMin, currency, baseCurrency)} ~ ${formatMoney(strikeMax, currency, baseCurrency)}`
        : strikeMin
          ? formatMoney(strikeMin, currency, baseCurrency)
          : "",
      formatInt(totalGranted),
      formatInt(vestedShares),
      exercisedShares > 0 ? formatInt(exercisedShares) : "",
      `${Math.round(progress * 100)}%`,
      totalGranted > 0 ? formatMoney(vestedValue, currency, baseCurrency) : formatMoney(vestedValue, currency, baseCurrency),
      nextV ? ymdInTimeZone(nextV, BUSINESS_TIMEZONE) : "",
      endV ? ymdInTimeZone(endV, BUSINESS_TIMEZONE) : "",
      expiryAt ? ymdInTimeZone(expiryAt, BUSINESS_TIMEZONE) : "",
      daysLeft == null ? "" : String(daysLeft),
      lastExerciseAt ? ymdInTimeZone(lastExerciseAt, BUSINESS_TIMEZONE) : "",
    ];
  });

  const title = "员工期权台账总览";
  const html =
    `<!doctype html><html><head><meta charset="utf-8" />` +
    `<title>${escapeHtml(title)}</title></head><body>` +
    `<table border="1" cellspacing="0" cellpadding="4">` +
    `<tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>` +
    rows
      .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c ?? ""))}</td>`).join("")}</tr>`)
      .join("") +
    `</table></body></html>`;

  const filename = `${title}-${toYmd(new Date())}.xls`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
