"use client"

import * as React from "react"
import { reportTaeHeartbeat } from "@/app/(public)/tae/tae-submitter"

export function TaePwaRegister() {
  // Aviso de apertura: cada carga de /tae le dice a TI que esta app está viva, con
  // qué versión y cuánto tiene sin enviar.
  React.useEffect(() => {
    void reportTaeHeartbeat(true)
  }, [])

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/tae-sw.js", { scope: "/tae" }).catch((error) => {
      console.warn("[TAE PWA] No se pudo registrar el service worker", error)
    })
  }, [])
  return null
}
