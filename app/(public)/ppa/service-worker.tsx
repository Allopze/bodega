"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/ppa-sw.js", { scope: "/ppa" })
      .catch(() => {
        // SW registration is best-effort — the app still works without it
      });
  }, []);

  return null;
}
