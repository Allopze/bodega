"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

/** Misma sección dentro de este plazo: no hace falta avisar otra vez (el servidor igual deduplica). */
const RESEND_AFTER_MS = 5 * 60_000
const STORAGE_KEY = "chome.app-visit.sent"

/** `/combustibles/cargas/123` → `/combustibles/cargas`: basta para separar apps que comparten prefijo. */
function sectionOf(pathname: string): string {
  return `/${pathname.split("/").filter(Boolean).slice(0, 2).join("/")}`
}

function readSent(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>
  } catch {
    return {}
  }
}

/**
 * Avisa al servidor cada vez que la persona entra a una sección, para las
 * visitas por app de TI › Apps y las «Recientes» del lanzador. No pinta nada y
 * un fallo no se muestra: medir el uso no puede estorbar la navegación.
 */
export function AppVisitTracker() {
  const pathname = usePathname()

  React.useEffect(() => {
    if (!pathname) return
    const section = sectionOf(pathname)
    const sent = readSent()
    const now = Date.now()
    if (sent[section] && now - sent[section] < RESEND_AFTER_MS) return
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...sent, [section]: now }))
    } catch {
      // Sin almacenamiento de sesión se envía igual; el servidor deduplica.
    }
    void fetch("/api/apps/visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])

  return null
}
