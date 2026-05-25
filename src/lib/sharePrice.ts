import { Prisma } from "@prisma/client";

export type Currency = "USD" | "HKD" | "CNY";

export function currencyToUsdRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

export function normalizeTickerInput(v: string) {
  const raw = v.trim();
  if (!raw) return "";
  const cleaned = raw.replaceAll(" ", "").toLowerCase();
  if (!cleaned) return "";
  if (cleaned.includes(".")) return cleaned;
  return `${cleaned}.us`;
}

function toYahooSymbol(stooqSymbol: string) {
  const s = stooqSymbol.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.endsWith(".us")) return lower.slice(0, -3).toUpperCase();
  if (lower.endsWith(".hk")) return `${lower.slice(0, -3).toUpperCase()}.HK`;
  if (lower.endsWith(".sh")) return `${lower.slice(0, -3).toUpperCase()}.SS`;
  if (lower.endsWith(".sz")) return `${lower.slice(0, -3).toUpperCase()}.SZ`;
  return s.toUpperCase();
}

function toTencentSymbol(stooqSymbol: string) {
  const s = stooqSymbol.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.endsWith(".us")) return `us${lower.slice(0, -3).toUpperCase()}`;
  if (lower.endsWith(".hk")) return `hk${lower.slice(0, -3).toUpperCase().padStart(5, "0")}`;
  if (lower.endsWith(".sh")) return `sh${lower.slice(0, -3)}`;
  if (lower.endsWith(".sz")) return `sz${lower.slice(0, -3)}`;
  return null;
}

export function inferCurrencyFromSymbol(symbol: string): Currency {
  const s = symbol.trim().toLowerCase();
  if (s.endsWith(".hk")) return "HKD";
  if (s.endsWith(".sh") || s.endsWith(".sz") || s.endsWith(".cn")) return "CNY";
  return "USD";
}

async function fetchPriceFromYahooQuote(symbol: string) {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) throw new Error("INVALID_SYMBOL");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbol)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const data = (await res.json()) as {
    quoteResponse?: { result?: Array<{ regularMarketPrice?: number | null }> };
  };
  const price = data.quoteResponse?.result?.[0]?.regularMarketPrice ?? null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw new Error("INVALID_PRICE");
  return price;
}

async function fetchPriceFromStooq(symbol: string) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const text = (await res.text()).trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("INVALID_RESPONSE");
  const header = lines[0].split(",");
  const row = lines[1].split(",");
  const idx = header.findIndex((x) => x.trim().toLowerCase() === "close");
  if (idx < 0) throw new Error("INVALID_RESPONSE");
  const closeRaw = (row[idx] ?? "").trim();
  const close = Number(closeRaw);
  if (!Number.isFinite(close) || close <= 0) throw new Error("INVALID_PRICE");
  return close;
}

async function fetchPriceFromTencent(symbol: string) {
  const tencentSymbol = toTencentSymbol(symbol);
  if (!tencentSymbol) throw new Error("INVALID_SYMBOL");
  const url = `https://qt.gtimg.cn/q=${encodeURIComponent(tencentSymbol)}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "text/plain,*/*",
      "user-agent": "esop/1.0",
      referer: "https://qt.gtimg.cn/",
    },
  });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const text = (await res.text()).trim();
  const match = text.match(/="([^"]+)"/);
  const payload = match?.[1] ?? "";
  const parts = payload.split("~");
  const priceRaw = parts[3] ?? "";
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) throw new Error("INVALID_PRICE");
  return price;
}

async function fetchAvgCloseFromStooqDaily(symbol: string, tradingDays: number) {
  const days = Math.max(1, Math.floor(tradingDays));
  const apiKey = (process.env.STOOQ_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("STOOQ_APIKEY_REQUIRED");
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const text = (await res.text()).trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("INVALID_RESPONSE");
  const header = lines[0].split(",");
  const closeIdx = header.findIndex((x) => x.trim().toLowerCase() === "close");
  if (closeIdx < 0) throw new Error("INVALID_RESPONSE");

  const closes: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i].split(",");
    const raw = (row[closeIdx] ?? "").trim();
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) closes.push(v);
  }
  if (closes.length < days) throw new Error("NOT_ENOUGH_DATA");
  const recent = closes.slice(-days);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  const avg = sum / days;
  if (!Number.isFinite(avg) || avg <= 0) throw new Error("INVALID_PRICE");
  return avg;
}

async function fetchAvgCloseFromYahoo(symbol: string, tradingDays: number) {
  const days = Math.max(1, Math.floor(tradingDays));
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) throw new Error("INVALID_SYMBOL");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?range=2mo&interval=1d&includePrePost=false&events=div%7Csplits`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const closesRaw = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const closes = closesRaw.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
  if (closes.length < days) throw new Error("NOT_ENOUGH_DATA");
  const recent = closes.slice(-days);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  const avg = sum / days;
  if (!Number.isFinite(avg) || avg <= 0) throw new Error("INVALID_PRICE");
  return avg;
}

