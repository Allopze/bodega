"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { OnwayClientError, type OnwayClientErrorCode } from "@/lib/integrations/onway/onway-client"
import {
  clearOnwaySettings,
  OnwaySettingsError,
  readOnwayConfig,
  saveOnwaySettings,
} from "@/lib/integrations/onway/onway-settings"
import { syncOnway } from "@/lib/integrations/onway/onway-sync"
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
  ONWAY_SYNC_FAILED: "No se pudo actualizar el monitoreo GPS.",
}

async function requireGpsManager(): Promise<Awaited<ReturnType<typeof requirePermission>> | null> {
  try { return await requirePermission("flota:manage_gps") }
  catch { return null }
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
    const warnings = result.warnings.length > 0 ? ` Se omitieron temporalmente: ${result.warnings.join(", ")}.` : ""
    return { ok: true, message: `${result.matched} vehículo${result.matched === 1 ? "" : "s"} actualizado${result.matched === 1 ? "" : "s"}.${detail}${warnings}` }
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
