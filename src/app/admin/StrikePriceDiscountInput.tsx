"use client";

import { useMemo, useState } from "react";

function formatZhe(discountZhe: number | null) {
  if (!discountZhe || !Number.isFinite(discountZhe) || discountZhe <= 0) return "—";
  const rounded = Math.round(discountZhe * 10) / 10;
  const s = rounded.toFixed(1).replace(/\.0$/, "");
  return `${s}折`;
}

export function StrikePriceDiscountInput({
  name,
  min,
  step,
  placeholder,
  className,
  companySharePriceBase,
}: {
  name: string;
  min?: number;
  step?: number | string;
  placeholder?: string;
  className?: string;
  companySharePriceBase: number;
}) {
  const [raw, setRaw] = useState("");

  const discount = useMemo(() => {
    const strike = Number(raw);
    if (!Number.isFinite(strike) || strike <= 0) return null;
    const base = Number(companySharePriceBase);
    if (!Number.isFinite(base) || base <= 0) return null;
    return (strike / base) * 10;
  }, [raw, companySharePriceBase]);

  const discountLabel = useMemo(() => formatZhe(discount), [discount]);

  return (
    <div className="flex flex-col gap-1">
      <input
        name={name}
        type="number"
        min={min}
        step={step}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        className={className}
        placeholder={placeholder}
        required
      />
      <div className="text-xs text-zinc-500">折扣 {discountLabel}</div>
    </div>
  );
}

