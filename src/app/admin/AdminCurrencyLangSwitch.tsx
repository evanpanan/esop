"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export default function AdminCurrencyLangSwitch({
  currencyPills,
  currencyHint,
  langPills,
  variant = "page",
}: {
  currencyPills: Array<{ href: string; label: string; active: boolean }>;
  currencyHint: string;
  langPills: Array<{ href: string; label: string; active: boolean }>;
  variant?: "page" | "header";
}) {
  const activeCurrency = currencyPills.find((x) => x.active)?.label ?? currencyPills[0]?.label ?? "";
  const activeLang = langPills.find((x) => x.active)?.label ?? langPills[0]?.label ?? "";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const mounted = typeof document !== "undefined";

  const close = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;

    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      const width = 320;
      const padding = 8;
      const top = Math.round(rect.bottom + 8);
      const rawLeft = Math.round(rect.right - width);
      const left = Math.min(Math.max(padding, rawLeft), Math.max(padding, vw - width - padding));
      const safeTop = Math.min(Math.max(padding, top), Math.max(padding, vh - padding));
      setMenuPos({ top: safeTop, left, width });
    };

    const raf1 = window.requestAnimationFrame(update);
    const raf2 = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const overlay = open ? (
    <button
      type="button"
      className="fixed inset-0 z-[10000] cursor-default bg-transparent"
      aria-label="关闭"
      onClick={close}
    />
  ) : null;

  const menu = (
    <div
      className="fixed z-[10001] overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-xl backdrop-blur-md"
      style={{
        top: menuPos?.top ?? 0,
        left: menuPos?.left ?? 0,
        width: menuPos?.width ?? 320,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3">
        <div className="text-xs font-medium text-zinc-900">计价币种</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {currencyPills.map((it) => (
            <Link
              key={it.label}
              href={it.href}
              className={`rounded-full border px-3 py-1 text-xs font-medium touch-manipulation ${
                it.active
                  ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                  : "border-black/5 bg-white/80 text-zinc-700 hover:bg-white"
              }`}
              scroll={false}
              prefetch
              onClick={close}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                router.replace(it.href, { scroll: false });
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                router.replace(it.href, { scroll: false });
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">{currencyHint}</div>
      </div>
      <div className="h-px bg-black/5" />
      <div className="px-4 py-3">
        <div className="text-xs font-medium text-zinc-900">语言</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {langPills.map((it) => (
            <Link
              key={it.label}
              href={it.href}
              className={`rounded-full border px-3 py-1 text-xs font-medium touch-manipulation ${
                it.active
                  ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                  : "border-black/5 bg-white/80 text-zinc-700 hover:bg-white"
              }`}
              scroll={false}
              prefetch
              onClick={close}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                router.replace(it.href, { scroll: false });
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                router.replace(it.href, { scroll: false });
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );

  const triggerLabel = variant === "header" ? (
    <>
      <span className="font-mono tabular-nums">{activeCurrency}</span>
      <span className="text-zinc-500">·</span>
      <span>{activeLang}</span>
    </>
  ) : (
    <>设置</>
  );

  const triggerClassName =
    variant === "header"
      ? "btn-press btn-ripple inline-flex h-9 list-none items-center justify-center gap-2 rounded-xl border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white"
      : "btn-press btn-ripple inline-flex h-9 list-none items-center justify-center gap-2 rounded-xl border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white";

  if (variant === "header") {
    return (
      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          className={triggerClassName}
          onPointerDown={(e) => {
            e.preventDefault();
            setOpen((v) => {
              const next = !v;
              if (!next) setMenuPos(null);
              return next;
            });
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setOpen((v) => {
              const next = !v;
              if (!next) setMenuPos(null);
              return next;
            });
          }}
          aria-expanded={open}
        >
          {triggerLabel}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {mounted && open && menuPos ? createPortal(<>{overlay}{menu}</>, document.body) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">
          显示：<span className="font-mono tabular-nums text-zinc-900">{activeCurrency}</span> ·{" "}
          <span className="text-zinc-900">{activeLang}</span>
        </span>
        <span className="hidden text-xs text-zinc-500 md:inline">{currencyHint}</span>
      </div>

      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          className={triggerClassName}
          onPointerDown={(e) => {
            e.preventDefault();
            setOpen((v) => {
              const next = !v;
              if (!next) setMenuPos(null);
              return next;
            });
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setOpen((v) => {
              const next = !v;
              if (!next) setMenuPos(null);
              return next;
            });
          }}
          aria-expanded={open}
        >
          {triggerLabel}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {mounted && open && menuPos ? createPortal(<>{overlay}{menu}</>, document.body) : null}
      </div>
    </div>
  );
}
