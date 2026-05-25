"use client";

import { useState } from "react";

type VestingType = "IMMEDIATE" | "CUSTOM_INSTALLMENTS";

export default function VestingConfigurator() {
  const [vestingType, setVestingType] = useState<VestingType>(
    "CUSTOM_INSTALLMENTS",
  );

  return (
    <div className="ui-card grid grid-cols-1 gap-3 p-4">
      <label className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
          <span>成熟机制</span>
          <span className="group relative inline-flex">
            <span
              tabIndex={0}
              role="img"
              aria-label="说明"
              title="说明"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/5 bg-white text-[10px] font-semibold text-zinc-700 outline-none group-focus-within:border-black/10"
            >
              i
            </span>
            <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-black/5 bg-white/90 px-2 py-1 text-[11px] leading-4 text-zinc-600 shadow-xl backdrop-blur-md group-hover:block group-focus-within:block">
              决定归属明细生成方式：立即成熟生成 1 条记录；自定义分期按“总时长/分期次数”生成多条。
            </span>
          </span>
        </span>
        <select
          name="vesting_type"
          value={vestingType}
          onChange={(e) => setVestingType(e.target.value as VestingType)}
          className="h-10 rounded-xl border border-black/5 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-black/10"
        >
          <option value="IMMEDIATE">立即成熟（100% 于授予日归属）</option>
          <option value="CUSTOM_INSTALLMENTS">自定义分期</option>
        </select>
      </label>

      {vestingType === "CUSTOM_INSTALLMENTS" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
              <span>总成熟时长（月）</span>
              <span className="group relative inline-flex">
                <span
                  tabIndex={0}
                  role="img"
                  aria-label="说明"
                  title="说明"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/5 bg-white text-[10px] font-semibold text-zinc-700 outline-none group-focus-within:border-black/10"
                >
                  i
                </span>
                <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-black/5 bg-white/90 px-2 py-1 text-[11px] leading-4 text-zinc-600 shadow-xl backdrop-blur-md group-hover:block group-focus-within:block">
                  授予日到最后一期的总月数，需能被分期次数整除。
                </span>
              </span>
            </span>
            <input
              name="total_vesting_duration"
              type="number"
              min={1}
              step={1}
              placeholder="48"
              className="h-10 rounded-xl border border-black/5 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-black/10"
              required
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
              <span>分期次数</span>
              <span className="group relative inline-flex">
                <span
                  tabIndex={0}
                  role="img"
                  aria-label="说明"
                  title="说明"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/5 bg-white text-[10px] font-semibold text-zinc-700 outline-none group-focus-within:border-black/10"
                >
                  i
                </span>
                <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-black/5 bg-white/90 px-2 py-1 text-[11px] leading-4 text-zinc-600 shadow-xl backdrop-blur-md group-hover:block group-focus-within:block">
                  归属次数；系统按等间隔月均分生成。
                </span>
              </span>
            </span>
            <input
              name="vesting_installments"
              type="number"
              min={1}
              step={1}
              placeholder="48"
              className="h-10 rounded-xl border border-black/5 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-black/10"
              required
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
