export function safeMeReturnTo(raw: string) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("/me")) return null;
  return v;
}

export function meUrlWith(path: string, updates: Record<string, string | null | undefined>) {
  const u = new URL(path, "http://local");
  for (const [k, v] of Object.entries(updates)) {
    if (!v) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}
