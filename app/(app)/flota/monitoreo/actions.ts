"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { fleetGpsDeviceLinks, fleetGpsLatestPositions, fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { nanoid } from "@/lib/id"
import { OnwayClientError, type OnwayClientErrorCode } from "@/lib/integrations/onway/onway-client"
import {
  clearOnwaySettings,
  OnwaySettingsError,
  readOnwayConfig,
  saveOnwaySettings,
} from "@/lib/integrations/onway/onway-settings"
import { syncOnway } from "@/lib/integrations/onway/onway-sync"
import {
  normalizeWialonBaseUrl,
  verifyWialonCredentials,
  WialonClientError,
} from "@/lib/integrations/wialon/wialon-client"
import {
  clearWialonSettings,
  loadWialonConfig,
  saveWialonSettings,
  WialonSettingsError,
} from "@/lib/integrations/wialon/wialon-settings"
import { syncWialon, WialonSyncError } from "@/lib/integrations/wialon/wialon-sync"
import { EncryptedSettingsError } from "@/lib/services/encrypted-settings"
import { withCronLock } from "@/lib/services/cron-lock"
import type { GpsProvider } from "@/lib/services/fleet-gps"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import type { ActionState } from "@/lib/validation/masters"

const settingsSchema = z.object({
  username: z.string().max(320, "El usuario es demasiado largo").optional(),
  password: z.string().max(320, "La contraseña es demasiado larga").optional(),
  syncEnabled: z.boolean(),
})

const ERROR_MESSAGE: Record<OnwayClientErrorCode, string> = {
  ONWAY_CREDENTIALS_REQUIRED: "Configura las credenciales de OnWay antes de sincronizar.",
  ONWAY_CREDENTIALS_INVALID: "Las credenciales configuradas no son válidas.",
  ONWAY_AUTH_REJECTED: "OnWay rechazó el usuario o la contraseña.",
  ONWAY_INTERACTIVE_AUTH_REQUIRED: "OnWay exige una verificación interactiva. Ingresa al portal una vez y vuelve a intentar más tarde.",
  ONWAY_PORTAL_TIMEOUT: "OnWay no respondió dentro del tiempo esperado.",
  ONWAY_RESPONSE_INVALID: "OnWay respondió con un formato no reconocido.",
  ONWAY_SNAPSHOT_EMPTY: "OnWay aceptó la cuenta, pero no devolvió ningún equipo. Revisa que la cuenta configurada tenga la flota asignada en el portal.",
  ONWAY_SYNC_FAILED: "No se pudo actualizar el monitoreo GPS.",
}

async function requireGpsManager(): Promise<Awaited<ReturnType<typeof requirePermission>> | null> {
  try { return await requirePermission("flota:manage_gps") }
  catch { return null }
}

const GPS_PROVIDER_LABEL: Record<GpsProvider, string> = { onway: "OnWay", wialon: "Wialon" }

function isGpsProvider(value: unknown): value is GpsProvider {
  return value === "onway" || value === "wialon"
}

/**
 * Vínculo guardado de un dispositivo con la faena del vehículo al que apunta.
 * `null` significa que no hay link: el dispositivo puede estar resuelto por
 * patente, VIN o código en la última posición, pero no hay una asociación
 * guardada que desvincular ni que pisar.
 */
async function findDeviceLink(provider: GpsProvider, unitId: string) {
  const [link] = await db.select({
    status: fleetGpsDeviceLinks.status,
    vehicleId: fleetGpsDeviceLinks.vehicleId,
    reason: fleetGpsDeviceLinks.reason,
    worksiteId: fuelVehicles.worksiteId,
  })
    .from(fleetGpsDeviceLinks)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsDeviceLinks.vehicleId))
    .where(and(
      eq(fleetGpsDeviceLinks.provider, provider),
      eq(fleetGpsDeviceLinks.externalDeviceId, unitId),
    ))
    .limit(1)
  return link ?? null
}

async function findLatestPosition(provider: GpsProvider, unitId: string) {
  const [position] = await db.select({
    id: fleetGpsLatestPositions.id,
    vehicleId: fleetGpsLatestPositions.vehicleId,
    worksiteId: fleetGpsLatestPositions.worksiteId,
    name: fleetGpsLatestPositions.sourcePlate,
  })
    .from(fleetGpsLatestPositions)
    .where(and(
      eq(fleetGpsLatestPositions.provider, provider),
      eq(fleetGpsLatestPositions.externalDeviceId, unitId),
    ))
    .limit(1)
  return position ?? null
}

