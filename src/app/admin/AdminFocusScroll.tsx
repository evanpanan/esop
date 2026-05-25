"use client";

import { useEffect } from "react";

export default function AdminFocusScroll({ focus }: { focus: string }) {
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus]);

  return null;
}

