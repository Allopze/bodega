"use client"

import { startTransition, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  GPS_LIVE_ENDPOINT,
  GPS_LIVE_INTERVAL_MS,
  type GpsLiveResponse,
  type GpsLiveResult,
} from "@/lib/integrations/onway/onway-live-contract"

export type GpsLiveStatus =
  | { kind: "ok" }
  | { kind: "disabled"; reason: "credentials" | "sync_disabled" | "module" }
  | { kind: "failed"; code: string }

export type GpsLiveProvider = keyof GpsLiveResponse

export type GpsLiveStatusByProvider = Record<GpsLiveProvider, GpsLiveStatus>

const PROVIDERS: readonly GpsLiveProvider[] = ["onway", "wialon"]

const ALL_OK: GpsLiveStatusByProvider = { onway: { kind: "ok" }, wialon: { kind: "ok" } }

function statusOf(result: GpsLiveResult | undefined): GpsLiveStatus {
  if (result?.outcome === "failed") return { kind: "failed", code: result.code }
  if (result?.outcome === "disabled") return { kind: "disabled", reason: result.reason }
  return { kind: "ok" }
}

function asResponse(body: unknown): GpsLiveResponse | null {
  if (body === null || typeof body !== "object") return null
  const record = body as Partial<GpsLiveResponse>
  return record.onway && record.wialon ? record as GpsLiveResponse : null
}

/** Marca de captura de un desenlace, si trae una (una lectura nueva o una ya hecha por otro). */
function observedAtOf(result: GpsLiveResult | undefined): string | null {
  if (result?.outcome === "synced") return result.observedAt
  if (result?.outcome === "skipped") return result.observedAt ?? null
  return null
}

/**
 * Mientras Monitoreo GPS está montada y visible, pide al servidor una lectura
 * cada 10 s y recarga los datos de la página (`router.refresh`, que conserva el
 * estado del cliente: el mapa no se rearma). El servidor decide por proveedor
 * si de verdad consulta: Wialon cada ~9 s, OnWay una vez por minuto.
 *
 * - Sale de la página → se cancela todo. Es la única fuente de estas lecturas.
 * - Pestaña oculta → no pide nada; al volver, si ya pasó el intervalo, pide al tiro.
 * - Nunca hay dos pedidos en vuelo: una lectura lenta no se apila con la siguiente.
 * - Sólo se recarga cuando algún proveedor trae una captura que esta página no
 *   había visto: una lectura propia, o una que otra persona o el cron ya hizo
 *   (el servidor devuelve su marca de captura aunque se haya saltado la suya).
 *   Sin cambios no hay recarga cada 10 s.
 */
export function useGpsLiveRefresh(options: { intervalMs?: number; endpoint?: string } = {}) {
  const intervalMs = options.intervalMs ?? GPS_LIVE_INTERVAL_MS
  const endpoint = options.endpoint ?? GPS_LIVE_ENDPOINT
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<GpsLiveStatusByProvider>(ALL_OK)

  useEffect(() => {
    let disposed = false
    let inFlight: AbortController | null = null
    let lastRunAt = 0
    // Última captura vista de cada proveedor. Hasta la primera respuesta no se
    // sabe qué mostraba el servidor al renderizar, y sólo una lectura propia
    // (`synced`) prueba que hay algo nuevo.
    const seen: Partial<Record<GpsLiveProvider, string>> = {}

    async function run() {
      if (disposed || inFlight || document.visibilityState !== "visible") return
      const controller = new AbortController()
      inFlight = controller
      lastRunAt = Date.now()
      setRefreshing(true)
      try {
        const response = await fetch(endpoint, { method: "POST", signal: controller.signal, cache: "no-store" })
        const body = asResponse(await response.json().catch(() => null))
        if (disposed) return
        if (!body) {
          setStatus(response.ok ? ALL_OK : { onway: { kind: "failed", code: `HTTP_${response.status}` }, wialon: { kind: "failed", code: `HTTP_${response.status}` } })
          return
        }
        setStatus({ onway: statusOf(body.onway), wialon: statusOf(body.wialon) })
        let changed = false
        for (const provider of PROVIDERS) {
          const result = body[provider]
          const observedAt = observedAtOf(result)
          if (!observedAt) continue
          const previous = seen[provider]
          if (previous !== observedAt && (previous !== undefined || result.outcome === "synced")) changed = true
          seen[provider] = observedAt
        }
        if (changed) startTransition(() => router.refresh())
      } catch {
        if (disposed || controller.signal.aborted) return
        const failed: GpsLiveStatus = { kind: "failed", code: "NETWORK" }
        setStatus({ onway: failed, wialon: failed })
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