/**
 * Faena de la asociación vigente de un dispositivo: primero el vínculo manual y,
 * si no hay, la última posición ya resuelta por identidad. Así una persona con
 * alcance limitado no puede pisar, excluir ni borrar la asociación de otra faena.
 */
function currentWorksiteOf(
  link: Awaited<ReturnType<typeof findDeviceLink>>,
  position: Awaited<ReturnType<typeof findLatestPosition>>,
): string | null {
  return (link?.status === "linked" ? link.worksiteId : null) ?? position?.worksiteId ?? null
}

export async function runOnwaySyncAction(): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para sincronizar el monitoreo GPS" }

  try {
    const result = await syncOnway({ trigger: "manual", actorUserId: session.user.id })
    revalidatePath("/flota/monitoreo")
    const detail = result.unmatched > 0
      ? ` ${result.unmatched} patente${result.unmatched === 1 ? "" : "s"} no coincide${result.unmatched === 1 ? "" : "n"} con el catálogo de Flota.`
      : ""
    const rejected = result.rejected > 0
      ? ` ${result.rejected} registro${result.rejected === 1 ? " fue" : "s fueron"} rechazado${result.rejected === 1 ? "" : "s"}.`
      : ""
    const warnings = result.warnings.length > 0 ? ` Se omitieron temporalmente: ${result.warnings.join(", ")}.` : ""
    const partial = result.unmatched > 0 || result.rejected > 0 || result.warnings.length > 0
    return { ok: true, message: `${partial ? "Sincronización parcial. " : ""}${result.matched} vehículo${result.matched === 1 ? "" : "s"} actualizado${result.matched === 1 ? "" : "s"}.${detail}${rejected}${warnings}` }
  } catch (error) {
    const code = error instanceof OnwayClientError ? error.code : "ONWAY_SYNC_FAILED"
    logger.error("[flota/onway/manual-sync]", { code })
    return { ok: false, message: ERROR_MESSAGE[code] }
  }
}

