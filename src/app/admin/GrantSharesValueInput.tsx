"use client";

import { useMemo, useState } from "react";

type Currency = "USD" | "HKD" | "CNY";

function currencyToUsdRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

function formatMoney(amountUsd: number, currency: Currency) {
  const rate = currencyToUsdRate(currency);
  const v = currency === "USD" ? amountUsd : amountUsd * rate;
  const safe = Number.isFinite(v) ? v : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function GrantSharesValueInput({
  name,
  min,
  placeholder,
  className,
  currency,
  companySharePriceUsd,
}: {
  name: string;
  min?: number;
  placeholder?: string;
  className?: string;
  currency: Currency;
  companySharePriceUsd: number;
}) {
  const [raw, setRaw] = useState("");
  const shares = useMemo(() => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  }, [raw]);

  const valueLabel = useMemo(() => {
    if (!shares) return "—";
    const valueUsd = shares * companySharePriceUsd;
    if (!Number.isFinite(valueUsd) || valueUsd <= 0) return "—";
    return formatMoney(valueUsd, currency);
  }, [shares, companySharePriceUsd, currency]);

  return (
    <div className="flex flex-col gap-1">
      <input
        name={name}
        type="number"
        min={min}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        className={className}
        placeholder={placeholder}
        required
      />
      <div className="text-xs text-zinc-500">
        估算价值 {valueLabel}
      </div>
    </div>
  );
}
