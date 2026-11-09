"use client"

import { startTransition, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ONWAY_LIVE_ENDPOINT, ONWAY_LIVE_INTERVAL_MS, type OnwayLiveResult } from "@/lib/integrations/onway/onway-live-contract"

export type OnwayLiveStatus =
  | { kind: "ok" }
  | { kind: "disabled" }
  | { kind: "failed"; code: string }

function statusFrom(response: Response, body: OnwayLiveResult | null): OnwayLiveStatus {
  if (body?.outcome === "failed") return { kind: "failed", code: body.code }
  if (body?.outcome === "disabled") return { kind: "disabled" }
  if (!response.ok) return { kind: "failed", code: `HTTP_${response.status}` }
  return { kind: "ok" }
}

/**
 * Mientras Monitoreo GPS está montada y visible, pide al servidor una lectura
 * de OnWay cada minuto y recarga los datos de la página (`router.refresh`, que
 * conserva el estado del cliente: el mapa no se rearma).
 *
 * - Sale de la página → se cancela todo. Es la única fuente de estas lecturas.
 * - Pestaña oculta → no pide nada; al volver, si ya pasó el minuto, pide al tiro.
 * - Nunca hay dos pedidos en vuelo: una lectura lenta no se apila con la siguiente.
 */
export function useOnwayLiveRefresh(options: { intervalMs?: number; endpoint?: string } = {}) {
  const intervalMs = options.intervalMs ?? ONWAY_LIVE_INTERVAL_MS
  const endpoint = options.endpoint ?? ONWAY_LIVE_ENDPOINT
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<OnwayLiveStatus>({ kind: "ok" })

  useEffect(() => {
    let disposed = false
    let inFlight: AbortController | null = null
    let lastRunAt = 0

    async function run() {
      if (disposed || inFlight || document.visibilityState !== "visible") return
      const controller = new AbortController()
      inFlight = controller
      lastRunAt = Date.now()
      setRefreshing(true)
      try {
        const response = await fetch(endpoint, { method: "POST", signal: controller.signal, cache: "no-store" })
        const body = await response.json().catch(() => null) as OnwayLiveResult | null
        if (disposed) return
        setStatus(statusFrom(response, body))
        // Aunque esta lectura se haya saltado, el cron u otra persona pudo traer datos nuevos.
        startTransition(() => router.refresh())
      } catch {
        if (disposed || controller.signal.aborted) return
        setStatus({ kind: "failed", code: "NETWORK" })
      } finally {
        if (inFlight === controller) inFlight = null
        if (!disposed) setRefreshing(false)
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt >= intervalMs) void run()
    }

    void run()
    const timer = setInterval(() => { void run() }, intervalMs)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      disposed = true
      clearInterval(timer)
      inFlight?.abort()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [endpoint, intervalMs, router])

  return { refreshing, status }
}