export async function saveOnwaySettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para configurar el monitoreo GPS" }

  const usernameValue = formData.get("username")
  const passwordValue = formData.get("password")
  const parsed = settingsSchema.safeParse({
    username: typeof usernameValue === "string" ? usernameValue.trim() : undefined,
    password: typeof passwordValue === "string" ? passwordValue : undefined,
    syncEnabled: formData.get("syncEnabled") === "on",
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Configuración inválida" }

  try {
    await saveOnwaySettings(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/flota/monitoreo")
    const stored = await readOnwayConfig()
    const warning = parsed.data.syncEnabled && !stored.hasCredentials
      ? " La automatización quedó activa, pero aún faltan credenciales."
      : ""
    return { ok: true, message: `Configuración de OnWay guardada.${warning}` }
  } catch (error) {
    if (error instanceof OnwaySettingsError) {
      return {
        ok: false,
        message: "Este servidor no tiene keyring de cifrado. Configura DTE_SETTINGS_KEYRING y DTE_SETTINGS_ACTIVE_KEY_ID, o usa variables de entorno.",
      }
    }
    logger.error("[flota/onway/save-settings]", { code: "ONWAY_SETTINGS_SAVE_FAILED" })
    return { ok: false, message: "No se pudo guardar la configuración de OnWay" }
  }
}

export async function clearOnwaySettingsAction(): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para configurar el monitoreo GPS" }

  try {
    await clearOnwaySettings({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/flota/monitoreo")
    return { ok: true, message: "Se restauró la configuración del servidor" }
  } catch {
    logger.error("[flota/onway/clear-settings]", { code: "ONWAY_SETTINGS_CLEAR_FAILED" })
    return { ok: false, message: "No se pudo restaurar la configuración de OnWay" }
  }
}

/* ── Wialon ──────────────────────────────────────────────────────────────── */

const WIALON_ERROR_MESSAGE: Record<string, string> = {
  WIALON_CREDENTIALS_REQUIRED: "Configura el token de Wialon antes de sincronizar.",
  WIALON_AUTH_FAILED: "Wialon rechazó el token. Revisa que esté activo y tenga permiso para leer unidades.",
  WIALON_ACCESS_DENIED: "El token de Wialon no tiene permiso para leer las unidades de esta cuenta.",
  WIALON_SESSION_EXPIRED: "La sesión de Wialon expiró. Vuelve a intentarlo.",
  WIALON_RATE_LIMITED: "Wialon limitó las consultas. Espera unos minutos e inténtalo de nuevo.",
  WIALON_TIMEOUT: "Wialon no respondió dentro del tiempo esperado.",
  WIALON_BAD_RESPONSE: "Wialon respondió con un formato no reconocido.",
  WIALON_INVALID_BASE_URL: "La URL de Wialon no es válida: debe ser https y no incluir credenciales, query ni hash.",
  WIALON_SNAPSHOT_EMPTY: "Wialon aceptó la conexión pero no devolvió unidades. Revisa los permisos del token y la cuenta.",
  WIALON_NO_POSITIONS: "Wialon devolvió unidades sin una posición válida en su último mensaje.",
  WIALON_SYNC_FAILED: "No se pudo actualizar Wialon.",
}

function wialonFailureMessage(error: unknown): string {
  const code = error instanceof WialonClientError || error instanceof WialonSyncError
    ? error.code
    : "WIALON_SYNC_FAILED"
  return WIALON_ERROR_MESSAGE[code] ?? "No se pudo actualizar Wialon."
}

const wialonSettingsSchema = z.object({
  baseUrl: z.string().trim().max(300, "La URL es demasiado larga").optional(),
  token: z.string().trim().max(4096, "El token es demasiado largo").optional(),
  syncEnabled: z.boolean(),
  odometerParam: z.string().trim().max(100, "El parámetro es demasiado largo").optional(),
  hourMeterParam: z.string().trim().max(100, "El parámetro es demasiado largo").optional(),
  fuelLevelParam: z.string().trim().max(100, "El parámetro es demasiado largo").optional(),
  clearToken: z.boolean(),
})

export async function runWialonSyncAction(): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para sincronizar el monitoreo GPS" }

  const limit = await consumeFixedWindowLimit(`wialon-manual:${session.user.id}`, {
    maxAttempts: 3,
    lockMs: 60_000,
  })
  if (!limit.allowed) return { ok: false, message: "Actualizaste Wialon demasiadas veces seguidas. Espera un minuto." }

  try {
    const result = await withCronLock("fleet-wialon-sync", () => syncWialon({ trigger: "manual", actorUserId: session.user.id }))
    if ("skipped" in result) {
      return { ok: false, message: "Ya hay una sincronización de Wialon en curso. Espera a que termine." }
    }
    revalidatePath("/flota/monitoreo")
    const incomplete = result.warnings.length > 0
    const detail = result.unmatched + result.ambiguous > 0
      ? ` ${result.unmatched + result.ambiguous} unidad${result.unmatched + result.ambiguous === 1 ? "" : "es"} sin vincular.`
      : ""
    return {
      ok: true,
      message: `${incomplete ? "Sincronización parcial. " : ""}${result.matched} equipo${result.matched === 1 ? "" : "s"} actualizado${result.matched === 1 ? "" : "s"}.${detail}`,
    }
  } catch (error) {
    logger.error("[flota/wialon/manual-sync]", { code: error instanceof WialonClientError || error instanceof WialonSyncError ? error.code : "UNKNOWN" })
    return { ok: false, message: wialonFailureMessage(error) }
  }
}

export async function saveWialonSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para configurar el monitoreo GPS" }

  const parsed = wialonSettingsSchema.safeParse({
    baseUrl: typeof formData.get("baseUrl") === "string" ? String(formData.get("baseUrl")).trim() : undefined,
    token: typeof formData.get("token") === "string" ? String(formData.get("token")).trim() : undefined,
    syncEnabled: formData.get("syncEnabled") === "on",
    odometerParam: typeof formData.get("odometerParam") === "string" ? String(formData.get("odometerParam")).trim() : undefined,
    hourMeterParam: typeof formData.get("hourMeterParam") === "string" ? String(formData.get("hourMeterParam")).trim() : undefined,
    fuelLevelParam: typeof formData.get("fuelLevelParam") === "string" ? String(formData.get("fuelLevelParam")).trim() : undefined,
    clearToken: formData.get("clearToken") === "on",
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Configuración inválida" }
  if (parsed.data.token && parsed.data.clearToken) {
    return { ok: false, message: "No se puede guardar un token nuevo y borrar el guardado a la vez." }
  }

  try {
    if (parsed.data.baseUrl) normalizeWialonBaseUrl(parsed.data.baseUrl)
    await saveWialonSettings(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/flota/monitoreo")
    const stored = await loadWialonConfig()
    const warning = stored.syncEnabled && !stored.hasCredentials
      ? " La actualización automática quedó activa, pero aún falta el token."
      : ""
    return { ok: true, message: `Configuración de Wialon guardada.${warning}` }
  } catch (error) {
    if (error instanceof WialonClientError && error.code === "WIALON_INVALID_BASE_URL") {
      return { ok: false, message: WIALON_ERROR_MESSAGE.WIALON_INVALID_BASE_URL }
    }
    if (error instanceof WialonSettingsError) {
      return { ok: false, message: "Al cambiar la URL de Wialon debes volver a ingresar el token." }
    }
    if (error instanceof EncryptedSettingsError) {
      return {
        ok: false,
        message: "Este servidor no tiene keyring de cifrado. Configura DTE_SETTINGS_KEYRING y DTE_SETTINGS_ACTIVE_KEY_ID, o usa WIALON_TOKEN en el entorno.",
      }
    }
    logger.error("[flota/wialon/save-settings]", { code: error instanceof WialonClientError || error instanceof WialonSettingsError ? error.code : "UNKNOWN" })
    return { ok: false, message: "No se pudo guardar la configuración de Wialon" }
  }
}

export async function clearWialonSettingsAction(): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para configurar el monitoreo GPS" }

  try {
    await clearWialonSettings({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/flota/monitoreo")
    return { ok: true, message: "Se restauró la configuración de Wialon del servidor" }
  } catch {
    logger.error("[flota/wialon/clear-settings]", { code: "WIALON_SETTINGS_CLEAR_FAILED" })
    return { ok: false, message: "No se pudo restaurar la configuración de Wialon" }
  }
}

export async function testWialonConnectionAction(): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para probar la conexión de Wialon" }

  const limit = await consumeFixedWindowLimit(`wialon-test:${session.user.id}`, {
    maxAttempts: 3,
    lockMs: 10 * 60_000,
  })
  if (!limit.allowed) return { ok: false, message: "Probaste la conexión demasiadas veces seguidas. Espera unos minutos." }

  try {
    const config = await loadWialonConfig()
    if (!config.hasCredentials) {
      return { ok: false, message: "Falta el token: guárdalo antes de probar la conexión." }
    }
    await verifyWialonCredentials({ baseUrl: config.baseUrl, token: config.token })
    return { ok: true, message: "Conexión correcta: Wialon aceptó el token." }
  } catch (error) {
    logger.warn("[flota/wialon/test-connection]", {
      code: error instanceof WialonClientError || error instanceof WialonSyncError ? error.code : "UNKNOWN",
    })
    return { ok: false, message: wialonFailureMessage(error) }
  }
}

export async function linkGpsDeviceAction(input: {
  provider: GpsProvider
  unitId: string
  vehicleId: string
}): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para vincular dispositivos GPS" }
  if (!isGpsProvider(input.provider)) return { ok: false, message: "Proveedor GPS no reconocido." }
  if (!input.unitId.trim() || !input.vehicleId.trim()) {
    return { ok: false, message: "Selecciona un dispositivo y un vehículo." }
  }
  const { provider } = input
  const label = GPS_PROVIDER_LABEL[provider]

  const unit = await findLatestPosition(provider, input.unitId)
  if (!unit) return { ok: false, message: `El dispositivo de ${label} ya no está en la última lectura. Actualiza ${label} e inténtalo de nuevo.` }

  const [vehicle] = await db.select({
    id: fuelVehicles.id,
    plate: fuelVehicles.plate,
    worksiteId: fuelVehicles.worksiteId,
  }).from(fuelVehicles).where(eq(fuelVehicles.id, input.vehicleId)).limit(1)
  if (!vehicle) return { ok: false, message: "El vehículo seleccionado no existe." }
  if (!canAccessWorksite(session, vehicle.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de ese vehículo." }
  }

  // El dispositivo puede estar vinculado a un vehículo de otra faena. Cambiar el
  // vínculo sin acceso a la faena actual sería reasociar un activo ajeno.
  const currentWorksite = currentWorksiteOf(await findDeviceLink(provider, input.unitId), unit)
  if (currentWorksite && !canAccessWorksite(session, currentWorksite)) {
    return { ok: false, message: "No tienes acceso a la faena del vehículo al que está asociado el dispositivo." }
  }

  const [otherLink] = await db.select({ unitId: fleetGpsDeviceLinks.externalDeviceId })
    .from(fleetGpsDeviceLinks)
    .where(and(
      eq(fleetGpsDeviceLinks.provider, provider),
      eq(fleetGpsDeviceLinks.vehicleId, vehicle.id),
      ne(fleetGpsDeviceLinks.externalDeviceId, input.unitId),
    ))
    .limit(1)

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.insert(fleetGpsDeviceLinks).values({
      id: `gpslink-${nanoid()}`,
      provider,
      externalDeviceId: input.unitId,
      status: "linked",
      vehicleId: vehicle.id,
      createdByUserId: session.user.id,
      updatedAt,
    }).onConflictDoUpdate({
      target: [fleetGpsDeviceLinks.provider, fleetGpsDeviceLinks.externalDeviceId],
      // Vincular un dispositivo excluido lo devuelve a la flota: el motivo de la exclusión ya no aplica.
      set: { status: "linked", vehicleId: vehicle.id, reason: null, createdByUserId: session.user.id, updatedAt },
    })
    await tx.update(fleetGpsLatestPositions).set({
      vehicleId: vehicle.id,
      worksiteId: vehicle.worksiteId,
      updatedAt,
    }).where(and(
      eq(fleetGpsLatestPositions.provider, provider),
      eq(fleetGpsLatestPositions.externalDeviceId, input.unitId),
    ))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fleet_gps_device_link",
      entityId: `${provider}:${input.unitId}`,
      newState: { status: "linked", vehicleId: vehicle.id, plate: vehicle.plate },
    }, tx)
  })

  revalidatePath("/flota/monitoreo")
  const warning = otherLink
    ? ` Atención: ${vehicle.plate} ya tenía vinculado el dispositivo ${otherLink.unitId}.`
    : ""
  return { ok: true, message: `Dispositivo de ${label} vinculado a ${vehicle.plate}.${warning}` }
}

