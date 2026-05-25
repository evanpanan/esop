import { prisma } from "@/lib/prisma";
import { computeLatestSharePrice } from "@/lib/sharePrice";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function ymdInTz(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return y && m && day ? `${y}-${m}-${day}` : "";
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const host = String(request.headers.get("host") ?? "");
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (secret) {
    const headerSecret = request.headers.get("x-cron-secret");
    if (headerSecret !== secret) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  } else {
    if (process.env.NODE_ENV !== "development" || !isLocalHost || url.searchParams.get("run") !== "1") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
  }

  const timeZone = "Asia/Shanghai";
  const now = new Date();

  const settings = await prisma.globalSettings.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      useManualCompanySharePrice: true,
      sharePriceTicker: true,
      sharePriceAutoRefreshedAt: true,
      companySharePrice: true,
      sharePriceCurrency: true,
      sharePriceAvg30Usd: true,
    } as unknown as {
      id: true;
      useManualCompanySharePrice: true;
      sharePriceTicker: true;
      sharePriceAutoRefreshedAt: true;
      companySharePrice: true;
      sharePriceCurrency: true;
      sharePriceAvg30Usd: true;
    },
  });

  if (!settings) {
    return NextResponse.json({ ok: false, skipped: true, reason: "NO_SETTINGS" });
  }
  const tickerRaw = String(settings.sharePriceTicker ?? "").trim();
  if (!tickerRaw) {
    return NextResponse.json({ ok: false, skipped: true, reason: "NO_TICKER" });
  }
  if (settings.useManualCompanySharePrice) {
    return NextResponse.json({ ok: false, skipped: true, reason: "MANUAL_PRICE_ENABLED" });
  }

  const last = settings.sharePriceAutoRefreshedAt ? new Date(String(settings.sharePriceAutoRefreshedAt)) : null;
  const today = ymdInTz(now, timeZone);
  const lastDay = last ? ymdInTz(last, timeZone) : "";
  if (today && lastDay && today === lastDay) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ALREADY_REFRESHED_TODAY",
      at: settings.sharePriceAutoRefreshedAt,
      timeZone,
    });
  }

  const latest = await computeLatestSharePrice({ sharePriceTicker: tickerRaw });
  const update: Record<string, unknown> = {
    companySharePrice: latest.price,
    sharePriceTicker: latest.sharePriceTicker,
    sharePriceCurrency: latest.sharePriceCurrency,
    sharePriceAutoRefreshedAt: now,
  };
  if (latest.sharePriceAvg30Usd) update.sharePriceAvg30Usd = latest.sharePriceAvg30Usd;

  await prisma.globalSettings.update({
    where: { id: settings.id },
    data: update as never,
  });

  return NextResponse.json({
    ok: true,
    skipped: false,
    timeZone,
    refreshedAt: now.toISOString(),
    price: latest.price.toFixed(6),
    currency: latest.sharePriceCurrency,
    avg30Error: latest.avg30Error,
  });
}
