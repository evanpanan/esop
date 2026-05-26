"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type EmployeeStatus = "ACTIVE" | "TERMINATED";

export default function EmployeePicker({
  name = "employeeId",
  employees,
  defaultEmployeeId,
  placeholder = "搜索员工（姓名/部门）",
}: {
  name?: string;
  employees: Array<{ id: string; name: string; department: string; status: EmployeeStatus }>;
  defaultEmployeeId?: string;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(() => {
    const v = String(defaultEmployeeId ?? "").trim();
    if (v) return v;
    return employees[0]?.id ?? "";
  });
  const [query, setQuery] = useState("");

  const selected = useMemo(() => employees.find((e) => e.id === selectedId) ?? null, [employees, selectedId]);

  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const st = selected.status === "ACTIVE" ? "在职" : "离职";
    return `${selected.name} · ${selected.department} · ${st}`;
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, 80);
    const out: typeof employees = [];
    for (const e of employees) {
      const st = e.status === "ACTIVE" ? "在职" : "离职";
      const hay = `${e.name} ${e.department} ${st}`.toLowerCase();
      if (hay.includes(q)) out.push(e);
      if (out.length >= 80) break;
    }
    return out;
  }, [employees, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      const t = e.target as HTMLElement | null;
      if (!root || !t) return;
      if (!root.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true as unknown as EventListenerOptions);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative" data-emp-picker>
      <select
        name={name}
        required
        value={selectedId}
        onChange={(e) => setSelectedId(String(e.target.value))}
        className="absolute left-0 top-0 h-0 w-0 overflow-hidden opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      >
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} · {e.department} · {e.status === "ACTIVE" ? "在职" : "离职"}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`min-w-0 truncate ${selectedLabel ? "text-zinc-900" : "text-zinc-500"}`}>
          {selectedLabel || placeholder}
        </span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-black/5 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <div className="border-b border-black/5 px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
              autoFocus
            />
            <div className="mt-1 text-[11px] text-zinc-500">最多显示 80 条，输入可缩小范围</div>
          </div>
          <div className="max-h-[320px] overflow-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-zinc-500">未找到匹配员工</div>
            ) : (
              filtered.map((e) => {
                const st = e.status === "ACTIVE" ? "在职" : "离职";
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      active ? "bg-[#f8fafc] text-zinc-900" : "text-zinc-800 hover:bg-[#f8fafc]"
                    }`}
                    onPointerDown={(ev) => {
                      ev.preventDefault();
                      setSelectedId(e.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    onTouchStart={(ev) => {
                      ev.preventDefault();
                      setSelectedId(e.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="min-w-0 truncate">
                      {e.name} · {e.department} · {st}
                    </span>
                    {active ? <span className="text-[11px] font-semibold text-zinc-500">已选</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

