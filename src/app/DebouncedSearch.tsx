"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useRef } from "react";

export function DebouncedSearch({
  defaultValue,
  placeholder,
  className,
  forceParams,
}: {
  defaultValue: string;
  placeholder: string;
  className: string;
  forceParams?: Record<string, string | null | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const timerRef = useRef<number | null>(null);

  const schedule = (next: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      startTransition(() => {
        const p = new URLSearchParams(searchParams.toString());
        if (next) p.set("q", next);
        else p.delete("q");
        if (forceParams) {
          for (const [k, v] of Object.entries(forceParams)) {
            if (!v) p.delete(k);
            else p.set(k, v);
          }
        }
        router.push(`${pathname}?${p.toString()}`, { scroll: false });
      });
    }, 400);
  };

  return (
    <div className="relative flex-1 min-w-0">
      <input
        name="q"
        type="search"
        key={defaultValue}
        defaultValue={defaultValue}
        onChange={(e) => schedule(e.target.value)}
        onInput={(e) => schedule((e.target as HTMLInputElement).value)}
        className={className}
        placeholder={placeholder}
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-zinc-200 border-t-zinc-600 animate-spin" />
      )}
    </div>
  );
}
