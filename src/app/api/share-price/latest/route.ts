import { prisma } from "@/lib/prisma";
import { getSessionSecret, verifySession } from "@/lib/auth";
import { computeLatestSharePrice } from "@/lib/sharePrice";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

let lastFetchMs = 0;
let lastPayload: unknown = null;
let lastKey = "";

function nyParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { weekday, hour, minute };
}

function isUsMarketOpen(now: Date) {
  const { weekday, hour, minute } = nyParts(now);
  const isWeekday = weekday === "Mon" || weekday === "Tue" || weekday === "Wed" || weekday === "Thu" || weekday === "Fri";
  if (!isWeekday) return false;
  const t = hour * 60 + minute;
  return t >= 9 * 60 + 30 && t < 16 * 60;
}

function recommendedPollMs(now: Date) {
  return isUsMarketOpen(now) ? 15_000 : 60 * 60 * 1000;
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("esop_session")?.value ?? "";
  const payload = token ? verifySession(token, getSessionSecret()) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED", pollMs: 60 * 60 * 1000 }, { status: 401 });
  }

  const now = new Date();
  const pollMs = recommendedPollMs(now);
  const minFetchMs = isUsMarketOpen(now) ? 12_000 : pollMs;

  const settings = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      useManualCompanySharePrice: true,
      manualCompanySharePrice: true,
      manualCompanySharePriceUpdatedAt: true,
      sharePriceTicker: true,
      companySharePrice: true,
      sharePriceCurrency: true,
      sharePriceAvg30Usd: true,
      updatedAt: true,
    } as unknown as {
      id: true;
      useManualCompanySharePrice: true;
      manualCompanySharePrice: true;
      manualCompanySharePriceUpdatedAt: true;
      sharePriceTicker: true;
      companySharePrice: true;
      sharePriceCurrency: true;
      sharePriceAvg30Usd: true;
      updatedAt: true;
    },
  });

  if (!settings) {
    const out = { ok: false, error: "NO_SETTINGS", pollMs };
    lastFetchMs = Date.now();
    lastPayload = out;
    lastKey = "NO_SETTINGS";
    return NextResponse.json(out);
  }

  const tickerRaw = String(settings.sharePriceTicker ?? "").trim();
  const cacheKey = `${settings.id}:${tickerRaw}:${settings.useManualCompanySharePrice ? "M" : "A"}:${
    settings.updatedAt instanceof Date ? settings.updatedAt.getTime() : 0
  }`;
  if (lastPayload && lastKey === cacheKey && Date.now() - lastFetchMs < minFetchMs) {
    return NextResponse.json(lastPayload);
  }

  if (settings.useManualCompanySharePrice) {
    const manual =
      (settings as unknown as { manualCompanySharePrice?: unknown }).manualCompanySharePrice ?? settings.companySharePrice;
    const manualUpdatedAt =
      (settings as unknown as { manualCompanySharePriceUpdatedAt?: Date | null }).manualCompanySharePriceUpdatedAt ??
      settings.updatedAt ??
      null;
    const out = {
      ok: true,
      skipped: true,
      reason: "MANUAL_PRICE_ENABLED",
      ticker: tickerRaw,
      price: Number(manual ?? 0),
      currency: String(settings.sharePriceCurrency ?? "USD"),
      avg30Usd: settings.sharePriceAvg30Usd ? Number(settings.sharePriceAvg30Usd) : null,
      updatedAt: manualUpdatedAt?.toISOString?.() ?? null,
      pollMs: 60 * 60 * 1000,
    };
    lastFetchMs = Date.now();
    lastPayload = out;
    lastKey = cacheKey;
    return NextResponse.json(out);
  }

  if (!tickerRaw) {
    const out = { ok: false, error: "NO_TICKER", pollMs };
    lastFetchMs = Date.now();
    lastPayload = out;
    lastKey = `${settings.id}:NO_TICKER`;
    return NextResponse.json(out);
  }

  try {
    const latest = await computeLatestSharePrice({ sharePriceTicker: tickerRaw });
    if (payload.role !== "EMPLOYEE") {
      const update: Record<string, unknown> = {
        companySharePrice: latest.price,
        sharePriceTicker: latest.sharePriceTicker,
        sharePriceCurrency: latest.sharePriceCurrency,
      };
      if (latest.sharePriceAvg30Usd) update.sharePriceAvg30Usd = latest.sharePriceAvg30Usd;

      await prisma.globalSettings.update({
        where: { id: settings.id },
        data: update as never,
      });
    }

    const out = {
      ok: true,
      skipped: false,
      ticker: latest.sharePriceTicker,
      price: Number(latest.price),
      currency: latest.sharePriceCurrency,
      avg30Usd: latest.sharePriceAvg30Usd ? Number(latest.sharePriceAvg30Usd) : null,
      checkedAt: now.toISOString(),
      persisted: payload.role !== "EMPLOYEE",
      pollMs,
    };
    lastFetchMs = Date.now();
    lastPayload = out;
    lastKey = cacheKey;
    return NextResponse.json(out);
  } catch {
    const out = {
      ok: false,
      error: "FETCH_FAILED",
      ticker: tickerRaw,
      pollMs,
    };
    lastFetchMs = Date.now();
    lastPayload = out;
    lastKey = cacheKey;
    return NextResponse.json(out, { status: 502 });
  }
}
