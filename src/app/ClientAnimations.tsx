"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BUSINESS_TIMEZONE, ymdInTimeZone } from "@/lib/datetime";

export function BackButton({
  fallbackHref,
  ariaLabel = "返回",
  className = "btn-press inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 active:bg-slate-200",
}: {
  fallbackHref: string;
  ariaLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const lastAtRef = useRef(0);
  const go = useCallback(() => {
    const now = Date.now();
    if (now - lastAtRef.current < 350) return;
    lastAtRef.current = now;
    const href = fallbackHref;
    try {
      if (typeof window !== "undefined") {
        try {
          const beforeUrl = new URL(window.location.href);
          const targetUrl = new URL(href, beforeUrl);
          const samePath = beforeUrl.pathname === targetUrl.pathname;
          const hasQ = beforeUrl.searchParams.has("q");
          const targetHasQ = targetUrl.searchParams.has("q");
          if (samePath && hasQ && !targetHasQ) {
            router.push(href);
            return;
          }
        } catch {}
        const before = window.location.href;
        if (window.history.length > 1) {
          router.back();
          window.setTimeout(() => {
            try {
              if (typeof window === "undefined") return;
              if (window.location.href === before) {
                router.push(href);
              }
            } catch {
              router.push(href);
            }
          }, 420);
          return;
        }
      }
    } catch {}
    router.push(href);
  }, [fallbackHref, router]);
  return (
    <Link
      href={fallbackHref}
      className={className}
      onClick={(e) => {
        try {
          e.preventDefault();
        } catch {}
        go();
      }}
      aria-label={ariaLabel}
      scroll={false}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function fireHaptic(ms: number) {
  const canVibrate =
    typeof navigator !== "undefined" &&
    typeof (navigator as unknown as { vibrate?: (p: number | number[]) => boolean }).vibrate === "function";
  if (canVibrate) {
    try {
      (navigator as unknown as { vibrate: (p: number | number[]) => boolean }).vibrate(ms);
      return true;
    } catch {}
  }
  try {
    const w = window as unknown as {
      webkit?: { messageHandlers?: Record<string, { postMessage?: (msg: unknown) => void }> };
    };
    const mh = w.webkit?.messageHandlers ?? null;
    if (!mh) return false;
    const names = ["haptic", "haptics", "taptic", "impact", "Haptic", "NativeHaptic", "nativeHaptic", "bridge", "nativeBridge", "esopHaptic"];
    for (const name of names) {
      const handler = mh[name];
      const post = handler?.postMessage;
      if (typeof post !== "function") continue;
      try {
        post({ type: "selection", ms });
        return true;
      } catch {}
      try {
        post("selection");
        return true;
      } catch {}
      try {
        post({ type: "impact", style: ms >= 16 ? "medium" : "light", ms });
        return true;
      } catch {}
      try {
        post(ms >= 16 ? "medium" : "light");
        return true;
      } catch {}
    }
  } catch {}
  return false;
}

export function SuccessToast({
  toastId,
  title,
  lines = [],
  durationMs = 4000,
  clearKeys = [],
  actions = [],
  closeLabel = "关闭",
}: {
  toastId: string;
  title: string;
  lines?: string[];
  durationMs?: number;
  clearKeys?: string[];
  actions?: Array<{ label: string; href: string }>;
  closeLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const hasOpenedRef = useRef(false);
  const effectiveDurationMs = durationMs > 0 ? Math.max(3000, durationMs) : 0;

  useEffect(() => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => setOpen(true), 0);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    if (effectiveDurationMs > 0) {
      closeTimerRef.current = window.setTimeout(() => setOpen(false), effectiveDurationMs);
    }
    return () => {
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, [toastId, effectiveDurationMs]);

  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      return;
    }
    if (!hasOpenedRef.current) return;
    const p = new URLSearchParams(searchParams.toString());
    for (const k of clearKeys) p.delete(k);
    const qs = p.toString();
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 220);
  }, [open, clearKeys, pathname, router, searchParams]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 sm:inset-auto sm:bottom-auto sm:right-6 sm:top-6 sm:justify-end">
      <div
        className={`pointer-events-auto w-full max-w-sm rounded-2xl border border-emerald-200 bg-white shadow-xl transition-all duration-200 ${
          open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900">{title}</div>
            {lines.length > 0 ? (
              <div className="mt-1 space-y-0.5 text-xs leading-5 text-zinc-600">
                {lines.map((t, idx) => (
                  <div key={`${idx}-${t}`} className="truncate">
                    {t}
                  </div>
                ))}
              </div>
            ) : null}
            {actions.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {actions.map((a) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    scroll={false}
                    className="inline-flex h-8 items-center justify-center rounded-xl bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorToast({
  toastId,
  title,
  lines = [],
  durationMs = 5000,
  clearKeys = [],
  actions = [],
  closeLabel = "关闭",
}: {
  toastId: string;
  title: string;
  lines?: string[];
  durationMs?: number;
  clearKeys?: string[];
  actions?: Array<{ label: string; href: string }>;
  closeLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => setOpen(true), 0);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    if (durationMs > 0) {
      closeTimerRef.current = window.setTimeout(() => setOpen(false), durationMs);
    }
    return () => {
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, [toastId, durationMs]);

  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      return;
    }
    if (!hasOpenedRef.current) return;
    const p = new URLSearchParams(searchParams.toString());
    for (const k of clearKeys) p.delete(k);
    const qs = p.toString();
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 220);
  }, [open, clearKeys, pathname, router, searchParams]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 sm:inset-auto sm:bottom-auto sm:right-6 sm:top-6 sm:justify-end">
      <div
        className={`pointer-events-auto w-full max-w-sm rounded-2xl border border-rose-200 bg-white shadow-xl transition-all duration-200 ${
          open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900">{title}</div>
            {lines.length > 0 ? (
              <div className="mt-1 space-y-0.5 text-xs leading-5 text-zinc-600">
                {lines.map((t, idx) => (
                  <div key={`${idx}-${t}`} className="truncate">
                    {t}
                  </div>
                ))}
              </div>
            ) : null}
            {actions.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {actions.map((a) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    scroll={false}
                    className="inline-flex h-8 items-center justify-center rounded-xl bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-700"
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyToggleButton({
  className = "btn-press btn-ripple inline-flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white/80 text-zinc-700 hover:bg-white",
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      data-privacy-toggle
      className={className}
      aria-pressed="false"
      aria-label="隐私显示切换"
      title="隐私显示切换"
    >
      <span className="ui-eye-open">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="ui-eye-closed">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 3l18 18"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </button>
  );
}

export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [toastId, setToastId] = useState(0);

  const onCopy = useCallback(async () => {
    const v = String(value ?? "");
    if (!v) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(v);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = v;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    setToastId((x) => x + 1);
    window.setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        className={`btn-press inline-flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl border ${
          copied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
        }`}
        aria-label={label ?? "复制"}
        title={label ?? "复制"}
      >
        {copied ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 6L9 17l-5-5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 9h10v10H9V9Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path
              d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {toastId > 0 && copied ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-emerald-200 bg-white shadow-xl">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M20 6L9 17l-5-5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-900">已成功复制到剪贴板</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function CountUpCurrency({
  value,
  currency,
  maximumFractionDigits = 2,
  className,
}: {
  value: number;
  currency: string;
  maximumFractionDigits?: number;
  className?: string;
}) {
  const target = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const formatter = useMemo(() => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    });
  }, [currency, maximumFractionDigits]);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const start = performance.now();
    const duration = 760;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startValue = displayRef.current;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startValue + (target - startValue) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return <span className={className}>{formatter.format(display)}</span>;
}

export function SkeletonBlock({
  className,
}: {
  className?: string;
}) {
  return <span className={`ui-skeleton inline-block ${className ?? ""}`} />;
}

export function PriceFlash({
  value,
  children,
  className,
}: {
  value: number;
  children: React.ReactNode;
  className?: string;
}) {
  const v = Number.isFinite(value) ? value : 0;
  const prevRef = useRef<number | null>(null);
  const [tone, setTone] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (prevRef.current == null) {
      prevRef.current = v;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = v;
    if (v === prev) return;
    setTone(v > prev ? "up" : "down");
    const id = window.setTimeout(() => setTone(null), 520);
    return () => window.clearTimeout(id);
  }, [v]);

  return (
    <span
      className={`${tone === "up" ? "ui-price-flash-up" : tone === "down" ? "ui-price-flash-down" : ""} rounded-md ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

export function InlineTip({ text }: { text: string }) {
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

function parseCurrency(v: unknown): Currency | null {
  const s = String(v ?? "");
  if (s === "USD" || s === "HKD" || s === "CNY") return s;
  return null;
}

export function LiveCompanySharePrice({
  initialPriceBase,
  initialBaseCurrency,
  displayCurrency,
  sharePriceTicker,
  className,
}: {
  initialPriceBase: number;
  initialBaseCurrency: Currency;
  displayCurrency: Currency;
  sharePriceTicker: string;
  className?: string;
}) {
  const [priceBase, setPriceBase] = useState<number>(Number.isFinite(initialPriceBase) ? initialPriceBase : 0);
  const [baseCurrency, setBaseCurrency] = useState<Currency>(initialBaseCurrency);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    if (!sharePriceTicker) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/share-price/latest", { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          price?: number;
          currency?: string;
          pollMs?: number;
        };

        const pollMs =
          typeof json.pollMs === "number" && Number.isFinite(json.pollMs) ? Math.max(1000, json.pollMs) : 60 * 60 * 1000;

        if (!cancelled) {
          setReady(true);
          if (json.ok && typeof json.price === "number" && Number.isFinite(json.price)) {
            setPriceBase(json.price);
          }
          const parsed = parseCurrency(json.currency);
          if (parsed) setBaseCurrency(parsed);
          timer = window.setTimeout(tick, pollMs);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 60 * 60 * 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sharePriceTicker]);

  if (!ready && sharePriceTicker) {
    return <SkeletonBlock className={`h-6 w-28 align-middle ${className ?? ""}`} />;
  }

  const display = convertMoney(Number.isFinite(priceBase) ? priceBase : 0, baseCurrency, displayCurrency);
  return (
    <PriceFlash value={display} className={`font-mono tabular-nums ${className ?? ""}`}>
      <CountUpCurrency value={display} currency={displayCurrency} maximumFractionDigits={6} />
    </PriceFlash>
  );
}

export function LiveSharePriceAvg30({
  initialAvg30Usd,
  displayCurrency,
  sharePriceTicker,
  className,
}: {
  initialAvg30Usd: number | null;
  displayCurrency: Currency;
  sharePriceTicker: string;
  className?: string;
}) {
  const [avg30Usd, setAvg30Usd] = useState<number | null>(typeof initialAvg30Usd === "number" && Number.isFinite(initialAvg30Usd) ? initialAvg30Usd : null);
  const [ready, setReady] = useState(initialAvg30Usd !== null || !sharePriceTicker);

  useEffect(() => {
    if (!sharePriceTicker) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/share-price/latest", { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          avg30Usd?: number | null;
          pollMs?: number;
        };

        const pollMs =
          typeof json.pollMs === "number" && Number.isFinite(json.pollMs) ? Math.max(1000, json.pollMs) : 60 * 60 * 1000;

        if (!cancelled) {
          setReady(true);
          if (typeof json.avg30Usd === "number" && Number.isFinite(json.avg30Usd)) setAvg30Usd(json.avg30Usd);
          if (json.avg30Usd === null) setAvg30Usd(null);
          timer = window.setTimeout(tick, pollMs);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 60 * 60 * 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sharePriceTicker]);

  if (!ready && sharePriceTicker) {
    return <SkeletonBlock className={`h-4 w-24 align-middle ${className ?? ""}`} />;
  }

  if (avg30Usd == null) return <span className={className}>—</span>;
  const display = convertMoney(avg30Usd, "USD", displayCurrency);
  return (
    <PriceFlash value={display} className={`font-mono tabular-nums ${className ?? ""}`}>
      <CountUpCurrency value={display} currency={displayCurrency} maximumFractionDigits={6} />
    </PriceFlash>
  );
}

export function LiveTotalOptionValue({
  initialValueDisplay,
  totalShares,
  baseCurrency,
  displayCurrency,
  sharePriceTicker,
  useManualCompanySharePrice,
  className,
}: {
  initialValueDisplay: number;
  totalShares: number;
  baseCurrency: Currency;
  displayCurrency: Currency;
  sharePriceTicker: string;
  useManualCompanySharePrice: boolean;
  className?: string;
}) {
  const [value, setValue] = useState<number>(Number.isFinite(initialValueDisplay) ? initialValueDisplay : 0);

  useEffect(() => {
    if (!sharePriceTicker || useManualCompanySharePrice) return;

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/share-price/latest", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; price?: number; pollMs?: number };

        const pollMs = typeof json.pollMs === "number" && Number.isFinite(json.pollMs) ? Math.max(1000, json.pollMs) : 60 * 60 * 1000;
        if (!cancelled) {
          if (json.ok && typeof json.price === "number" && Number.isFinite(json.price)) {
            const nextValueBase = json.price * totalShares;
            const nextValueDisplay = convertMoney(nextValueBase, baseCurrency, displayCurrency);
            setValue(nextValueDisplay);
          }
          timer = window.setTimeout(tick, pollMs);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 60 * 60 * 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [baseCurrency, displayCurrency, sharePriceTicker, totalShares, useManualCompanySharePrice]);

  return <CountUpCurrency value={value} currency={displayCurrency} className={className} />;
}

export function AnimatedProgressBar({
  percent,
  barClassName,
  heightClassName = "h-2",
  markers = [],
  markerActiveClassName = "bg-zinc-900",
  markerInactiveClassName = "bg-zinc-300",
}: {
  percent: number;
  barClassName: string;
  heightClassName?: string;
  markers?: number[];
  markerActiveClassName?: string;
  markerInactiveClassName?: string;
}) {
  const p = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 1)) : 0;
  const safeMarkers = (markers ?? [])
    .map((x) => (Number.isFinite(x) ? Math.max(0, Math.min(Number(x), 1)) : 0))
    .filter((x) => x > 0 && x < 1)
    .slice(0, 12);

  return (
    <div className={`relative mt-2 w-full overflow-hidden rounded-full bg-zinc-200 ${heightClassName}`}>
      {safeMarkers.length ? (
        <div className="pointer-events-none absolute inset-0 z-10">
          {safeMarkers.map((m, idx) => (
            <div
              key={`${idx}-${m}`}
              className={`absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full ${
                m <= p ? markerActiveClassName : markerInactiveClassName
              }`}
              style={{ left: `${m * 100}%`, transform: "translate(-50%, -50%)" }}
            />
          ))}
        </div>
      ) : null}
      <div
        className={`ui-progress-bar w-full origin-left rounded-full ${heightClassName} ${barClassName}`}
        style={{ ["--ui-pct" as never]: String(p) } as never}
      />
    </div>
  );
}

export function SparklineTooltip({
  points,
  currency,
  label,
}: {
  points: Array<{ date: string; value: number }>;
  currency: string;
  label: string;
}) {
  const safePoints = points.length >= 2 ? points : [...points, ...points].slice(0, 2);
  const values = safePoints.map((p) => (Number.isFinite(p.value) ? p.value : 0));
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const formatter = useMemo(() => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  }, [currency]);

  const min = useMemo(() => Math.min(...values), [values]);
  const max = useMemo(() => Math.max(...values), [values]);
  const range = max - min;
  const toY = (v: number) => {
    if (!Number.isFinite(v)) return 20;
    if (range <= 0) return 20;
    const t = (v - min) / range;
    return 40 - t * 40;
  };
  const toX = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * 100);

  const pathD = useMemo(() => {
    let d = "";
    for (let i = 0; i < values.length; i += 1) {
      const x = toX(i);
      const y = toY(values[i]);
      d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return d;
  }, [values, range, min]);

  const areaD = useMemo(() => {
    return `${pathD} L 100 40 L 0 40 Z`;
  }, [pathD]);

  const activePoint = activeIdx == null ? null : safePoints[Math.max(0, Math.min(activeIdx, safePoints.length - 1))] ?? null;
  const activeX = activeIdx == null ? 0 : toX(activeIdx);
  const activeY = activeIdx == null ? 20 : toY(values[activeIdx] ?? 0);
  const displayPoint = activePoint ?? safePoints[safePoints.length - 1] ?? { date: "", value: 0 };

  const setFromEvent = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = rect.width > 0 ? Math.max(0, Math.min(1, x / rect.width)) : 0;
    const idx = Math.round(t * (values.length - 1));
    setActiveIdx(idx);
  };

  return (
    <div className="relative">
      <div className="mb-2 block rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-700 sm:hidden">
        <div className="text-zinc-500">
          {label}
          {displayPoint.date ? ` · ${displayPoint.date}` : ""}
        </div>
        <div className="font-mono text-zinc-900">{formatter.format(displayPoint.value)}</div>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-20 w-full touch-none sm:h-16"
        onPointerEnter={(e) => setFromEvent(e)}
        onPointerMove={(e) => setFromEvent(e)}
        onPointerLeave={() => setActiveIdx(null)}
      >
        <path d={areaD} fill="rgba(16,185,129,0.12)" />
        <path d={pathD} fill="none" stroke="rgb(16,185,129)" strokeWidth="1.6" />
        {activeIdx != null ? (
          <>
            <line x1={activeX} x2={activeX} y1="0" y2="40" stroke="rgba(24,24,27,0.15)" strokeWidth="0.6" />
            <circle cx={activeX} cy={activeY} r="1.6" fill="rgb(16,185,129)" />
          </>
        ) : null}
      </svg>
      {activePoint ? (
        <div
          className="pointer-events-none absolute top-0 hidden rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow sm:block"
          style={{
            left: `${Math.max(8, Math.min(92, activeX))}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-zinc-500">{label}{activePoint.date ? ` · ${activePoint.date}` : ""}</div>
          <div className="font-mono text-zinc-900">{formatter.format(activePoint.value)}</div>
        </div>
      ) : null}
    </div>
  );
}

type Currency = "USD" | "HKD" | "CNY";
type UsdtChain = "BNB" | "TRX";

type Lang = "zh-CN" | "zh-TW" | "en";

export function EquityAreaChart({
  points,
  lang,
  baseCurrency,
  displayCurrency,
  sharePriceTicker,
  useManualCompanySharePrice,
  initialCompanySharePriceBase,
}: {
  points: Array<{ date: string; vestedShares: number; sharePriceBase: number; value: number }>;
  lang: Lang;
  baseCurrency: Currency;
  displayCurrency: Currency;
  sharePriceTicker?: string;
  useManualCompanySharePrice?: boolean;
  initialCompanySharePriceBase?: number;
}) {
  const chartId = useId().replace(/:/g, "").toLowerCase();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const pressActiveRef = useRef(false);
  const activeRef = useRef<{
    x: number;
    i0: number;
    i1: number;
    a: number;
  } | null>(null);
  const [liveCompanySharePriceBase, setLiveCompanySharePriceBase] = useState<number | null>(null);

  const [range, setRange] = useState<"7D" | "30D" | "ALL">("30D");
  const [activeState, setActiveState] = useState<{
    x: number;
    i0: number;
    i1: number;
    a: number;
  } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 360, h: 250 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.setAttribute("data-eq-hydrated", "1");
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    let timer: number | null = null;
    let ro: ResizeObserver | null = null;
    const start = Date.now();
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(0, Math.floor(rect.width));
      const h = Math.max(0, Math.floor(rect.height));
      if (!(w > 0 && h > 0)) return false;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      return w > 0 && h > 0;
    };
    const tick = () => {
      const ok = measure();
      if (ok) return;
      if (Date.now() - start > 1500) return;
      raf = window.requestAnimationFrame(tick);
    };

    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    } else {
      const onResize = () => measure();
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      timer = window.setInterval(measure, 250);
      return () => {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
        if (timer) window.clearInterval(timer);
      };
    }

    void measure();
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
      if (ro) ro.disconnect();
    };
  }, []);

  const safeAll = useMemo(() => {
    const cleaned = points
      .map((p) => ({
        date: String(p.date ?? ""),
        vestedShares: Number.isFinite(p.vestedShares) ? Math.max(0, Math.floor(p.vestedShares)) : 0,
        sharePriceBase: Number.isFinite(p.sharePriceBase) ? Math.max(0, p.sharePriceBase) : 0,
        value: Number.isFinite(p.value) ? Math.max(0, p.value) : 0,
      }))
      .filter((p) => p.date);
    if (cleaned.length >= 2) return cleaned;
    if (cleaned.length === 1) return [cleaned[0], cleaned[0]];
    return [
      { date: "", vestedShares: 0, sharePriceBase: 0, value: 0 },
      { date: "", vestedShares: 0, sharePriceBase: 0, value: 0 },
    ];
  }, [points]);

  const shownRaw = useMemo(() => {
    if (range === "7D") return safeAll.slice(-7);
    if (range === "30D") return safeAll.slice(-30);
    return safeAll;
  }, [range, safeAll]);

  const shown = useMemo(() => {
    const maxPoints = 600;
    const n = shownRaw.length;
    if (n <= maxPoints) return shownRaw;
    const stride = Math.ceil(n / maxPoints);
    const out: typeof shownRaw = [];
    for (let i = 0; i < n; i += stride) out.push(shownRaw[i]);
    if (out[out.length - 1]?.date !== shownRaw[n - 1]?.date) out.push(shownRaw[n - 1]);
    return out;
  }, [shownRaw]);

  useEffect(() => {
    if (!sharePriceTicker || useManualCompanySharePrice) return;

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/share-price/latest", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; price?: number; pollMs?: number };

        const pollMs = typeof json.pollMs === "number" && Number.isFinite(json.pollMs) ? Math.max(1000, json.pollMs) : 60 * 60 * 1000;
        if (!cancelled) {
          if (json.ok && typeof json.price === "number" && Number.isFinite(json.price)) {
            setLiveCompanySharePriceBase(json.price);
          }
          timer = window.setTimeout(tick, pollMs);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 60 * 60 * 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sharePriceTicker, useManualCompanySharePrice]);

  const locale = useMemo(() => {
    if (lang === "en") return "en-GB";
    if (lang === "zh-TW") return "zh-TW";
    return "zh-CN";
  }, [lang]);

  const moneyFormatter = useMemo(() => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: 2,
    });
  }, [displayCurrency]);

  const sharePriceFormatter = useMemo(() => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: baseCurrency,
      maximumFractionDigits: 6,
    });
  }, [baseCurrency]);

  const shareFormatter = useMemo(() => {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  }, []);

  const padding = { left: 14, right: 14, top: 10, bottom: 18 };
  const plotW = Math.max(1, size.w - padding.left - padding.right);
  const plotH = Math.max(1, size.h - padding.top - padding.bottom);

  const shownForRender = useMemo(() => {
    const last = shown[shown.length - 1] ?? null;
    if (!last) return shown;
    const effectiveBase =
      liveCompanySharePriceBase ??
      (typeof initialCompanySharePriceBase === "number" && Number.isFinite(initialCompanySharePriceBase)
        ? initialCompanySharePriceBase
        : null) ??
      (Number.isFinite(last.sharePriceBase) ? last.sharePriceBase : 0);
    if (!(effectiveBase > 0)) return shown;

    const reduced = shown.reduce<{
      out: typeof shown;
      lastPrice: number;
    }>(
      (acc, p) => {
        const minReasonable = effectiveBase / 1000;
        const price =
          Number.isFinite(p.sharePriceBase) && p.sharePriceBase > 0 && p.sharePriceBase >= minReasonable
            ? p.sharePriceBase
            : acc.lastPrice;
        acc.lastPrice = price;
        acc.out.push({
          ...p,
          sharePriceBase: price,
          value: convertMoney(price * (Number.isFinite(p.vestedShares) ? p.vestedShares : 0), baseCurrency, displayCurrency),
        });
        return acc;
      },
      { out: [], lastPrice: effectiveBase },
    );

    if (reduced.out.length > 0) {
      const lastIdx = reduced.out.length - 1;
      reduced.out[lastIdx] = {
        ...reduced.out[lastIdx],
        sharePriceBase: effectiveBase,
        value: convertMoney(
          effectiveBase *
            (Number.isFinite(reduced.out[lastIdx]?.vestedShares) ? (reduced.out[lastIdx] as { vestedShares: number }).vestedShares : 0),
          baseCurrency,
          displayCurrency,
        ),
      };
    }

    return reduced.out;
  }, [baseCurrency, displayCurrency, initialCompanySharePriceBase, liveCompanySharePriceBase, shown]);

  const withGrantPrefill = useMemo(() => {
    const first = shownForRender[0] ?? null;
    const last = shownForRender[shownForRender.length - 1] ?? null;
    if (!first || !last) return { all: shownForRender, prefillCount: 0 };
    const t0 = new Date(`${first.date}T00:00:00.000Z`).getTime();
    const t1 = new Date(`${last.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return { all: shownForRender, prefillCount: 0 };

    const spanDays = Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
    const wantDays = range === "7D" ? 7 : range === "30D" ? 30 : 60;
    const shouldPrefill = range !== "7D" && spanDays < Math.min(22, wantDays - 2) && shownForRender.length < wantDays;
    if (!shouldPrefill) return { all: shownForRender, prefillCount: 0 };

    const need = Math.max(0, Math.min(wantDays - shownForRender.length, wantDays - Math.max(2, spanDays + 1)));
    if (need <= 0) return { all: shownForRender, prefillCount: 0 };

    const basePrice = first.sharePriceBase;
    const prefill: typeof shownForRender = [];
    for (let i = need; i >= 1; i -= 1) {
      const d = new Date(t0 - i * 24 * 60 * 60 * 1000);
      const iso = ymdInTimeZone(d, BUSINESS_TIMEZONE);
      prefill.push({
        date: iso,
        vestedShares: 0,
        sharePriceBase: basePrice,
        value: 0,
      });
    }
    return { all: [...prefill, ...shownForRender], prefillCount: prefill.length };
  }, [range, shownForRender]);

  const renderPoints = withGrantPrefill.all;
  const prefillCount = withGrantPrefill.prefillCount;

  const values = useMemo(() => renderPoints.map((p) => p.value), [renderPoints]);
  const vMinRaw = useMemo(() => Math.min(...values.map((v) => (Number.isFinite(v) ? v : 0))), [values]);
  const vMaxRaw = useMemo(() => Math.max(...values.map((v) => (Number.isFinite(v) ? v : 0))), [values]);
  const vRange = vMaxRaw - vMinRaw;
  const vMin = vRange > 0 ? Math.max(0, vMinRaw - vRange * 0.06) : 0;
  const vMax = vRange > 0 ? vMaxRaw + vRange * 0.06 : vMaxRaw > 0 ? vMaxRaw * 1.06 : 1;
  const vDenom = Math.max(1e-9, vMax - vMin);

  const toX = (i: number) =>
    padding.left + (renderPoints.length <= 1 ? 0 : (i / (renderPoints.length - 1)) * plotW);
  const toY = (v: number) => {
    const vv = Number.isFinite(v) ? v : 0;
    const t = Math.max(0, Math.min(1, (vv - vMin) / vDenom));
    return padding.top + plotH - t * plotH;
  };

  const monotone = (pts: Array<{ x: number; y: number }>) => {
    const n = pts.length;
    if (n < 2) return "";
    const m: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      m.push(dx === 0 ? 0 : dy / dx);
    }
    const t: number[] = new Array(n).fill(0);
    t[0] = m[0] ?? 0;
    t[n - 1] = m[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i += 1) {
      const a = m[i - 1] ?? 0;
      const b = m[i] ?? 0;
      t[i] = a * b <= 0 ? 0 : (a + b) / 2;
    }
    for (let i = 0; i < n - 1; i += 1) {
      const s = m[i] ?? 0;
      if (s === 0) {
        t[i] = 0;
        t[i + 1] = 0;
        continue;
      }
      const a = t[i] / s;
      const b = t[i + 1] / s;
      const r = a * a + b * b;
      if (r > 9) {
        const k = 3 / Math.sqrt(r);
        t[i] = k * a * s;
        t[i + 1] = k * b * s;
      }
    }

    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < n - 1; i += 1) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const dx = p1.x - p0.x;
      const c1x = p0.x + dx / 3;
      const c1y = p0.y + (t[i] ?? 0) * (dx / 3);
      const c2x = p1.x - dx / 3;
      const c2y = p1.y - (t[i + 1] ?? 0) * (dx / 3);
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
    }
    return d;
  };

  const allXY = useMemo(() => {
    return renderPoints.map((p, i) => ({ x: toX(i), y: toY(p.value) }));
  }, [renderPoints, toX, toY]);

  const grantLinePath = useMemo(() => {
    if (prefillCount <= 0) return "";
    const end = Math.max(1, Math.min(prefillCount, allXY.length - 1));
    let d = `M ${allXY[0]!.x.toFixed(2)} ${allXY[0]!.y.toFixed(2)}`;
    for (let i = 1; i <= end; i += 1) {
      d += ` L ${allXY[i]!.x.toFixed(2)} ${allXY[i]!.y.toFixed(2)}`;
    }
    return d;
  }, [allXY, prefillCount]);

  const mainStart = prefillCount > 0 ? Math.max(0, prefillCount - 1) : 0;
  const mainXY = useMemo(() => allXY.slice(mainStart), [allXY, mainStart]);
  const mainLinePath = useMemo(() => monotone(mainXY), [mainXY]);

  const areaPath = useMemo(() => {
    if (!mainLinePath) return "";
    const lastX = toX(renderPoints.length - 1);
    const baseY = padding.top + plotH;
    const firstX = toX(mainStart);
    return `${mainLinePath} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} Z`;
  }, [mainLinePath, mainStart, plotH, renderPoints.length, toX]);

  const active = useMemo(() => {
    if (!activeState) return null;
    const n = renderPoints.length;
    const i0 = Math.max(0, Math.min(activeState.i0, n - 1));
    const i1 = Math.max(0, Math.min(activeState.i1, n - 1));
    const a = Math.max(0, Math.min(1, activeState.a));
    const pick = a < 0.5 ? i0 : i1;
    const p0 = renderPoints[i0] ?? null;
    const p1 = renderPoints[i1] ?? null;
    const picked = renderPoints[pick] ?? null;
    if (!p0 || !p1 || !picked) return null;
    const sharePriceBase = p0.sharePriceBase + (p1.sharePriceBase - p0.sharePriceBase) * a;
    const vestedShares = p0.vestedShares + (p1.vestedShares - p0.vestedShares) * a;
    const value = p0.value + (p1.value - p0.value) * a;
    const monthGrowth = (() => {
      const t = new Date(`${picked.date}T00:00:00.000Z`).getTime();
      if (!Number.isFinite(t)) return null;
      const target = t - 30 * 24 * 60 * 60 * 1000;
      let prevIdx = -1;
      for (let i = pick; i >= 0; i -= 1) {
        const ti = new Date(`${renderPoints[i]?.date}T00:00:00.000Z`).getTime();
        if (!Number.isFinite(ti)) continue;
        if (ti <= target) {
          prevIdx = i;
          break;
        }
      }
      if (prevIdx < 0) return null;
      const prev = renderPoints[prevIdx] ?? null;
      if (!prev) return null;
      const prevValue = prev.value;
      if (!(prevValue > 0)) return null;
      return ((value - prevValue) / prevValue) * 100;
    })();
    return {
      date: picked.date,
      vestedShares,
      sharePriceBase,
      value,
      monthGrowth,
    };
  }, [activeState, baseCurrency, displayCurrency, renderPoints]);

  const activeX = activeState?.x ?? 0;
  const activeY = active ? toY(active.value) : 0;

  const setFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xPx = clientX - rect.left;
    const t = plotW > 0 ? (xPx - padding.left) / plotW : 0;
    const clamped = Math.max(0, Math.min(1, t));
    const n = renderPoints.length;
    const f = clamped * (n - 1);
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f)));
    const i1 = Math.max(0, Math.min(n - 1, i0 + 1));
    const a = Math.max(0, Math.min(1, f - i0));
    const x = padding.left + clamped * plotW;
    const next = { x, i0, i1, a };

    const prev = activeRef.current;
    if (prev && Math.abs(prev.x - next.x) < 0.25 && prev.i0 === next.i0 && prev.i1 === next.i1 && Math.abs(prev.a - next.a) < 0.001) {
      return;
    }
    activeRef.current = next;
    setActiveState(next);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const x = e.clientX;
    rafRef.current = requestAnimationFrame(() => setFromClientX(x));
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const activeDateLabel = (() => {
    if (!active?.date) return "";
    const d = new Date(`${active.date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return active.date;
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  })();

  const startLabel = (() => {
    const first = renderPoints[0]?.date ?? "";
    if (!first) return "";
    const d = new Date(`${first}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return first;
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "2-digit", day: "2-digit" }).format(d);
  })();

  const endLabel = (() => {
    const last = renderPoints[renderPoints.length - 1]?.date ?? "";
    if (!last) return "";
    const d = new Date(`${last}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return last;
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "2-digit", day: "2-digit" }).format(d);
  })();

  const tooltipStyle = useMemo(() => {
    const left = Math.max(12, Math.min(size.w - 12, activeX));
    const boxH = 102;
    const pad = 8;
    const above = activeY - boxH - 10;
    const below = activeY + 10;
    const top = above >= pad ? above : below <= size.h - boxH - pad ? below : Math.max(pad, Math.min(size.h - boxH - pad, above));
    const preferLeft = activeX > size.w * 0.55;
    return {
      left,
      top,
      transform: preferLeft ? "translateX(-100%)" : "translateX(0)",
      marginLeft: preferLeft ? -10 : 10,
    } as const;
  }, [activeX, activeY, size.h, size.w]);

  return (
    <div ref={rootRef} data-eq-root="1">
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>{lang === "en" ? "Equity value curve" : lang === "zh-TW" ? "個人資產曲線" : "个人资产曲线"}</span>
        <div className="flex items-center rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
          {(["7D", "30D", "ALL"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setRange(k)}
              onTouchStart={(e) => {
                e.preventDefault();
                setRange(k);
              }}
              data-eq-range-btn={k}
              className={`h-6 rounded-full px-2 text-[11px] font-medium transition-colors ${
                range === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
              } touch-manipulation`}
            >
              {k === "ALL" ? (lang === "en" ? "All" : "全部") : k.toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        data-eq-surface="1"
        className="relative mt-2 h-[250px] w-full touch-pan-y select-none overflow-hidden rounded-xl border border-emerald-100 bg-white/60 md:h-44"
        onPointerEnter={(e) => onPointerMove(e)}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") {
            e.currentTarget.setPointerCapture(e.pointerId);
            onPointerMove(e);
            return;
          }

          pressActiveRef.current = true;
          pressStartRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== "touch") {
            onPointerMove(e);
            return;
          }
          const s = pressStartRef.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = Math.abs(e.clientX - s.x);
          const dy = Math.abs(e.clientY - s.y);
          if (dy > dx + 10) {
            pressStartRef.current = null;
            pressActiveRef.current = false;
            setActiveState(null);
            return;
          }
          if (!pressActiveRef.current) return;
          onPointerMove(e);
        }}
        onPointerUp={() => {
          pressStartRef.current = null;
          pressActiveRef.current = false;
        }}
        onPointerCancel={() => {
          pressStartRef.current = null;
          pressActiveRef.current = false;
          setActiveState(null);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActiveState(null);
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          pressActiveRef.current = true;
          pressStartRef.current = { id: 0, x: t.clientX, y: t.clientY };
          setFromClientX(t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!t) return;
          const s = pressStartRef.current;
          if (!s) return;
          const dx = Math.abs(t.clientX - s.x);
          const dy = Math.abs(t.clientY - s.y);
          if (dy > dx + 10) {
            pressStartRef.current = null;
            pressActiveRef.current = false;
            return;
          }
          if (dx > 6) e.preventDefault();
          if (!pressActiveRef.current) return;
          setFromClientX(t.clientX);
        }}
        onTouchEnd={() => {
          pressStartRef.current = null;
          pressActiveRef.current = false;
        }}
        onTouchCancel={() => {
          pressStartRef.current = null;
          pressActiveRef.current = false;
          setActiveState(null);
        }}
      >
        {size.w <= 0 || size.h <= 0 ? (
          <div className="absolute inset-0 p-4">
            <SkeletonBlock className="h-5 w-28" />
            <SkeletonBlock className="mt-3 h-28 w-full" />
            <div className="mt-3 flex items-center justify-between">
              <SkeletonBlock className="h-4 w-14" />
              <SkeletonBlock className="h-4 w-14" />
            </div>
          </div>
        ) : (
          <svg width={size.w} height={size.h} className="block h-full w-full touch-none" data-eq-svg="1">
            {grantLinePath ? (
              <path
                d={grantLinePath}
                fill="none"
                stroke="rgba(113,113,122,0.75)"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
            ) : null}
            {areaPath ? <path d={areaPath} fill="rgba(16,185,129,0.12)" data-eq-area="1" /> : null}
            {mainLinePath ? <path d={mainLinePath} fill="none" stroke="#10b981" strokeWidth="2" data-eq-line="1" /> : null}

            <line
              x1={padding.left}
              x2={padding.left + plotW}
              y1={padding.top + plotH}
              y2={padding.top + plotH}
              stroke="rgba(24,24,27,0.12)"
              strokeWidth="1"
            />

            <line
              x1={activeX}
              x2={activeX}
              y1={padding.top}
              y2={padding.top + plotH}
              stroke="rgba(24,24,27,0.14)"
              strokeWidth="1"
              opacity={active ? 1 : 0}
              data-eq-vline="1"
            />
            <line
              x1={padding.left}
              x2={padding.left + plotW}
              y1={activeY}
              y2={activeY}
              stroke="rgba(24,24,27,0.10)"
              strokeWidth="1"
              opacity={active ? 1 : 0}
              data-eq-hline="1"
            />
            <circle cx={activeX} cy={activeY} r="3" fill="#10b981" opacity={active ? 1 : 0} data-eq-dot="1" />

            <text x={padding.left} y={size.h - 4} fontSize="10" fill="rgba(113,113,122,1)" data-eq-start="1">
              {startLabel}
            </text>
            <text
              x={size.w - padding.right}
              y={size.h - 4}
              fontSize="10"
              fill="rgba(113,113,122,1)"
              textAnchor="end"
              data-eq-end="1"
            >
              {endLabel}
            </text>
          </svg>
        )}

        <div
          className="pointer-events-none absolute top-2 rounded-xl border border-black/5 bg-white/80 px-3 py-2 text-[11px] text-zinc-700 shadow-xl backdrop-blur-md"
          style={{
            ...tooltipStyle,
            opacity: active ? 1 : 0,
          }}
          data-eq-tooltip="1"
        >
          <div className="text-zinc-500" data-eq-tooltip-date="1">
            {active ? activeDateLabel || active.date : ""}
          </div>
          <div className="mt-0.5 font-mono text-zinc-900 sm:hidden" data-eq-tooltip-value="1">
            {active ? moneyFormatter.format(active.value) : ""}
          </div>
          <div className="mt-1 hidden sm:grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="text-zinc-500">{lang === "en" ? "Shares" : lang === "zh-TW" ? "股數" : "股数"}</div>
            <div className="font-mono text-zinc-900">{active ? shareFormatter.format(active.vestedShares) : ""}</div>
            <div className="text-zinc-500">{lang === "en" ? "Price" : lang === "zh-TW" ? "股價" : "股价"}</div>
            <div className="font-mono text-zinc-900">{active ? sharePriceFormatter.format(active.sharePriceBase) : ""}</div>
            <div className="text-zinc-500">{lang === "en" ? "Value" : lang === "zh-TW" ? "價值" : "价值"}</div>
            <div className="font-mono text-zinc-900">{active ? moneyFormatter.format(active.value) : ""}</div>
            <div className="text-zinc-500">{lang === "en" ? "MoM" : lang === "zh-TW" ? "較上月" : "较上月"}</div>
            <div className="font-mono text-zinc-900">
              {active && typeof active.monthGrowth === "number" && Number.isFinite(active.monthGrowth)
                ? `${active.monthGrowth >= 0 ? "+" : ""}${active.monthGrowth.toFixed(1)}%`
                : active
                  ? "—"
                  : ""}
            </div>
          </div>
        </div>

        {!active ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-black/5 bg-white/80 px-2 py-1 text-[11px] text-zinc-700 shadow-sm backdrop-blur-md">
            <div className="text-zinc-500">
              {(renderPoints[renderPoints.length - 1]?.date || "").toString()}
            </div>
            <div className="mt-0.5 font-mono text-zinc-900">
              {moneyFormatter.format((renderPoints[renderPoints.length - 1]?.value ?? 0) as number)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function currencyRate(currency: Currency) {
  if (currency === "HKD") return 7.8;
  if (currency === "CNY") return 7.2;
  return 1;
}

function convertMoney(amount: number, from: Currency, to: Currency) {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  const fromRate = currencyRate(from);
  const usd = from === "USD" ? amount : amount / fromRate;
  const toRate = currencyRate(to);
  return to === "USD" ? usd : usd * toRate;
}

function formatNumber(n: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(n);
}

function formatCurrency(n: number, currency: Currency, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(Number.isFinite(n) ? n : 0);
}

export function CurrencyLangSwitcher({
  currency,
  lang,
  pricingLabel,
  languageLabel,
  currencyOptions,
  langOptions,
}: {
  currency: Currency;
  lang: Lang;
  pricingLabel: string;
  languageLabel: string;
  currencyOptions: Array<{ label: string; href: string; active: boolean }>;
  langOptions: Array<{ label: string; href: string; active: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const langShort = lang === "zh-CN" ? "简体" : lang === "zh-TW" ? "繁體" : "EN";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const lastToggleAtRef = useRef(0);

  const toggleOpen = useCallback((e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    const now = Date.now();
    if (now - lastToggleAtRef.current < 420) {
      try {
        e?.preventDefault?.();
        e?.stopPropagation?.();
      } catch {}
      return;
    }
    lastToggleAtRef.current = now;
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    } catch {}
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setOpen(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("touchstart", onTouchStart, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const onTouchStart = (e: TouchEvent) => {
      toggleOpen(e);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      toggleOpen(e);
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    btn.addEventListener("pointerdown", onPointerDown, { passive: false });
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("pointerdown", onPointerDown);
    };
  }, [toggleOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-11 touch-manipulation items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-900 active:bg-zinc-50 md:h-9"
        onPointerDown={(e) => {
          if (e.pointerType === "touch") toggleOpen(e);
        }}
        onTouchStart={(e) => toggleOpen(e)}
        onClick={(e) => toggleOpen(e)}
        aria-expanded={open}
      >
        <span className="font-mono tabular-nums">{currency}</span>
        <span className="text-zinc-500">·</span>
        <span>{langShort}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <>
          <div className="absolute right-0 z-[1000] mt-2 w-[320px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
            <div className="px-4 py-3">
              <div className="text-xs font-medium text-zinc-900">{pricingLabel}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {currencyOptions.map((it) => (
                  <Link
                    key={it.label}
                    href={it.href}
                    scroll={false}
                    prefetch
                    onClick={() => setOpen(false)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      it.active
                        ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="h-px bg-zinc-200" />
            <div className="px-4 py-3">
              <div className="text-xs font-medium text-zinc-900">{languageLabel}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {langOptions.map((it) => (
                  <Link
                    key={it.label}
                    href={it.href}
                    scroll={false}
                    prefetch
                    onClick={() => setOpen(false)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      it.active
                        ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function UserActionsMenu({
  lang,
  changePasswordHref,
  changePasswordLabel,
  logoutLabel,
  logoutAction,
}: {
  lang: Lang;
  changePasswordHref: string;
  changePasswordLabel: string;
  logoutLabel: string;
  logoutAction: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const lastToggleAtRef = useRef(0);

  const toggleOpen = useCallback((e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    const now = Date.now();
    if (now - lastToggleAtRef.current < 420) {
      try {
        e?.preventDefault?.();
        e?.stopPropagation?.();
      } catch {}
      return;
    }
    lastToggleAtRef.current = now;
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    } catch {}
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const onTouchStart = (e: TouchEvent) => {
      toggleOpen(e);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      toggleOpen(e);
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    btn.addEventListener("pointerdown", onPointerDown, { passive: false });
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("pointerdown", onPointerDown);
    };
  }, [toggleOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
        onPointerDown={(e) => {
          if (e.pointerType === "touch") toggleOpen(e);
        }}
        onTouchStart={(e) => toggleOpen(e)}
        onClick={(e) => toggleOpen(e)}
        aria-expanded={open}
        aria-label={lang === "en" ? "Menu" : "菜单"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 z-[1000] mt-2 w-[220px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
          <div className="flex flex-col p-2">
            <Link
              href={changePasswordHref}
              scroll={false}
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center rounded-xl px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
            >
              {changePasswordLabel}
            </Link>
            <form action={logoutAction}>
              <input type="hidden" name="lang" value={lang} />
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center rounded-xl px-3 text-left text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
                onClick={() => setOpen(false)}
              >
                {logoutLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MobileDashboardMenu({
  lang,
  title,
  subtitle,
  pricingLabel,
  languageLabel,
  currencyOptions,
  langOptions,
  changePasswordHref,
  changePasswordLabel,
  logoutLabel,
  logoutAction,
}: {
  lang: Lang;
  title: string;
  subtitle: string;
  pricingLabel: string;
  languageLabel: string;
  currencyOptions: Array<{ label: string; href: string; active: boolean }>;
  langOptions: Array<{ label: string; href: string; active: boolean }>;
  changePasswordHref: string;
  changePasswordLabel: string;
  logoutLabel: string;
  logoutAction: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setOpen(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("touchstart", onTouchStart, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md active:bg-white"
        onClick={() => setOpen(true)}
        aria-label={lang === "en" ? "Menu" : "菜单"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[1000]">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
          <div className="absolute inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto w-full max-w-lg rounded-t-3xl border border-zinc-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900">{title}</div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                  onClick={() => setOpen(false)}
                  aria-label={lang === "en" ? "Close" : "关闭"}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="px-5 pb-5 pt-4">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-semibold text-zinc-900">{pricingLabel}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currencyOptions.map((it) => (
                      <Link
                        key={it.label}
                        href={it.href}
                        scroll={false}
                        onClick={() => setOpen(false)}
                        className={`inline-flex h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold ${
                          it.active
                            ? "border-zinc-300 bg-white text-zinc-900 shadow-sm"
                            : "border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white"
                        }`}
                      >
                        {it.label}
                      </Link>
                    ))}
                  </div>

                  <div className="mt-4 text-xs font-semibold text-zinc-900">{languageLabel}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {langOptions.map((it) => (
                      <Link
                        key={it.label}
                        href={it.href}
                        scroll={false}
                        onClick={() => setOpen(false)}
                        className={`inline-flex h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold ${
                          it.active
                            ? "border-zinc-300 bg-white text-zinc-900 shadow-sm"
                            : "border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white"
                        }`}
                      >
                        {it.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link
                    href={changePasswordHref}
                    scroll={false}
                    onClick={() => setOpen(false)}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
                  >
                    {changePasswordLabel}
                  </Link>
                  <form action={logoutAction}>
                    <input type="hidden" name="lang" value={lang} />
                    <button
                      type="submit"
                      className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800"
                      onClick={() => setOpen(false)}
                    >
                      {logoutLabel}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type UsdRates = Partial<Record<Currency, number>>;

function convertWithUsdRates(amount: number, from: Currency, to: Currency, usdRates: UsdRates | null) {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;

  const rates = usdRates;
  const fromRate = from === "USD" ? 1 : rates?.[from] ?? null;
  const toRate = to === "USD" ? 1 : rates?.[to] ?? null;
  if (!fromRate || !toRate) {
    return convertMoney(amount, from, to);
  }
  const usd = from === "USD" ? amount : amount / fromRate;
  return to === "USD" ? usd : usd * toRate;
}

function useUsdRates() {
  const [rates, setRates] = useState<UsdRates | null>(() => {
    if (typeof window === "undefined") return null;
    const key = "esop_fx_usd_rates_v1";
    const now = Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { t?: number; rates?: UsdRates };
      if (parsed?.t && typeof parsed.t === "number" && now - parsed.t < maxAgeMs && parsed?.rates) {
        return parsed.rates;
      }
    } catch {}
    return null;
  });

  useEffect(() => {
    const key = "esop_fx_usd_rates_v1";
    const now = Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;

    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
        if (cancelled) return;
        const r = json?.rates ?? {};
        const next: UsdRates = {
          USD: 1,
          HKD: typeof r.HKD === "number" && Number.isFinite(r.HKD) ? r.HKD : undefined,
          CNY: typeof r.CNY === "number" && Number.isFinite(r.CNY) ? r.CNY : undefined,
        };
        setRates(next);
        try {
          localStorage.setItem(key, JSON.stringify({ t: now, rates: next }));
        } catch {}
      } catch {}
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return rates;
}

export function VisionTotalOptionValue({
  lang,
  totalShares,
  vestedShares,
  unvestedShares,
  baseCurrency,
  companySharePriceBase,
  displayCurrency,
  boundAssetUsdBase,
  exitCostUnvestedUsdBase,
  className,
}: {
  lang: "zh-CN" | "zh-TW" | "en";
  totalShares: number;
  vestedShares?: number;
  unvestedShares?: number;
  baseCurrency: Currency;
  companySharePriceBase: number;
  displayCurrency: Currency;
  boundAssetUsdBase?: number;
  exitCostUnvestedUsdBase?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "").toLowerCase();
  const valueStaticId = `vision-value-${uid}`;
  const priceStaticId = `vision-price-${uid}`;
  const rangeId = `vision-range-${uid}`;
  const resetId = `vision-reset-${uid}`;
  const hapticCardId = `vision-haptic-${uid}`;
  const usdRates = useUsdRates();
  const [isMobile, setIsMobile] = useState(false);
  const [polledPriceBase, setPolledPriceBase] = useState<number | null>(null);
  const [polledBaseCurrency, setPolledBaseCurrency] = useState<Currency | null>(null);
  const rafValueRef = useRef<number | null>(null);

  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(m.matches);
    update();
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", update);
      return () => m.removeEventListener("change", update);
    }
    m.addListener(update);
    return () => m.removeListener(update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const res = await fetch("/api/share-price/latest", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; price?: number; currency?: string; pollMs?: number };
        const pollMs =
          typeof json.pollMs === "number" && Number.isFinite(json.pollMs) ? Math.max(1000, json.pollMs) : 60 * 60 * 1000;
        if (!cancelled) {
          if (json.ok && typeof json.price === "number" && Number.isFinite(json.price)) {
            setPolledPriceBase(json.price);
          }
          const parsed = parseCurrency(json.currency);
          if (parsed) setPolledBaseCurrency(parsed);
          timer = window.setTimeout(tick, pollMs);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 60 * 60 * 1000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const livePriceBase = polledPriceBase ?? (Number.isFinite(companySharePriceBase) ? companySharePriceBase : 0);
  const liveBaseCurrency = polledBaseCurrency ?? baseCurrency;

  const safeInitial = convertWithUsdRates(
    Number.isFinite(livePriceBase) ? livePriceBase : 0,
    liveBaseCurrency,
    displayCurrency,
    usdRates,
  );
  const safeShares = Math.max(0, Math.floor(Number(totalShares || 0)));

  const [price, setPrice] = useState(() => safeInitial);
  const [flash, setFlash] = useState<"" | "up" | "down">("");
  const [fitScale, setFitScale] = useState(1);
  const lastValueRef = useRef<number>(safeShares * safeInitial);
  const valueBoxRef = useRef<HTMLDivElement | null>(null);
  const valueTextRef = useRef<HTMLDivElement | null>(null);
  const lastHapticAtRef = useRef(0);
  const lastTickIdxRef = useRef<number | null>(null);
  const lastPriceRef = useRef(price);
  const prevInitialRef = useRef(safeInitial);
  const rangeRef = useRef<HTMLInputElement | null>(null);

  const min = 0;
  const max = Math.max(1, safeInitial > 0 ? safeInitial * 6 : 50);
  const step = Math.max(0.01, Number.isFinite(safeInitial) && safeInitial > 0 ? safeInitial / 200 : 0.05);

  const value = safeShares * (Number.isFinite(price) ? price : 0);
  const [valueDisplay, setValueDisplay] = useState(value);
  const valueDisplayRef = useRef(value);

  useEffect(() => {
    valueDisplayRef.current = valueDisplay;
  }, [valueDisplay]);

  useEffect(() => {
    const start = performance.now();
    const duration = 680;
    if (rafValueRef.current) cancelAnimationFrame(rafValueRef.current);
    const startValue = valueDisplayRef.current;
    const targetValue = value;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startValue + (targetValue - startValue) * eased;
      setValueDisplay(next);
      if (t < 1) {
        rafValueRef.current = requestAnimationFrame(tick);
      } else {
        valueDisplayRef.current = targetValue;
      }
    };
    rafValueRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafValueRef.current) cancelAnimationFrame(rafValueRef.current);
    };
  }, [value]);

  const valueText = formatCurrency(valueDisplay, displayCurrency, 2);
  const valueChars = valueText.length;
  const valueFontSize = isMobile
    ? valueChars >= 16
      ? "clamp(16px,6.2vw,28px)"
      : valueChars >= 14
        ? "clamp(18px,6.6vw,32px)"
        : valueChars >= 12
          ? "clamp(20px,7.0vw,36px)"
          : "clamp(22px,7.6vw,40px)"
    : valueChars >= 16
      ? "clamp(18px,3.1vw,32px)"
      : valueChars >= 14
        ? "clamp(20px,3.4vw,36px)"
        : valueChars >= 12
          ? "clamp(22px,3.8vw,42px)"
          : "clamp(24px,4.2vw,48px)";
  const isAtRealPrice = Math.abs(price - safeInitial) <= step / 2;
  const pricePct = max > min ? Math.max(0, Math.min(1, ((Number.isFinite(price) ? price : 0) - min) / (max - min))) : 0;

  const applyPriceFromRange = useCallback(
    (raw: string, mode: "input" | "change" | "touch", el?: HTMLInputElement | null) => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      let next = parsed;
      if (mode === "change") {
        const snapTh = step * 2;
        if (safeInitial > 0 && Math.abs(next - safeInitial) <= snapTh) next = safeInitial;
      }
      lastPriceRef.current = next;
      setPrice(next);

      if (mode === "change") {
        const r = rangeRef.current;
        if (r && Number(r.value) !== next) {
          try {
            r.value = String(next);
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {}
        }
      }

      const hapticHandledByScript = (el ?? null)?.dataset?.haptic === "1";
      const now = Date.now();
      const range = max - min;
      const pct = range > 0 ? Math.max(0, Math.min(1, (next - min) / range)) : 0;
      const tickIdx = Math.round(pct * 100);
      const tickChanged = tickIdx !== lastTickIdxRef.current;
      if (tickChanged) lastTickIdxRef.current = tickIdx;
      if (tickChanged && !hapticHandledByScript) {
        if (now - lastHapticAtRef.current > 28) {
          fireHaptic(8);
          lastHapticAtRef.current = now;
        }
      }
    },
    [max, min, safeInitial, step],
  );

  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const onInput = () => applyPriceFromRange(el.value, "input", el);
    const onChange = () => applyPriceFromRange(el.value, "change", el);
    const onTouchMove = () => applyPriceFromRange(el.value, "touch", el);
    el.addEventListener("input", onInput, { passive: true });
    el.addEventListener("change", onChange, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [applyPriceFromRange]);

  const resetToReal = useCallback(
    () => {
      const next = safeInitial;
      lastPriceRef.current = next;
      setPrice(next);
      const el = rangeRef.current;
      if (el) {
        try {
          el.value = String(next);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {}
      }
    },
    [safeInitial],
  );

  useEffect(() => {
    const btn = document.getElementById(resetId) as HTMLButtonElement | null;
    if (!btn) return;
    const onTouchStart = (e: TouchEvent) => {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      resetToReal();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      resetToReal();
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    btn.addEventListener("pointerdown", onPointerDown, { passive: false });
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("pointerdown", onPointerDown);
    };
  }, [resetId, resetToReal]);

  useEffect(() => {
    const prevInitial = prevInitialRef.current;
    prevInitialRef.current = safeInitial;
    const currentPrice = lastPriceRef.current;
    const factor = prevInitial > 0 ? currentPrice / prevInitial : 1;
    const nextPrice = safeInitial * (Number.isFinite(factor) ? factor : 1);
    setPrice(nextPrice);
    lastPriceRef.current = nextPrice;
  }, [safeInitial]);

  useEffect(() => {
    const box = valueBoxRef.current;
    const text = valueTextRef.current;
    if (!box || !text) return;
    if (typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const boxW = box.clientWidth;
        const textW = text.scrollWidth;
        if (!boxW || !textW) {
          setFitScale(1);
          return;
        }
        const next = Math.min(1, boxW / textW);
        const rounded = Math.max(0.5, Math.round(next * 1000) / 1000);
        setFitScale(rounded >= 0.999 ? 1 : rounded);
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    ro.observe(text);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [valueText]);

  useEffect(() => {
    lastPriceRef.current = price;
  }, [price]);

  useEffect(() => {
    const initial = safeInitial;
    const current = Number.isFinite(price) ? price : 0;
    const factor = initial > 0 ? current / initial : 1;
    const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    const boundEl = document.getElementById("ui-bound-asset-usd");
    const exitEl = document.getElementById("ui-exit-unvested-usd");
    const vestedValueEl = document.getElementById("ui-vested-option-value");
    const unvestedValueEl = document.getElementById("ui-unvested-option-value");
    if (boundEl && typeof boundAssetUsdBase === "number" && Number.isFinite(boundAssetUsdBase)) {
      boundEl.textContent = `US$${fmtInt.format(boundAssetUsdBase * (Number.isFinite(factor) ? factor : 1))}`;
    }
    if (exitEl && typeof exitCostUnvestedUsdBase === "number" && Number.isFinite(exitCostUnvestedUsdBase)) {
      exitEl.textContent = `US$${fmtInt.format(exitCostUnvestedUsdBase * (Number.isFinite(factor) ? factor : 1))}`;
    }
    const vestedS = typeof vestedShares === "number" && Number.isFinite(vestedShares) ? Math.max(0, vestedShares) : null;
    const unvestedS = typeof unvestedShares === "number" && Number.isFinite(unvestedShares) ? Math.max(0, unvestedShares) : null;
    if (vestedValueEl && vestedS != null) vestedValueEl.textContent = formatCurrency(vestedS * current, displayCurrency, 2);
    if (unvestedValueEl && unvestedS != null) unvestedValueEl.textContent = formatCurrency(unvestedS * current, displayCurrency, 2);
  }, [price, safeInitial, boundAssetUsdBase, exitCostUnvestedUsdBase, vestedShares, unvestedShares, displayCurrency]);

  useEffect(() => {
    const prev = lastValueRef.current;
    lastValueRef.current = value;
    if (!Number.isFinite(prev) || !Number.isFinite(value)) return;
    const delta = value - prev;
    if (Math.abs(delta) < 0.0001) return;
    setFlash(delta > 0 ? "up" : "down");
    const t = window.setTimeout(() => setFlash(""), 520);
    return () => window.clearTimeout(t);
  }, [value]);

  const labels =
    lang === "en"
      ? {
          title: "Valuation simulator",
          price: "Share price",
          hint: "Drag to simulate future price.",
          reset: "Reset",
        }
      : lang === "zh-TW"
        ? {
            title: "估值推演",
            price: "股價",
            hint: "拖動滑塊，推演未來股價。",
            reset: "回到即時",
          }
        : {
            title: "估值推演",
            price: "股价",
            hint: "拖动滑块，推演未来股价。",
            reset: "回到实时",
          };

  return (
    <div className={className}>
      <div ref={valueBoxRef} className="max-w-full overflow-hidden">
        <div
          ref={valueTextRef}
          id={valueStaticId}
          className={`inline-block font-mono tabular-nums font-extrabold tracking-tight ${
            flash === "up" ? "ui-price-flash-up" : flash === "down" ? "ui-price-flash-down" : ""
          }`}
          style={{
            fontSize: valueFontSize,
            lineHeight: "1.05",
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "left center",
            willChange: fitScale !== 1 ? "transform" : undefined,
          }}
        >
          {valueText}
        </div>
      </div>
      <div id={hapticCardId} className="mt-3 rounded-xl border border-zinc-200 bg-white/70 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium text-zinc-700">{labels.title}</div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-zinc-500">
              {labels.price} ·{" "}
              <span id={priceStaticId} className="font-mono tabular-nums text-indigo-700">
                {formatNumber(price, 2)}
              </span>
            </div>
            <button
              id={resetId}
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:px-2"
              onClick={resetToReal}
              onPointerDown={(e) => {
                if (e.pointerType === "touch") {
                  e.preventDefault();
                  resetToReal();
                }
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                resetToReal();
              }}
              disabled={isAtRealPrice}
              aria-label={labels.reset}
            >
              {labels.reset}
            </button>
          </div>
        </div>
        <div className="relative mt-2">
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500 md:hidden">
            <span>{labels.price}</span>
            <span className="font-mono tabular-nums text-indigo-700">{formatNumber(price, 2)}</span>
          </div>
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-7 z-10"
              style={{ left: `${pricePct * 100}%`, transform: "translateX(-50%)" }}
            >
              <div className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700 shadow-sm">
                {formatNumber(price, 2)}
              </div>
            </div>
            <input
              id={rangeId}
              ref={rangeRef}
              type="range"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(price) ? price : 0}
              data-vision-shares={safeShares}
              data-vision-currency={displayCurrency}
              data-vision-real={safeInitial}
              onTouchMove={(e) => applyPriceFromRange((e.target as HTMLInputElement).value, "touch", e.target as HTMLInputElement)}
              onInput={(e) => applyPriceFromRange((e.target as HTMLInputElement).value, "input", e.target as HTMLInputElement)}
              onChange={(e) => applyPriceFromRange(e.target.value, "change", e.target as HTMLInputElement)}
              className="ui-range h-6 w-full touch-pan-x touch-manipulation accent-indigo-600 md:h-2"
            />
          </div>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">{labels.hint}</div>
      </div>
    </div>
  );
}

export function ExerciseRequestForm({
  action,
  apiEndpoint = "/api/exercise/submit",
  lang,
  returnTo,
  baseCurrency,
  displayCurrency,
  companySharePriceBase,
  grants,
  usdtBnbAddress,
  usdtTrxAddress,
}: {
  action: (formData: FormData) => void;
  apiEndpoint?: string;
  lang: "zh-CN" | "zh-TW" | "en";
  returnTo: string;
  baseCurrency: Currency;
  displayCurrency: Currency;
  companySharePriceBase: number;
  grants: Array<{
    id: string;
    agreementNo: string;
    grantDateIso: string;
    strikePriceBase: number;
    remainingVestedShares: number;
  }>;
  usdtBnbAddress: string;
  usdtTrxAddress: string;
}) {
  const uid = useId().replace(/:/g, "").toLowerCase();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [sharesRaw, setSharesRaw] = useState<string>("");
  const [chain, setChain] = useState<"BNB" | "TRX">("BNB");
  const [txHash, setTxHash] = useState<string>("");
  const [hasProof, setHasProof] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const toastSeqRef = useRef(0);
  const [netToast, setNetToast] = useState<{ id: string; title: string; lines: string[] } | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const cooldownTimerRef = useRef<number | null>(null);
  const cooldownTickRef = useRef<number | null>(null);
  const pendingFormRef = useRef<FormData | null>(null);
  const maxBtnRef = useRef<HTMLButtonElement | null>(null);
  const rangeRef = useRef<HTMLInputElement | null>(null);
  const lastSliderPctRef = useRef<number | null>(null);
  const lastSliderHapticAtRef = useRef(0);
  const sharesInputId = `ex-shares-${uid}`;
  const maxBtnId = `ex-max-${uid}`;
  const rangeId = `ex-range-${uid}`;
  const selLabelId = `ex-sel-${uid}`;
  const valueMainId = `ex-vmain-${uid}`;
  const valueSubId = `ex-vsub-${uid}`;
  const costUsdtId = `ex-cusdt-${uid}`;
  const costDispId = `ex-cdisp-${uid}`;
  const nextBtnId = `ex-next-${uid}`;
  const backBtnId = `ex-back-${uid}`;
  const step1WrapId = `ex-step1-${uid}`;
  const step2WrapId = `ex-step2-${uid}`;
  const binderId = `ex-bind-${uid}`;
  const payToId = `ex-payto-${uid}`;
  const qrImgId = `ex-qr-${uid}`;
  const chainBnbId = `ex-chain-bnb-${uid}`;
  const chainTrxId = `ex-chain-trx-${uid}`;
  const txHashId = `ex-tx-${uid}`;
  const proofId = `ex-proof-${uid}`;
  const submitBtnId = `ex-submit-${uid}`;

  const orderedGrants = useMemo(() => {
    const out = [...grants];
    out.sort((a, b) => {
      const ad = String(a.grantDateIso || "");
      const bd = String(b.grantDateIso || "");
      if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
    return out;
  }, [grants]);

  const max = useMemo(() => {
    return Math.max(
      0,
      Math.floor(
        orderedGrants.reduce((sum, g) => sum + (Number.isFinite(g.remainingVestedShares) ? g.remainingVestedShares : 0), 0),
      ),
    );
  }, [orderedGrants]);

  const sharesParsed = Math.floor(Number(sharesRaw || "0"));
  const shares = Number.isFinite(sharesParsed) ? Math.max(0, sharesParsed) : 0;
  const safeShares = max > 0 ? Math.min(shares, max) : shares;

  const rate = (ccy: Currency) => {
    if (ccy === "HKD") return 7.8;
    if (ccy === "CNY") return 7.2;
    return 1;
  };
  const convert = (amount: number, from: Currency, to: Currency) => {
    if (!Number.isFinite(amount)) return 0;
    if (from === to) return amount;
    const usd = from === "USD" ? amount : amount / rate(from);
    return to === "USD" ? usd : usd * rate(to);
  };
  const fmtMoney = (amount: number, ccy: Currency) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(amount) ? amount : 0);
    } catch {
      return String(amount);
    }
  };
  const fmtNum = (amount: number) => {
    try {
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
    } catch {
      return String(amount);
    }
  };

  const sharePriceBase = Number.isFinite(companySharePriceBase) ? companySharePriceBase : 0;
  const allocation = useMemo(() => {
    let left = Math.max(0, Math.floor(safeShares));
    const out: Array<{ id: string; agreementNo: string; shares: number; strikePriceBase: number }> = [];
    for (const g of orderedGrants) {
      if (left <= 0) break;
      const rem = Math.max(0, Math.floor(Number(g.remainingVestedShares) || 0));
      if (rem <= 0) continue;
      const take = Math.min(rem, left);
      if (take > 0) {
        out.push({
          id: g.id,
          agreementNo: g.agreementNo,
          shares: take,
          strikePriceBase: Number.isFinite(g.strikePriceBase) ? g.strikePriceBase : 0,
        });
      }
      left -= take;
    }
    return out;
  }, [orderedGrants, safeShares]);

  const costBase = allocation.reduce((sum, a) => sum + a.shares * (Number.isFinite(a.strikePriceBase) ? a.strikePriceBase : 0), 0);
  const valueBase = safeShares * sharePriceBase;
  const valueDisp = convert(valueBase, baseCurrency, displayCurrency);
  const costDisp = convert(costBase, baseCurrency, displayCurrency);
  const costUsd = convert(costBase, baseCurrency, "USD");
  const payTo = chain === "BNB" ? (usdtBnbAddress || "") : (usdtTrxAddress || "");
  const qrSrc = payTo
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payTo)}`
    : "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const canNext = safeShares >= 1;
  const canSubmit = Boolean(payTo) && safeShares >= 1 && (Boolean(txHash.trim()) || hasProof);

  const labels =
    lang === "en"
      ? {
          step1: "Step 1 · Shares",
          step2: "Step 2 · Pay & proof",
          grant: "Grant",
          shares: "Shares to exercise",
          chain: "Network",
          strike: "Strike price",
          currentValue: "Current value",
          cost: "Exercise cost",
          payTo: "USDT receiving address",
          qr: "QR code",
          tx: "Payment Tx Hash",
          proof: "Transfer screenshot",
          proofHint: "If you can't get TxHash, upload a screenshot as proof.",
          next: "Next",
          back: "Back",
          submit: "Submit",
          submitting: "Submitting…",
          max: "Max",
          noGrants: "No vested shares to exercise.",
          missingPayInfo: "USDT address not set. Contact admin or switch network.",
        }
      : lang === "zh-TW"
        ? {
            step1: "第 1 步 · 行權股數",
            step2: "第 2 步 · 打款 + 憑證",
            grant: "協議",
            shares: "行權股數",
            chain: "網路",
            strike: "行權價",
            currentValue: "目前價值",
            cost: "需支付金額",
            payTo: "USDT 收款地址",
            qr: "收款二維碼",
            copy: "複製",
            copied: "已複製",
            copyFailed: "複製失敗",
            tx: "打款 TxHash",
            proof: "轉帳截圖（可選）",
            proofHint: "拿不到 TxHash 時，可上傳截圖作為憑證。",
            next: "下一步",
            back: "上一步",
            submit: "提交",
            submitting: "提交中…",
            max: "最大",
            noGrants: "暫無可行權的已成熟股數。",
            missingPayInfo: "尚未配置該鏈的 USDT 收款地址，請切換鏈或聯繫管理員。",
          }
        : {
            step1: "第 1 步 · 行权股数",
            step2: "第 2 步 · 打款 + 凭证",
            grant: "协议",
            shares: "行权股数",
            chain: "网络",
            strike: "行权价",
            currentValue: "当前价值",
            cost: "行权成本",
            payTo: "USDT 收款地址",
            qr: "收款二维码",
            tx: "打款 TxHash",
            proof: "转账截图（可选）",
            proofHint: "拿不到 TxHash 时，可上传截图作为凭证。",
            next: "下一步",
            back: "上一步",
            submit: "提交",
            submitting: "提交中…",
            max: "最大",
            noGrants: "暂无可行权的已成熟股数。",
            missingPayInfo: "未配置该链 USDT 收款地址，请切换网络或联系管理员。",
          };

  const showNetToast = useCallback(
    (title: string, lines: string[]) => {
      toastSeqRef.current += 1;
      setNetToast({ id: `${uid}-${toastSeqRef.current}`, title, lines });
    },
    [uid],
  );

  const cancelCooldown = useCallback(() => {
    try {
      if (cooldownTimerRef.current) window.clearTimeout(cooldownTimerRef.current);
      if (cooldownTickRef.current) window.clearInterval(cooldownTickRef.current);
    } catch {}
    cooldownTimerRef.current = null;
    cooldownTickRef.current = null;
    pendingFormRef.current = null;
    setCooldownSec(0);
  }, []);

  const strikeMin = orderedGrants.reduce((min, g) => Math.min(min, Number.isFinite(g.strikePriceBase) ? g.strikePriceBase : 0), Number.POSITIVE_INFINITY);
  const strikeMax = orderedGrants.reduce((max, g) => Math.max(max, Number.isFinite(g.strikePriceBase) ? g.strikePriceBase : 0), 0);
  const strikeLabel =
    Number.isFinite(strikeMin) && Number.isFinite(strikeMax) && strikeMin > 0 && strikeMax > 0 && strikeMin === strikeMax
      ? fmtMoney(convert(strikeMin, baseCurrency, displayCurrency), displayCurrency)
      : lang === "en"
        ? "Calculated per grant"
        : lang === "zh-TW"
          ? "按協議分別計算"
          : "按协议分别计算";

  const handleSharesRaw = useCallback(
    (raw: string) => {
      if (raw === "") {
        setSharesRaw("");
        setClamped(false);
        return;
      }
      const parsed = Math.floor(Number(raw || "0"));
      const n = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      const safe = max > 0 ? Math.min(n, max) : n;
      setClamped(safe !== n);
      setSharesRaw(String(safe));
    },
    [max],
  );

  const applyMax = useCallback(() => {
    setSharesRaw(String(max));
    setClamped(false);
  }, [max]);

  useEffect(() => {
    const el = maxBtnRef.current;
    if (!el) return;
    const on = (e: Event) => {
      try {
        e.preventDefault();
        (e as unknown as { stopPropagation?: () => void }).stopPropagation?.();
      } catch {}
      applyMax();
    };
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    el.addEventListener("touchstart", on, opts);
    el.addEventListener("pointerdown", on, opts);
    el.addEventListener("click", on, true);
    return () => {
      el.removeEventListener("touchstart", on, true);
      el.removeEventListener("pointerdown", on, true);
      el.removeEventListener("click", on, true);
    };
  }, [applyMax]);

  const sliderStep = useMemo(() => {
    if (max <= 0) return 1;
    if (max <= 500) return 1;
    return Math.max(1, Math.ceil(max / 200));
  }, [max]);

  const handleSlider = useCallback(
    (raw: string) => {
      const parsed = Math.floor(Number(raw || "0"));
      const n = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      const safe = max > 0 ? Math.min(n, max) : n;
      setClamped(false);
      setSharesRaw(String(safe));
      if (max > 0) {
        const now = Date.now();
        const pct = Math.round(Math.max(0, Math.min(1, safe / max)) * 100);
        const changed = pct !== lastSliderPctRef.current;
        if (changed) lastSliderPctRef.current = pct;
        if (changed && now - lastSliderHapticAtRef.current > 28) {
          fireHaptic(8);
          lastSliderHapticAtRef.current = now;
        }
      }
    },
    [max],
  );

  const onMaxTap = useCallback(
    (e: { preventDefault?: () => void; stopPropagation?: () => void }) => {
      try {
        e.preventDefault?.();
        e.stopPropagation?.();
      } catch {}
      applyMax();
    },
    [applyMax],
  );

  const onMaxTouchStart = useCallback(
    (e: React.TouchEvent) => {
      onMaxTap(e);
    },
    [onMaxTap],
  );

  const onMaxPointerDown = useCallback(
    (e: React.PointerEvent) => {
      onMaxTap(e);
    },
    [onMaxTap],
  );

  const onMaxClick = useCallback(
    (e: React.MouseEvent) => {
      onMaxTap(e);
    },
    [onMaxTap],
  );

  const handleSharesRawDirect = useCallback(
    (raw: string) => {
      handleSharesRaw(raw);
    },
    [handleSharesRaw],
  );

  const handleSharesInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      handleSharesRawDirect((e.target as HTMLInputElement).value);
    },
    [handleSharesRawDirect],
  );

  const handleSharesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleSharesRawDirect(e.target.value);
    },
    [handleSharesRawDirect],
  );

  const handleSliderInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      handleSlider((e.target as HTMLInputElement).value);
    },
    [handleSlider],
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleSlider(e.target.value);
    },
    [handleSlider],
  );
  const maxDisabled = max <= 0;

  useEffect(() => {
    const btn = maxBtnRef.current;
    if (!btn) return;
    const onTouchStart = (e: TouchEvent) => {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      applyMax();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      applyMax();
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    btn.addEventListener("pointerdown", onPointerDown, { passive: false });
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("pointerdown", onPointerDown);
    };
  }, [applyMax]);

  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const onInput = () => handleSlider(el.value);
    const onChange = () => handleSlider(el.value);
    el.addEventListener("input", onInput, { passive: true });
    el.addEventListener("change", onChange, { passive: true });
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, [handleSlider]);

  useEffect(() => {
    const btn = document.getElementById(nextBtnId) as HTMLButtonElement | null;
    if (!btn) return;
    const onTouchStart = (e: TouchEvent) => {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      setStep(2);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      if (btn.disabled) return;
      setStep(2);
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    btn.addEventListener("pointerdown", onPointerDown, { passive: false });
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("pointerdown", onPointerDown);
    };
  }, [nextBtnId]);

  if (orderedGrants.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        {labels.noGrants}
      </div>
    );
  }

  return (
    <>
      <form
        action={action}
        className="grid grid-cols-1 gap-3"
        data-ex-fallback="1"
        data-ex-base-currency={baseCurrency}
        data-ex-display-currency={displayCurrency}
        data-ex-share-price-base={sharePriceBase}
        data-ex-max={max}
        data-ex-usdt-bnb={usdtBnbAddress}
        data-ex-usdt-trx={usdtTrxAddress}
        data-ex-grants={JSON.stringify(
          orderedGrants.map((g) => ({
            id: g.id,
            remainingVestedShares: Math.max(0, Math.floor(Number(g.remainingVestedShares) || 0)),
            strikePriceBase: Number.isFinite(g.strikePriceBase) ? g.strikePriceBase : 0,
          })),
        )}
        onSubmit={async (e) => {
          try {
            e.preventDefault();
          } catch {}
          if (submittingRef.current || cooldownSec > 0) return;
          pendingFormRef.current = new FormData(e.currentTarget);
          setCooldownSec(3);
          try {
            if (cooldownTickRef.current) window.clearInterval(cooldownTickRef.current);
          } catch {}
          cooldownTickRef.current = window.setInterval(() => {
            setCooldownSec((s) => Math.max(0, s - 1));
          }, 1000);
          cooldownTimerRef.current = window.setTimeout(async () => {
            try {
              if (cooldownTickRef.current) window.clearInterval(cooldownTickRef.current);
            } catch {}
            cooldownTickRef.current = null;
            setCooldownSec(0);

            if (submittingRef.current) return;
            submittingRef.current = true;
            setSubmitting(true);
            try {
              if (typeof navigator !== "undefined" && navigator.onLine === false) {
                showNetToast(
                  lang === "en" ? "Offline" : lang === "zh-TW" ? "目前離線" : "当前离线",
                  [
                    lang === "en"
                      ? "Network is unavailable. Please reconnect and retry."
                      : lang === "zh-TW"
                        ? "網路不可用，請恢復連線後重試。"
                        : "网络不可用，请恢复连接后重试。",
                  ],
                );
                return;
              }

              const fd = pendingFormRef.current ?? new FormData(e.currentTarget);
              pendingFormRef.current = null;
              const ac = new AbortController();
              const timeoutMs = 10_000;
              const timeoutId = window.setTimeout(() => ac.abort(), timeoutMs);
              const res = await fetch(apiEndpoint, { method: "POST", body: fd, signal: ac.signal }).finally(() => {
                try {
                  window.clearTimeout(timeoutId);
                } catch {}
              });

              let data: unknown = null;
              try {
                data = await res.json();
              } catch {
                data = null;
              }
              const obj = data as { ok?: unknown; redirectTo?: unknown; error?: unknown } | null;
              if (res.status === 401) {
                const next =
                  lang === "zh-CN" ? "/?err=SESSION_EXPIRED" : `/?err=SESSION_EXPIRED&lang=${encodeURIComponent(lang)}`;
                router.push(`/logout?next=${encodeURIComponent(next)}`);
                return;
              }
              if (!res.ok || !obj?.ok) {
                const err = typeof obj?.error === "string" && obj.error ? obj.error : "SUBMIT_FAILED";
                const href = `${returnTo}${returnTo.includes("?") ? "&" : "?"}err=${encodeURIComponent(err)}`;
                router.replace(href, { scroll: false });
                return;
              }
              const redirectTo = typeof obj.redirectTo === "string" ? obj.redirectTo : "";
              if (redirectTo) {
                router.push(redirectTo, { scroll: false });
                return;
              }
              router.replace(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=${encodeURIComponent("SUBMIT_FAILED")}`, {
                scroll: false,
              });
            } catch (err) {
              const isAbort =
                (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") ||
                (typeof err === "object" && err && "name" in err && (err as { name?: unknown }).name === "AbortError");
              if (isAbort) {
                showNetToast(
                  lang === "en" ? "Request timed out" : lang === "zh-TW" ? "連線逾時" : "连接超时",
                  [
                    lang === "en"
                      ? "Network timeout. Please check and retry."
                      : lang === "zh-TW"
                        ? "網路連線逾時，請檢查後重試。"
                        : "网络连接超时，请检查后重试。",
                  ],
                );
                return;
              }
              if (typeof navigator !== "undefined" && navigator.onLine === false) {
                showNetToast(
                  lang === "en" ? "Offline" : lang === "zh-TW" ? "目前離線" : "当前离线",
                  [
                    lang === "en"
                      ? "Network is unavailable. Please reconnect and retry."
                      : lang === "zh-TW"
                        ? "網路不可用，請恢復連線後重試。"
                        : "网络不可用，请恢复连接后重试。",
                  ],
                );
                return;
              }
              showNetToast(
                lang === "en" ? "Network error" : lang === "zh-TW" ? "網路異常" : "网络异常",
                [
                  lang === "en"
                    ? "Submit failed due to network issues. Please retry."
                    : lang === "zh-TW"
                      ? "網路異常，提交失敗，請稍後重試。"
                      : "网络异常，提交失败，请稍后重试。",
                ],
              );
            } finally {
              submittingRef.current = false;
              setSubmitting(false);
            }
          }, 3000);
        }}
      >
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="ccy" value={displayCurrency} />
      <input type="hidden" name="baseCurrency" value={baseCurrency} />
      <input
        id={`ex-alloc-${uid}`}
        type="hidden"
        name="allocation"
        value={JSON.stringify(allocation.map((a) => ({ id: a.id, shares: a.shares })))}
      />
      <input id={`ex-amount-${uid}`} type="hidden" name="amountUsdt" value={Number(costUsd.toFixed(2))} />

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 font-medium ${
              step === 1 ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            {labels.step1}
          </span>
          <span className="text-zinc-400">→</span>
          <span
            className={`rounded-full border px-2 py-0.5 font-medium ${
              step === 2 ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            {labels.step2}
          </span>
        </div>
      </div>

      <div id={step1WrapId} className={step === 1 ? "grid grid-cols-1 gap-3" : "hidden grid-cols-1 gap-3"}>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-zinc-600">{labels.shares}</span>
          <div className="flex items-center gap-2">
            <input
              id={sharesInputId}
              value={sharesRaw}
              onChange={handleSharesChange}
              onInput={handleSharesInput}
              name="shares"
              type="number"
              min={1}
              inputMode="numeric"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base text-zinc-900 outline-none focus:border-zinc-300 md:h-10 md:text-sm"
              required
            />
            <button
              ref={maxBtnRef}
              id={maxBtnId}
              type="button"
              className={`h-11 shrink-0 touch-manipulation rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 active:bg-zinc-50 md:h-10 md:text-xs md:font-medium ${
                maxDisabled ? "opacity-50" : ""
              }`}
              onPointerDown={onMaxPointerDown}
              onTouchStart={onMaxTouchStart}
              onClick={onMaxClick}
              disabled={maxDisabled}
            >
              {labels.max}
            </button>
          </div>
          <div className="text-[11px] font-medium text-zinc-500">
            {lang === "en"
              ? `Total exercisable: ${formatNumber(max, 0)}`
              : lang === "zh-TW"
                ? `可行權總股數：${formatNumber(max, 0)} 股`
                : `可行权总股数：${formatNumber(max, 0)} 股`}
          </div>
          <div className={clamped ? "text-[11px] font-medium text-amber-700" : "hidden text-[11px] font-medium text-amber-700"}>
            {lang === "en" ? "Clamped to max exercisable shares." : lang === "zh-TW" ? "已自動按最大可行權股數計算。" : "已自动按最大可行权股数计算。"}
          </div>
        </label>

        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-zinc-600">
              {lang === "en" ? "Slide to choose shares" : lang === "zh-TW" ? "滑動選擇行權股數" : "滑动选择行权股数"}
            </div>
            <div className="font-mono text-xs text-zinc-600 tabular-nums">
              <span id={selLabelId}>{formatNumber(safeShares, 0)}</span> / {formatNumber(max, 0)}
            </div>
          </div>
          <input
            id={rangeId}
            ref={rangeRef}
            type="range"
            min={0}
            max={Math.max(0, max)}
            step={sliderStep}
            value={safeShares}
            onChange={handleSliderChange}
            onInput={handleSliderInput}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchMove={(e) => {
              e.stopPropagation();
            }}
            disabled={maxDisabled}
            className={`ui-range mt-3 h-6 w-full touch-pan-x touch-manipulation accent-indigo-600 md:h-2 ${maxDisabled ? "opacity-50" : ""}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-xs text-zinc-600">{labels.currentValue}</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">
              <span id={valueMainId} className="font-mono">
                {fmtMoney(valueDisp, displayCurrency)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
              <span id={valueSubId}>
                {fmtMoney(convert(sharePriceBase, baseCurrency, displayCurrency), displayCurrency)} × {formatNumber(safeShares, 0)}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-xs text-zinc-600">{labels.strike}</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900">
              <span className="font-mono">{strikeLabel}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
              {strikeMin > 0 && strikeMax > 0 && strikeMin !== strikeMax
                ? `${fmtMoney(convert(strikeMin, baseCurrency, displayCurrency), displayCurrency)} ~ ${fmtMoney(convert(strikeMax, baseCurrency, displayCurrency), displayCurrency)}`
                : lang === "en"
                  ? "Per share"
                  : lang === "zh-TW"
                    ? "每股"
                    : "每股"}
            </div>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-[0_8px_30px_rgb(99,102,241,0.18)]">
            <div className="text-xs font-medium text-indigo-700">{labels.cost}</div>
            <div className="mt-1 font-mono text-lg font-extrabold tabular-nums text-indigo-900">
              <span id={costUsdtId} className="whitespace-nowrap">
                {fmtNum(costUsd)} USDT
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-indigo-700">
              <span id={costDispId}>{fmtMoney(costDisp, displayCurrency)}</span>
            </div>
          </div>
        </div>

        <button
          id={nextBtnId}
          type="button"
          className="inline-flex h-11 touch-manipulation items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 md:h-10 md:font-medium"
          disabled={!canNext}
          onClick={() => {
            setStep(2);
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "touch") {
              e.preventDefault();
              setStep(2);
            }
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          {labels.next}
        </button>
      </div>

      <div id={step2WrapId} className={step === 2 ? "grid grid-cols-1 gap-3" : "hidden grid-cols-1 gap-3"}>
        <div className="grid grid-cols-2 gap-3">
          <label
            className="inline-flex h-11 touch-manipulation items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 active:bg-zinc-50"
            onClick={() => setChain("BNB")}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") {
                e.preventDefault();
                setChain("BNB");
              }
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              setChain("BNB");
            }}
          >
            <input
              id={chainBnbId}
              type="radio"
              name="chain"
              value="BNB"
              checked={chain === "BNB"}
              className="h-4 w-4"
              onChange={() => setChain("BNB")}
            />
            <span>BNB</span>
          </label>
          <label
            className="inline-flex h-11 touch-manipulation items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 active:bg-zinc-50"
            onClick={() => setChain("TRX")}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") {
                e.preventDefault();
                setChain("TRX");
              }
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              setChain("TRX");
            }}
          >
            <input
              id={chainTrxId}
              type="radio"
              name="chain"
              value="TRX"
              checked={chain === "TRX"}
              className="h-4 w-4"
              onChange={() => setChain("TRX")}
            />
            <span>TRX</span>
          </label>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs font-medium text-zinc-900">{labels.payTo}</div>
          <div className="mt-2 flex items-start gap-2">
            <div className="min-w-0 flex-1 break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-900">
              <span id={payToId} className="font-mono text-zinc-900">
                {payTo || "—"}
              </span>
            </div>
            <CopyButton value={payTo} label={lang === "en" ? "Copy address" : "复制地址"} />
          </div>
          <div
            className={
              payTo
                ? "hidden rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800"
                : "mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800"
            }
          >
            {labels.missingPayInfo}
          </div>
          <div className="mt-3 flex justify-center">
            <div className="h-44 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_10px_30px_rgb(0,0,0,0.05)]">
              <Image
                id={qrImgId}
                src={qrSrc}
                alt={labels.qr}
                width={176}
                height={176}
                unoptimized
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
            <span>{labels.tx}</span>
            <InlineTip
              text={
                lang === "en"
                  ? "Transaction hash from your wallet after sending USDT."
                  : lang === "zh-TW"
                    ? "錢包打款完成後的交易雜湊（TxHash）。"
                    : "钱包打款完成后的交易哈希（TxHash）。"
              }
            />
          </span>
          <input
            id={txHashId}
            value={txHash}
            onInput={(e) => setTxHash((e.target as HTMLInputElement).value)}
            onChange={(e) => setTxHash(e.target.value)}
            name="txHash"
            placeholder="0x..."
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-base text-zinc-900 outline-none focus:border-zinc-300 md:h-10 md:text-sm"
            disabled={!payTo}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
            <span>{labels.proof}</span>
            <InlineTip text={labels.proofHint} />
          </span>
          <input
            id={proofId}
            type="file"
            name="paymentProof"
            accept="image/*"
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-900"
            disabled={!payTo}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              setHasProof(Boolean(f));
            }}
          />
        </label>

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-xl bg-white/90 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-md md:static md:bg-transparent md:pb-0 md:pt-0 md:backdrop-blur-none">
          <button
            id={backBtnId}
            type="button"
            className="inline-flex h-11 flex-1 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 active:bg-zinc-50"
            onClick={() => setStep(1)}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") {
                e.preventDefault();
                setStep(1);
              }
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              setStep(1);
            }}
            disabled={submitting || cooldownSec > 0}
          >
            {labels.back}
          </button>
          <button
            id={submitBtnId}
            className="inline-flex h-11 flex-1 touch-manipulation items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={submitting || cooldownSec > 0 || !canSubmit}
            aria-busy={submitting || cooldownSec > 0}
          >
            {submitting ? labels.submitting : cooldownSec > 0 ? `${labels.submit} (${cooldownSec}s)` : labels.submit}
          </button>
        </div>
      </div>
      </form>
      {cooldownSec > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white/92 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">
                  {lang === "en" ? "Ready to submit" : lang === "zh-TW" ? "準備提交" : "准备提交"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {lang === "en" ? "You can undo in " : lang === "zh-TW" ? "可在 " : "可在 "}
                  <span className="font-mono tabular-nums text-zinc-700">{cooldownSec}</span>
                  {lang === "en" ? "s" : " 秒内撤销"}
                </div>
              </div>
              <button
                type="button"
                onClick={cancelCooldown}
                className="btn-press inline-flex h-9 touch-manipulation items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                {lang === "en" ? "Undo" : "撤销"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {netToast ? <ErrorToast toastId={netToast.id} title={netToast.title} lines={netToast.lines} durationMs={6000} /> : null}
    </>
  );
}

export function AdminLogoUploader({
  action,
  lang,
  returnTo,
  logoDataUrl,
}: {
  action: (formData: FormData) => void;
  lang: "zh-CN" | "zh-TW" | "en";
  returnTo: string;
  logoDataUrl: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <form ref={formRef} action={action} encType="multipart/form-data" className="group relative">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input
        ref={inputRef}
        name="logo"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white"
        onClick={() => inputRef.current?.click()}
      >
        {logoDataUrl ? (
          <Image src={logoDataUrl} alt="Logo" width={36} height={36} unoptimized />
        ) : (
          <div className="text-sm font-semibold text-zinc-700">E</div>
        )}
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover:flex">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4.5a2.1 2.1 0 0 0-3 0L3 15v5Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    </form>
  );
}