export async function unlinkGpsDeviceAction(input: { provider: GpsProvider; unitId: string }): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para desvincular dispositivos GPS" }
  if (!isGpsProvider(input.provider)) return { ok: false, message: "Proveedor GPS no reconocido." }
  if (!input.unitId.trim()) return { ok: false, message: "Falta el dispositivo." }
  const { provider } = input
  const label = GPS_PROVIDER_LABEL[provider]

  const link = await findDeviceLink(provider, input.unitId)
  if (link?.status === "excluded") {
    return { ok: false, message: "El dispositivo está excluido de la flota. Restáuralo desde «Excluidas» para volver a cruzarlo." }
  }
  // Sólo se desvincula un vínculo manual. Un dispositivo cruzado por patente,
  // VIN o código no tiene link que borrar y la próxima lectura lo volvería a
  // cruzar: la forma de sacarlo del panel es excluirlo, con su motivo.
  if (!link || link.status !== "linked") {
    const position = await findLatestPosition(provider, input.unitId)
    return {
      ok: false,
      message: position?.vehicleId
        ? `El cruce de este dispositivo de ${label} es automático (patente, VIN o código) y volvería a hacerse en la próxima lectura. Si no es de la flota, exclúyelo indicando el motivo; si está cruzado con el vehículo equivocado, usa «Reasignar».`
        : "El dispositivo no tiene un vínculo manual que desvincular.",
    }
  }
  if (link.worksiteId && !canAccessWorksite(session, link.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena del vehículo asociado a este dispositivo." }
  }

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.delete(fleetGpsDeviceLinks).where(and(
      eq(fleetGpsDeviceLinks.provider, provider),
      eq(fleetGpsDeviceLinks.externalDeviceId, input.unitId),
    ))
    await tx.update(fleetGpsLatestPositions).set({
      vehicleId: null,
      worksiteId: null,
      updatedAt,
    }).where(and(
      eq(fleetGpsLatestPositions.provider, provider),
      eq(fleetGpsLatestPositions.externalDeviceId, input.unitId),
    ))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "delete",
      entityType: "fleet_gps_device_link",
      entityId: `${provider}:${input.unitId}`,
      oldState: { status: "linked", vehicleId: link.vehicleId },
    }, tx)
  })

  revalidatePath("/flota/monitoreo")
  return { ok: true, message: `Dispositivo de ${label} desvinculado.` }
}

