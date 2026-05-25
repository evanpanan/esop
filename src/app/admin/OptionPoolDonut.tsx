"use client";

import { useId, useMemo, useState } from "react";

export function OptionPoolDonut({
  pct,
  leaderboard,
}: {
  pct: number;
  leaderboard: Array<{
    rank: number;
    employee: string;
    shares: string;
    value: string;
  }>;
}) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  const normalized = useMemo(() => {
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(pct, 1));
  }, [pct]);

  const dash = useMemo(() => {
    const r = 22;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - normalized);
    return { r, c, offset } as const;
  }, [normalized]);

  return (
    <div className="group relative">
      <button
        type="button"
        aria-describedby={tooltipId}
        className="relative inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full transition-transform duration-200 active:translate-y-[1px]"
        onClick={() => {
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
      >
        <svg
          viewBox="0 0 56 56"
          className="h-14 w-14"
          aria-label="option pool progress"
        >
          <circle cx="28" cy="28" r={dash.r} stroke="rgba(0,0,0,0.10)" strokeWidth="8" fill="none" />
          <circle
            cx="28"
            cy="28"
            r={dash.r}
            stroke="#18181b"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dash.c}
            strokeDashoffset={dash.offset}
            style={{
              transitionProperty: "stroke-dashoffset",
              transitionDuration: "450ms",
              transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
              transform: "rotate(-90deg)",
              transformOrigin: "28px 28px",
            }}
          />
        </svg>
        <span className="absolute font-mono tabular-nums text-[10px] font-semibold text-zinc-700">
          {Math.round(normalized * 100)}%
        </span>
      </button>
      <div
        id={tooltipId}
        className={`absolute right-0 top-16 z-20 w-[90vw] max-w-[420px] overflow-hidden rounded-xl border border-black/5 bg-white/90 px-3 py-2 text-xs leading-5 text-zinc-700 shadow-xl backdrop-blur-md transition-all duration-200 ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-1 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-zinc-900">期权授予排行榜</div>
          <div className="text-[11px] text-zinc-500">已授予股数 &gt; 0</div>
        </div>
        {leaderboard.length === 0 ? (
          <div className="mt-2 rounded-lg bg-[#f8fafc] px-3 py-2 text-zinc-500 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            暂无数据
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-black/5 bg-white">
            <div className="grid grid-cols-[56px_1fr_110px_110px] bg-[#f8fafc] px-3 py-2 text-[11px] font-medium text-zinc-600">
              <div>排名</div>
              <div>员工（部门）</div>
              <div className="text-right">已授予</div>
              <div className="text-right">估算价值</div>
            </div>
            <div className="max-h-[240px] overflow-auto">
              {leaderboard.map((row) => (
                <div
                  key={row.rank}
                  className="grid grid-cols-[56px_1fr_110px_110px] items-center px-3 py-2 text-zinc-700 transition-colors hover:bg-[#f8fafc]"
                >
                  <div className="text-zinc-500">#{row.rank}</div>
                  <div className="min-w-0 truncate text-zinc-900">{row.employee}</div>
                  <div className="text-right font-mono tabular-nums text-zinc-900">{row.shares}</div>
                  <div className="text-right font-mono tabular-nums text-zinc-900">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
