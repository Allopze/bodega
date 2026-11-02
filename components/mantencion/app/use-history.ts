"use client"

import { useEffect, useState } from "react"
import type { AppHistoryRecord } from "@/lib/mantencion/contracts"
import { subscribe } from "@/lib/mantencion/client/events"
import { getHistoryStatus, getPhotoBlob, loadStoredHistory } from "@/lib/mantencion/client/history-sync"
import { isOnline } from "@/lib/mantencion/client/signal"
import type { StoredHistory } from "@/lib/mantencion/client/types"
import { useAppData } from "./app-context"

export interface FleetHistoryState {
  /** Por `vehicleId`, del registro más reciente al más antiguo. `null` mientras no hay ninguna copia (primer arranque sin señal incluido). */
  byVehicle: Record<string, AppHistoryRecord[]> | null
  /** Cuándo la plataforma confirmó por última vez esta copia (ISO); `null` si no hay copia. */
  updatedAt: string | null
  refreshing: boolean
  /** El último refresco falló (sin señal o error): lo que se ve puede estar desactualizado. */
  failed: boolean
}

// Última copia leída por cuenta: la pantalla que se vuelve a abrir pinta al tiro y se corrige al leer IndexedDB.
const lastRead = new Map<string, StoredHistory | null>()

/**
 * Historial de mantenciones de toda la flota, de la cuenta activa. IndexedDB es
 * la fuente de verdad: se vuelve a leer cuando el refresco (en `useMantRuntime`)
 * avisa por el tema `history`. Este hook no dispara refrescos.
 */
export function useFleetHistory(): FleetHistoryState {
  const { account } = useAppData()
  const userId = account.userId
  const [read, setRead] = useState<{ userId: string; stored: StoredHistory | null } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => subscribe("history", () => setTick((n) => n + 1)), [])

  useEffect(() => {
    let cancelled = false
    void loadStoredHistory(userId).then((stored) => {
      lastRead.set(userId, stored)
      if (!cancelled) setRead({ userId, stored })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [userId, tick])

  // Mientras no se lee la de esta cuenta, la última conocida (nunca la de otra cuenta).
  const stored = read?.userId === userId ? read.stored : (lastRead.get(userId) ?? null)
  const { refreshing, failed } = getHistoryStatus(userId)
  return { byVehicle: stored?.data.byVehicle ?? null, updatedAt: stored?.fetchedAt ?? null, refreshing, failed }
}

export type PhotoState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "offline" }
  | { status: "error" }

/** La imagen de una foto del historial (de la caché o de la plataforma). Crea y revoca su object URL. */
export function useHistoryPhoto(photoId: string): PhotoState {
  const { account } = useAppData()
  const token = account.token
  const [loaded, setLoaded] = useState<{ photoId: string; state: PhotoState } | null>(null)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    getPhotoBlob({ token }, photoId).then((blob) => {
      if (cancelled) return
      if (!blob) {
        // Sin copia: o no hay señal (lo normal en faena) o la descarga falló con señal.
        setLoaded({ photoId, state: { status: isOnline() ? "error" : "offline" } })
        return
      }
      url = URL.createObjectURL(blob)
      setLoaded({ photoId, state: { status: "ready", url } })
    }).catch(() => { if (!cancelled) setLoaded({ photoId, state: { status: "error" } }) })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId, token])

  return loaded?.photoId === photoId ? loaded.state : { status: "loading" }
}