/**
 * Declara que un dispositivo no es de la flota (equipo de terceros, unidad de
 * prueba): el cruce automático no lo vuelve a tocar y deja de contar como
 * pendiente. Exige motivo y queda auditado; es reversible con
 * `restoreGpsDeviceAction`.
 */
export async function excludeGpsDeviceAction(input: {
  provider: GpsProvider
  unitId: string
  reason: string
}): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para excluir dispositivos GPS" }
  if (!isGpsProvider(input.provider)) return { ok: false, message: "Proveedor GPS no reconocido." }
  if (!input.unitId.trim()) return { ok: false, message: "Falta el dispositivo." }
  if (!isValidReason(input.reason)) {
    return { ok: false, message: reasonRequiredMessage("por qué este dispositivo no es de la flota") }
  }
  const { provider } = input
  const label = GPS_PROVIDER_LABEL[provider]
  const reason = input.reason.trim()

  const unit = await findLatestPosition(provider, input.unitId)
  if (!unit) return { ok: false, message: `El dispositivo de ${label} ya no está en la última lectura. Actualiza ${label} e inténtalo de nuevo.` }

  const link = await findDeviceLink(provider, input.unitId)
  if (link?.status === "excluded") return { ok: false, message: "El dispositivo ya está excluido." }
  // Excluir un dispositivo asociado a un vehículo de otra faena lo sacaría de
  // un panel que esta persona no administra.
  const currentWorksite = currentWorksiteOf(link, unit)
  if (currentWorksite && !canAccessWorksite(session, currentWorksite)) {
    return { ok: false, message: "No tienes acceso a la faena del vehículo al que está asociado el dispositivo." }
  }

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.insert(fleetGpsDeviceLinks).values({
      id: `gpslink-${nanoid()}`,
      provider,
      externalDeviceId: input.unitId,
      status: "excluded",
      vehicleId: null,
      reason,
      createdByUserId: session.user.id,
      updatedAt,
    }).onConflictDoUpdate({
      target: [fleetGpsDeviceLinks.provider, fleetGpsDeviceLinks.externalDeviceId],
      set: { status: "excluded", vehicleId: null, reason, createdByUserId: session.user.id, updatedAt },
    })
    // La posición se conserva (para listar la unidad), pero sin vehículo: no
    // entra al panel ni a Control Operacional.
    await tx.update(fleetGpsLatestPositions).set({
      vehicleId: null,
      worksiteId: null,
      updatedAt,
    }).where(and(
      eq(fleetGpsLatestPositions.provider, provider),
      eq(fleetGpsLatestPositions.externalDeviceId, input.unitId),
    ))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fleet_gps_device_link",
      entityId: `${provider}:${input.unitId}`,
      oldState: link ? { status: link.status, vehicleId: link.vehicleId } : undefined,
      newState: { status: "excluded", reason },
    }, tx)
  })

  revalidatePath("/flota/monitoreo")
  return { ok: true, message: `Dispositivo de ${label} excluido de la flota.` }
}