async function fetchAvgCloseFromTencent(symbol: string, tradingDays: number) {
  const days = Math.max(1, Math.floor(tradingDays));
  const tencentSymbol = toTencentSymbol(symbol);
  if (!tencentSymbol) throw new Error("INVALID_SYMBOL");
  const market = tencentSymbol.slice(0, 2).toLowerCase();
  const endpoint =
    market === "us"
      ? "https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get"
      : market === "hk"
        ? "https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get"
        : "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
  const url = `${endpoint}?param=${encodeURIComponent(`${tencentSymbol},day,,,${days},qfq`)}&r=${Date.now()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "esop/1.0",
      referer: "https://gu.qq.com/",
    },
  });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const data = (await res.json()) as {
    data?: Record<string, { day?: Array<Array<string | number | null>> }>;
  };
  const series = data.data?.[tencentSymbol]?.day ?? [];
  const closes: number[] = [];
  for (const row of series) {
    const closeRaw = row?.[2];
    const close = typeof closeRaw === "number" ? closeRaw : Number(String(closeRaw ?? "").trim());
    if (Number.isFinite(close) && close > 0) closes.push(close);
  }
  if (closes.length < 1) throw new Error("NOT_ENOUGH_DATA");
  const recent = closes.slice(-Math.min(days, closes.length));
  const sum = recent.reduce((acc, v) => acc + v, 0);
  const avg = sum / recent.length;
  if (!Number.isFinite(avg) || avg <= 0) throw new Error("INVALID_PRICE");
  return avg;
}

async function fetchCloseSeriesFromYahoo(symbol: string, tradingDays: number) {
  const days = Math.max(1, Math.floor(tradingDays));
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) throw new Error("INVALID_SYMBOL");
  const range =
    days <= 90
      ? "3mo"
      : days <= 260
        ? "1y"
        : days <= 1300
          ? "5y"
          : "10y";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false&events=div%7Csplits`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: Array<number | null>;
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const ts = data.chart?.result?.[0]?.timestamp ?? [];
  const closesRaw = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const out: Array<{ date: string; close: number }> = [];
  const n = Math.min(ts.length, closesRaw.length);
  const start = Math.max(0, n - Math.min(days, n));
  for (let i = start; i < n; i += 1) {
    const t = ts[i];
    const c = closesRaw[i];
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
    const date = new Date(t * 1000).toISOString().slice(0, 10);
    out.push({ date, close: c });
  }
  if (out.length < 1) throw new Error("NOT_ENOUGH_DATA");
  return out;
}

