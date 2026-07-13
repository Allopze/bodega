"use client"

import * as React from "react"

export function TaePwaRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/tae-sw.js", { scope: "/tae" }).catch((error) => {
      console.warn("[TAE PWA] No se pudo registrar el service worker", error)
    })
  }, [])
  return null
}
