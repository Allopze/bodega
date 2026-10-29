"use client"

import { useEffect, useMemo, useState } from "react"
import { getAccount, listAccounts } from "@/lib/mantencion/client/accounts"
import { loadStoredCatalog } from "@/lib/mantencion/client/catalog-sync"
import { subscribe, type MantTopic } from "@/lib/mantencion/client/events"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { listQueue } from "@/lib/mantencion/client/queue"
import { isOnline } from "@/lib/mantencion/client/signal"
import type { DeviceAccount, QueueItem, StoredCatalog } from "@/lib/mantencion/client/types"
import type { AppData } from "./app-context"

const TOPICS: MantTopic[] = ["queue", "accounts", "catalog", "signal", "drafts"]

interface Loaded {
  userId: string
  account: DeviceAccount
  accounts: DeviceAccount[]
  stored: StoredCatalog | null
  queue: QueueItem[]
}

/**
 * Lee de IndexedDB lo que la app muestra y se vuelve a leer cuando algo avisa
 * (cola, cuentas, catálogo, señal). IndexedDB es la única fuente de verdad: una
 * pantalla nunca guarda una copia propia de la cola.
 */
export function useDeviceData(activeUserId: string | null, base: { deviceId: string; appVersion: string } | null): AppData | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const offs = TOPICS.map((topic) => subscribe(topic, () => setTick((n) => n + 1)))
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => { offs.forEach((off) => off()); clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!activeUserId) return
    let cancelled = false
    void (async () => {
      const [account, accounts, stored, queue] = await Promise.all([getAccount(activeUserId), listAccounts(), loadStoredCatalog(activeUserId), listQueue()])
      if (!cancelled && account) setLoaded({ userId: activeUserId, account, accounts, stored, queue })
    })().catch(() => {})
    return () => { cancelled = true }
  }, [activeUserId, tick])

  // El catálogo y la cola son del equipo entero (lecturas pendientes de cualquier cuenta cuentan), pero lo que se muestra es de la cuenta activa.
  const rows = useMemo(() => (loaded ? buildRows(loaded.stored, loaded.queue) : []), [loaded])

  return useMemo(() => {
    if (!loaded || !base || loaded.userId !== activeUserId) return null
    return { deviceId: base.deviceId, appVersion: base.appVersion, account: loaded.account, accounts: loaded.accounts, stored: loaded.stored, rows, queue: loaded.queue, online: isOnline(), now }
  // `tick` fuerza releer `isOnline()` (es estado de módulo, no de React).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, base, rows, now, activeUserId, tick])
}