async function fetchCloseSeriesFromTencent(symbol: string, tradingDays: number) {
  const days = Math.max(1, Math.floor(tradingDays));
  const tencentSymbol = toTencentSymbol(symbol);
  if (!tencentSymbol) throw new Error("INVALID_SYMBOL");
  const market = tencentSymbol.slice(0, 2).toLowerCase();
  const endpoint =
    market === "us"
      ? "https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get"
      : market === "hk"
        ? "https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get"
        : "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
  const url = `${endpoint}?param=${encodeURIComponent(`${tencentSymbol},day,,,${days},qfq`)}&r=${Date.now()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "esop/1.0",
      referer: "https://gu.qq.com/",
    },
  });
  if (!res.ok) throw new Error("FETCH_FAILED");
  const data = (await res.json()) as {
    data?: Record<string, { day?: Array<Array<string | number | null>> }>;
  };
  const series = data.data?.[tencentSymbol]?.day ?? [];
  const out: Array<{ date: string; close: number }> = [];
  for (const row of series) {
    const dateRaw = row?.[0];
    const date = typeof dateRaw === "string" ? dateRaw.trim() : String(dateRaw ?? "").trim();
    const closeRaw = row?.[2];
    const close = typeof closeRaw === "number" ? closeRaw : Number(String(closeRaw ?? "").trim());
    if (!date) continue;
    if (!Number.isFinite(close) || close <= 0) continue;
    out.push({ date, close });
  }
  if (out.length < 1) throw new Error("NOT_ENOUGH_DATA");
  return out.slice(-Math.min(days, out.length));
}

export async function computeLatestSharePrice(input: { sharePriceTicker: string }) {
  const tickerRaw = input.sharePriceTicker.trim();
  const symbol = normalizeTickerInput(tickerRaw);
  if (!symbol) throw new Error("INVALID_TICKER");

  const detectedCurrency = inferCurrencyFromSymbol(symbol);

  let price: number;
  try {
    price = await fetchPriceFromYahooQuote(symbol);
  } catch {
    try {
      price = await fetchPriceFromTencent(symbol);
    } catch {
      try {
        price = await fetchPriceFromStooq(symbol);
      } catch {
        throw new Error("FETCH_PRICE_FAILED");
      }
    }
  }

  let avg30Usd: number | null = null;
  let avg30Error: string | null = null;
  try {
    const avg30 = await fetchAvgCloseFromYahoo(symbol, 30);
    avg30Usd = detectedCurrency === "USD" ? avg30 : avg30 / currencyToUsdRate(detectedCurrency);
  } catch {
    try {
      const avg30 = await fetchAvgCloseFromTencent(symbol, 30);
      avg30Usd = detectedCurrency === "USD" ? avg30 : avg30 / currencyToUsdRate(detectedCurrency);
    } catch {
      try {
        const avg30 = await fetchAvgCloseFromStooqDaily(symbol, 30);
        avg30Usd = detectedCurrency === "USD" ? avg30 : avg30 / currencyToUsdRate(detectedCurrency);
      } catch {
        avg30Error = "FETCH_AVG30_FAILED";
      }
    }
  }

  return {
    price: new Prisma.Decimal(price),
    sharePriceTicker: tickerRaw,
    sharePriceCurrency: detectedCurrency,
    sharePriceAvg30Usd: avg30Usd == null ? null : new Prisma.Decimal(avg30Usd),
    avg30Error,
  };
}

export async function computeSharePriceSeries(input: {
  sharePriceTicker: string;
  tradingDays?: number;
}) {
  const tickerRaw = input.sharePriceTicker.trim();
  const symbol = normalizeTickerInput(tickerRaw);
  if (!symbol) throw new Error("INVALID_TICKER");
  const detectedCurrency = inferCurrencyFromSymbol(symbol);
  const days = Math.max(1, Math.floor(Number(input.tradingDays ?? 30)));

  let series: Array<{ date: string; close: number }> = [];
  try {
    series = await fetchCloseSeriesFromYahoo(symbol, days);
  } catch {
    try {
      series = await fetchCloseSeriesFromTencent(symbol, days);
    } catch {
      throw new Error("FETCH_SERIES_FAILED");
    }
  }

  return {
    sharePriceTicker: tickerRaw,
    sharePriceCurrency: detectedCurrency,
    series: series.map((p) => ({ date: p.date, close: new Prisma.Decimal(p.close) })),
  };
}
