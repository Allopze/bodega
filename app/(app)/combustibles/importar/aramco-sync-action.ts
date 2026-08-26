"use server"

import { revalidatePath } from "next/cache"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { fuelImportBatches, fuelProviderSyncRuns } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { civilDateRange } from "@/lib/validation/dates"
import { ARAMCO_SOURCES } from "@/lib/combustibles/fuel-sources"
import { syncAramco } from "@/lib/combustibles/aramco-sync"
import { AramcoTwoFactorRequiredError } from "@/lib/combustibles/aramco-client"
import {
  AramcoSettingsError,
  clearAramcoSettings,
  readAramcoAdminStatus,
  readAramcoConfig,
  saveAramcoSettings,
  type AramcoAdminStatus,
} from "@/lib/combustibles/aramco-settings"

const PAGE = "/combustibles/importar"
const SYNC_PERMISSION = "combustibles:sync_integrations"
const MANAGE_PERMISSION = "combustibles:manage_integrations"

/** Rango opcional para el barrido histórico manual. */
const rangeSchema = civilDateRange()

const settingsSchema = z.object({
  documentNumber: z.string().trim().max(20).optional(),
  // La clave del portal es numérica: se captura con teclado de dígitos.
  password: z.string().trim().regex(/^\d*$/, "La clave de Aramco es numérica").max(20).optional(),
  syncEnabled: z.boolean(),
})

export interface AramcoSyncStatus {
  /** Último lote de Aramco cargado, si hay alguno. */
  lastBatchAt: string | null
  lastPeriod: string | null
  batches: number
  lastRunAt: string | null
  lastRunStatus: string | null
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  affectedQuantity: number
  affectedAmount: number
  hasCredentials: boolean
  settings: AramcoAdminStatus
}

/**
 * Estado de la integración.
 *
 * A diferencia de Copec no hay fila de estado que leer: la sincronización de
 * Aramco no lleva cursor, así que «cuándo corrió» se deduce de los lotes que
 * dejó. Una fuente de verdad menos que mantener sincronizada.
 */
export async function getAramcoSyncStatusAction(): Promise<
  | { ok: true; data: AramcoSyncStatus }
  | { ok: false; message: string }
> {
  const guard = await guardPermission(SYNC_PERMISSION, PAGE)
  if (guard.error) return guard.error
  try {
    const [latest, latestRun, settings, config] = await Promise.all([
      db.query.fuelImportBatches.findFirst({
        where: and(inArray(fuelImportBatches.fuente, ARAMCO_SOURCES), eq(fuelImportBatches.estado, "importado")),
        orderBy: [desc(fuelImportBatches.createdAt)],
        columns: { createdAt: true, periodoDesde: true, periodoHasta: true },
      }),
      db.query.fuelProviderSyncRuns.findFirst({ where: eq(fuelProviderSyncRuns.provider, "aramco"), orderBy: [desc(fuelProviderSyncRuns.startedAt)] }),
      readAramcoAdminStatus(),
      readAramcoConfig(),
    ])
    const batches = await db.$count(
      fuelImportBatches,
      and(inArray(fuelImportBatches.fuente, ARAMCO_SOURCES), eq(fuelImportBatches.estado, "importado")),
    )
    return {
      ok: true,
      data: {
        lastBatchAt: latest?.createdAt ?? null,
        lastPeriod: latest ? `${latest.periodoDesde} a ${latest.periodoHasta}` : null,
        batches,
        lastRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? null,
        lastRunStatus: latestRun?.status ?? null,
        rowsReceived: latestRun?.rowsReceived ?? 0,
        rowsAccepted: latestRun?.rowsAccepted ?? 0,
        rowsRejected: latestRun?.rowsRejected ?? 0,
        rowsPending: latestRun?.rowsPending ?? 0,
        affectedQuantity: latestRun?.affectedQuantity ?? 0,
        affectedAmount: latestRun?.affectedAmount ?? 0,
        hasCredentials: config.hasCredentials,
        settings,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible obtener el estado de Aramco" }
  }
}

/** Dispara la misma función que el cron, con el operador autenticado. */
export async function runAramcoSyncAction(range: { from?: string; to?: string } = {}): Promise<
  | { ok: true; imported: number; refreshed: number; batches: number; transactions: number; rowsAccepted: number; rowsRejected: number; rowsPending: number; pendingPlates: string[]; from: string; to: string }
  | { ok: false; message: string }
> {
  const guard = await guardPermission(SYNC_PERMISSION, PAGE)
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = rangeSchema.safeParse(range)
    if (!parsed.success) return { ok: false, message: "El rango de fechas no es válido" }

    // El importador configurado queda reservado para el cron, que no tiene
    // sesión de usuario.
    const result = await syncAramco({ ...parsed.data, importerId: session.user.id })
    revalidatePath(PAGE)
    return {
      ok: true,
      imported: result.imported,
      refreshed: result.refreshed,
      batches: result.batches,
      transactions: result.transactions,
      rowsAccepted: result.rowsAccepted,
      rowsRejected: result.rowsRejected,
      rowsPending: result.rowsPending,
      pendingPlates: result.pendingPlates,
      from: result.from,
      to: result.to,
    }
  } catch (error) {
    if (error instanceof AramcoTwoFactorRequiredError) return { ok: false, message: error.message }
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible sincronizar Aramco" }
  }
}

/**
 * Guarda credenciales. Mismo permiso que la pantalla: quien puede disparar la
 * sincronización es quien tiene que poder arreglarla cuando el portal rechaza
 * las credenciales. El secreto viaja del navegador al servidor y no vuelve.
 */
export async function saveAramcoSettingsAction(input: {
  documentNumber?: string
  password?: string
  syncEnabled: boolean
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const guard = await guardPermission(MANAGE_PERMISSION, PAGE)
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Parámetros inválidos" }
  }

  try {
    await saveAramcoSettings(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(PAGE)

    // Activar la automatización sin credenciales usables no es un error de
    // guardado, pero sí una corrida fallida cada día. Se avisa acá en vez de
    // dejar que lo descubra el cron.
    const stored = await readAramcoConfig()
    const warning = parsed.data.syncEnabled && !stored.hasCredentials
      ? " Ojo: la automatización quedó activa pero faltan credenciales, así que el cron va a fallar."
      : ""
    return { ok: true, message: `Configuración de Aramco guardada.${warning}` }
  } catch (error) {
    if (error instanceof AramcoSettingsError && error.code === "ARAMCO_KEYRING_REQUIRED") {
      return {
        ok: false,
        message: "Este servidor no tiene el keyring de cifrado configurado, así que no puede guardar "
          + "credenciales. Configura DTE_SETTINGS_KEYRING y DTE_SETTINGS_ACTIVE_KEY_ID, o deja las de Aramco en el .env.",
      }
    }
    // Nunca se propaga el mensaje original: puede venir de la capa de cifrado.
    logger.error("[combustibles/saveAramcoSettings]", error)
    return { ok: false, message: "No fue posible guardar la configuración de Aramco" }
  }
}

/** Borra lo persistido y devuelve el mando al `.env` del servidor. */
export async function clearAramcoSettingsAction(): Promise<{ ok: true } | { ok: false; message: string }> {
  const guard = await guardPermission(MANAGE_PERMISSION, PAGE)
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await clearAramcoSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(PAGE)
    return { ok: true }
  } catch (error) {
    logger.error("[combustibles/clearAramcoSettings]", error)
    return { ok: false, message: "No fue posible restaurar la configuración de Aramco" }
  }
}
