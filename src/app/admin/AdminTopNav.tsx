import Link from "next/link";

export default function AdminTopNav({
  quickActionsTitle,
  quickActions,
  todoTitle,
  todoLines,
  tabs,
  variant = "full",
}: {
  quickActionsTitle: string;
  quickActions: Array<{ href: string; label: string }>;
  todoTitle: string;
  todoLines: Array<{ label: string; value: number; href?: string }>;
  tabs: Array<{ href: string; label: string; active: boolean }>;
  variant?: "full" | "navOnly" | "extrasOnly";
}) {
  const visibleTodoLines = todoLines
    .filter((x) => x.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value);
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.active));
  const indicatorWidth = tabs.length > 0 ? `calc((100% - 0.5rem) / ${tabs.length})` : "0px";

  return (
    <>
      {variant !== "extrasOnly" ? (
        <div className="rounded-2xl border border-black/5 bg-white/70 p-2 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md">
          <div className="px-1">
            <div className="rounded-xl border border-black/5 bg-white/70 p-1 backdrop-blur-md">
              <div className="relative flex min-w-0">
                <span
                  className="pointer-events-none absolute left-0 top-0 h-9 rounded-lg bg-zinc-900 shadow-sm transition-transform duration-300"
                  style={{ width: indicatorWidth, transform: `translateX(${activeIdx * 100}%)` }}
                />
                {tabs.map((it) => (
                  <Link
                    key={`${it.href}:${it.label}`}
                    href={it.href}
                    className={`btn-press relative z-10 inline-flex h-9 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg px-2 text-xs font-semibold sm:px-3 ${
                      it.active ? "text-white" : "text-zinc-700 hover:text-zinc-900"
                    }`}
                    scroll={false}
                  >
                    <span className="min-w-0 truncate">{it.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {variant !== "navOnly" && (quickActions.length > 0 || todoLines.length > 0) ? (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
          {quickActions.length > 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white/80 p-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-zinc-900">{quickActionsTitle}</div>
                <div className="text-[11px] text-zinc-500">常用</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
                {quickActions.map((it) => (
                  <Link
                    key={`${it.href}:${it.label}`}
                    href={it.href}
                    className="btn-press btn-ripple inline-flex h-12 touch-manipulation items-center justify-center rounded-2xl border border-black/5 bg-white/80 px-3 text-sm font-semibold text-zinc-900 active:scale-[0.98] sm:h-9 sm:rounded-xl sm:text-xs sm:font-medium sm:active:translate-y-[1px] sm:hover:bg-white"
                    scroll={false}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {todoLines.length > 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white/80 p-3 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-zinc-900">{todoTitle}</div>
                <div className="text-[11px] text-zinc-500">只显示待处理</div>
              </div>
              {visibleTodoLines.length === 0 ? (
                <div className="mt-2 rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-xs text-zinc-600">
                  暂无待办
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {visibleTodoLines.map((it) => {
                    const tone =
                      it.value >= 10
                        ? "border-rose-200 bg-rose-50 text-[#e11d48]"
                        : "border-amber-200 bg-amber-50 text-amber-800";
                    const content = (
                      <>
                        <span>{it.label}</span>{" "}
                        <span className="font-mono tabular-nums text-zinc-900">{it.value}</span>
                      </>
                    );

                    return it.href ? (
                      <Link
                        key={it.label}
                        href={it.href}
                        className={`btn-press inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:shadow-sm ${tone}`}
                        scroll={false}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span
                        key={it.label}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}
                      >
                        {content}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
