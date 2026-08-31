"use client"

/**
 * components/pwa/pwa-register.tsx
 *
 * Registers the service worker and updates it when a new version is available.
 * Place this in the layout for routes that need offline support (e.g. /ppa).
 */

import * as React from "react"

const SW_URL = "/sw.js"

export function PwaRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    let checkInterval: ReturnType<typeof setInterval> | null = null
    // `register()` resolves asynchronously, so the effect can already be torn
    // down by the time the callback runs. Without this flag the interval and
    // the listener would be allocated after cleanup and never released.
    let disposed = false
    let registration: ServiceWorkerRegistration | null = null

    const onUpdateFound = () => {
      const newWorker = registration?.installing
      if (!newWorker) return

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "activated") {
          // New SW is active — could show a "refresh" prompt
          console.log("[PWA] New service worker activated")
        }
      })
    }

    navigator.serviceWorker
      .register(SW_URL, { scope: "/ppa" })
      .then((reg) => {
        if (disposed) return
        registration = reg

        // Check for updates periodically (every 60 minutes)
        checkInterval = setInterval(() => {
          reg.update().catch(() => {})
        }, 60 * 60 * 1000)

        // Listen for new SW activation
        reg.addEventListener("updatefound", onUpdateFound)
      })
      .catch((err) => {
        console.warn("[PWA] SW registration failed:", err)
      })

    return () => {
      disposed = true
      if (checkInterval !== null) clearInterval(checkInterval)
      registration?.removeEventListener("updatefound", onUpdateFound)
      registration = null
    }
  }, [])

  return null
}
