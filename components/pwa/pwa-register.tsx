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

    navigator.serviceWorker
      .register(SW_URL, { scope: "/ppa" })
      .then((reg) => {
        // Check for updates periodically (every 60 minutes)
        const checkInterval = setInterval(() => {
          reg.update().catch(() => {})
        }, 60 * 60 * 1000)

        // Listen for new SW activation
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing
          if (!newWorker) return

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") {
              // New SW is active — could show a "refresh" prompt
              console.log("[PWA] New service worker activated")
            }
          })
        })

        return () => clearInterval(checkInterval)
      })
      .catch((err) => {
        console.warn("[PWA] SW registration failed:", err)
      })

    // P1-4: do NOT unregister the SW on unmount — the component unmounts
    // during normal React re-renders / route changes, which would destroy
    // the SW and break offline support.  The SW lifecycle is managed by
    // its own install/activate events.
    return
  }, [])

  return null
}
