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
  // Falso positivo de React Doctor: los listeners se agregan cuando
  // `register()` resuelve, fuera del alcance que el analizador sigue, y el
  // cleanup de abajo libera los tres recursos (intervalo, `updatefound` y
  // `statechange`); `disposed` evita asignarlos si el efecto ya se desmontó.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    let checkInterval: ReturnType<typeof setInterval> | null = null
    // `register()` resolves asynchronously, so the effect can already be torn
    // down by the time the callback runs. Without this flag the interval and
    // the listener would be allocated after cleanup and never released.
    let disposed = false
    let registration: ServiceWorkerRegistration | null = null
    // El worker nuevo que se está observando. Su listener también se libera
    // en el cleanup: antes quedaba colgado del worker tras desmontar.
    let watchedWorker: ServiceWorker | null = null

    const onStateChange = () => {
      if (watchedWorker?.state === "activated") {
        // New SW is active — could show a "refresh" prompt
        console.log("[PWA] New service worker activated")
      }
    }

    const onUpdateFound = () => {
      const newWorker = registration?.installing
      if (!newWorker) return

      watchedWorker?.removeEventListener("statechange", onStateChange)
      watchedWorker = newWorker
      newWorker.addEventListener("statechange", onStateChange)
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
      watchedWorker?.removeEventListener("statechange", onStateChange)
      watchedWorker = null
      registration = null
    }
  }, [])

  return null
}
