"use client"

import { createContext, useContext } from "react"
import type { RefreshOutcome } from "@/lib/mantencion/client/catalog-sync"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { DeviceAccount, QueueItem, StoredCatalog } from "@/lib/mantencion/client/types"

/** Lo que cualquier pantalla de la app necesita saber del teléfono. */
export interface AppData {
  deviceId: string
  appVersion: string
  account: DeviceAccount
  accounts: DeviceAccount[]
  stored: StoredCatalog | null
  rows: FleetRow[]
  queue: QueueItem[]
  online: boolean
  /** Epoch ms, se refresca cada minuto (para «hoy 14:05» y los avisos de 24 h). */
  now: number
}

export interface AppActions {
  /** Pide una pasada de envío ya (al guardar un registro, al volver la señal…). */
  syncNow(): void
  refreshCatalog(): Promise<RefreshOutcome>
  toast(message: string): void
}

const DataContext = createContext<AppData | null>(null)
const ActionsContext = createContext<AppActions | null>(null)

export const AppDataProvider = DataContext.Provider
export const AppActionsProvider = ActionsContext.Provider

export function useAppData(): AppData {
  const value = useContext(DataContext)
  if (!value) throw new Error("useAppData fuera de la app")
  return value
}

export function useAppActions(): AppActions {
  const value = useContext(ActionsContext)
  if (!value) throw new Error("useAppActions fuera de la app")
  return value
}