/** Revierte una exclusión: borra el link y el dispositivo vuelve al cruce automático. */
export async function restoreGpsDeviceAction(input: { provider: GpsProvider; unitId: string }): Promise<ActionState> {
  const session = await requireGpsManager()
  if (!session) return { ok: false, message: "Sin permisos para restaurar dispositivos GPS" }
  if (!isGpsProvider(input.provider)) return { ok: false, message: "Proveedor GPS no reconocido." }
  if (!input.unitId.trim()) return { ok: false, message: "Falta el dispositivo." }
  const { provider } = input
  const label = GPS_PROVIDER_LABEL[provider]

  const link = await findDeviceLink(provider, input.unitId)
  if (link?.status !== "excluded") return { ok: false, message: "El dispositivo no está excluido." }

  await db.transaction(async (tx) => {
    await tx.delete(fleetGpsDeviceLinks).where(and(
      eq(fleetGpsDeviceLinks.provider, provider),
      eq(fleetGpsDeviceLinks.externalDeviceId, input.unitId),
      eq(fleetGpsDeviceLinks.status, "excluded"),
    ))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "delete",
      entityType: "fleet_gps_device_link",
      entityId: `${provider}:${input.unitId}`,
      oldState: { status: "excluded", reason: link.reason },
    }, tx)
  })

  revalidatePath("/flota/monitoreo")
  return {
    ok: true,
    message: `Dispositivo de ${label} restaurado. Volverá a cruzarse con la flota en la próxima lectura.`,
  }
}
