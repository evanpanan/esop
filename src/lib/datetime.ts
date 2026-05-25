export const BUSINESS_TIMEZONE = "Asia/Shanghai";

export function ymdInTimeZone(d: Date, timeZone: string = BUSINESS_TIMEZONE) {
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

