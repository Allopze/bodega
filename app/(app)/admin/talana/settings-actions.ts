"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { createTalanaClient, TalanaClientError } from "@/lib/integrations/talana/talana-client"
import {
  clearTalanaSettings,
  loadTalanaConfig,
  saveTalanaSettings,
  type TalanaSyncMode,
} from "@/lib/integrations/talana/talana-settings"
import { logger } from "@/lib/logger"
import { EncryptedSettingsError } from "@/lib/services/encrypted-settings"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import type { ActionState } from "@/lib/validation/masters"
import { talanaConnectionErrorMessage } from "./talana-labels"

/**
 * Token y modo de la sincronización con Talana, desde Administración ›
 * Sincronización Talana. Todo va con `admin:talana_settings` (sólo
 * administrador): ver los resultados de la sincronización (`admin:workers_hr`)
 * no da derecho a cambiar con qué cuenta se descarga ni a pasarla a «Aplicar».
 */
const PAGE = "/admin/talana"
const TOKEN_MAX_LENGTH = 500
/** ASCII imprimible sin espacios: lo que cabe en una cabecera `Authorization`. */
const TOKEN_PATTERN = /^[\x21-\x7E]+$/

/** Pruebas de conexión por persona: Talana bloquea la URL 10 minutos sobre 50 peticiones por minuto. */
const TEST_LIMIT = { maxAttempts: 3, lockMs: 10 * 60_000 }

export interface TalanaSettingsResult {
  ok: boolean
  message?: string
}

/** Un campo de archivo o ausente no es un secreto: se trata como vacío. */
function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : ""
}

/** `undefined` = el formulario no mandó modo (conserva); `null` = un valor que no es un modo. */
function parseMode(raw: string): TalanaSyncMode | null | undefined {
  if (raw === "") return undefined
  return raw === "off" || raw === "simulate" || raw === "apply" ? raw : null
}

/**
 * Guarda el token y/o el modo. Vacío conserva (abrir el diálogo y guardar no
 * borra nada); borrar el token es explícito. El token viaja del navegador al
 * servidor y no vuelve: la pantalla sólo recibe banderas.
 */
export async function saveTalanaSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session, error } = await guardPermission("admin:talana_settings", PAGE)
  if (error) return error

  // Un token pegado suele traer un salto de línea al final: se recorta. Uno con
  // espacios en medio no es un token y se rechaza más abajo.
  const apiToken = formString(formData.get("apiToken")).trim()
  const clearApiToken = formData.get("clearApiToken") === "on"
  const mode = parseMode(formString(formData.get("mode")).trim())

  if (mode === null) return { ok: false, message: "El modo de sincronización no es válido." }
  if (apiToken.length > TOKEN_MAX_LENGTH) return { ok: false, message: "El token es demasiado largo." }
  if (apiToken && !TOKEN_PATTERN.test(apiToken)) {
    return { ok: false, message: "El token tiene espacios o caracteres no válidos. Cópialo de nuevo desde Talana." }
  }
  if (apiToken && clearApiToken) {
    return { ok: false, message: "No se puede escribir un token nuevo y borrar el guardado a la vez." }
  }

  try {
    const result = await saveTalanaSettings(
      { apiToken, clearApiToken, mode },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
    revalidatePath(PAGE)
    if (!result.changed) return { ok: true, message: "No había cambios que guardar." }

    // Activar la sincronización sin token usable no es un error de guardado,
    // pero sí una corrida «deshabilitada» cada mañana que nadie se explica.
    const effective = await loadTalanaConfig()
    const warning = effective.mode !== "off" && !effective.hasCredentials
      ? effective.tokenUnreadable
        ? " Ojo: el token guardado no se puede abrir con el llavero de este servidor; ingrésalo de nuevo."
        : " Ojo: el modo quedó activo pero falta el token, así que la sincronización no va a correr."
      : ""
    return { ok: true, message: `Configuración de Talana guardada.${warning}` }
  } catch (err) {
    if (err instanceof EncryptedSettingsError) {
      if (err.code === "SETTINGS_KEYRING_REQUIRED") {
        return {
          ok: false,
          message: "Este servidor no tiene el llavero de cifrado configurado, así que no puede guardar el token y " +
            "no se guardó nada. Configura DTE_SETTINGS_KEYRING y DTE_SETTINGS_ACTIVE_KEY_ID, o deja el token en el " +
            ".env. Para cambiar sólo el modo, deja el campo del token vacío.",
        }
      }
      return { ok: false, message: "No se puede escribir un token nuevo y borrar el guardado a la vez." }
    }
    // Nunca se propaga el mensaje original: puede venir de la capa de cifrado.
    logger.error("[talana:saveSettings]", { code: err instanceof Error ? err.name : "unknown" })
    return { ok: false, message: "No se pudo guardar la configuración de Talana." }
  }
}

/** Borra lo guardado y vuelve a la configuración del `.env` del servidor. */
export async function clearTalanaSettingsAction(): Promise<TalanaSettingsResult> {
  const { session, error } = await guardPermission("admin:talana_settings", PAGE)
  if (error) return error

  try {
    await clearTalanaSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(PAGE)
    return { ok: true, message: "Se restauró la configuración del servidor." }
  } catch (err) {
    logger.error("[talana:clearSettings]", { code: err instanceof Error ? err.name : "unknown" })
    return { ok: false, message: "No se pudo restaurar la configuración del servidor." }
  }
}

/**
 * Prueba el token VIGENTE (el guardado, o el del `.env`), sin guardar nada: una
 * sola consulta de contratos con `page_size=1`. Va limitada por persona porque
 * Talana bloquea la URL durante 10 minutos si se excede su cuota, y ese bloqueo
 * también lo sufriría la sincronización diaria.
 */
export async function testTalanaConnectionAction(): Promise<TalanaSettingsResult> {
  const { session, error } = await guardPermission("admin:talana_settings", PAGE)
  if (error) return error

  try {
    const config = await loadTalanaConfig()
    if (!config.hasCredentials) {
      return {
        ok: false,
        message: config.tokenUnreadable
          ? "El token guardado no se puede abrir con el llavero de este servidor. Ingresa el token de nuevo."
          : "No hay token configurado. Guárdalo y vuelve a probar.",
      }
    }

    const quota = await consumeFixedWindowLimit(`talana-test:${session.user.id}`, TEST_LIMIT)
    if (!quota.allowed) {
      return {
        ok: false,
        message: "Ya probaste la conexión varias veces. Talana bloquea las consultas en exceso: espera unos 10 minutos.",
      }
    }

    const { contractCount } = await createTalanaClient({ token: config.token }).ping()
    const detail = contractCount === null ? "" : ` La cuenta tiene ${contractCount} contratos registrados.`
    return { ok: true, message: `Conexión correcta: Talana aceptó el token.${detail}` }
  } catch (err) {
    if (err instanceof TalanaClientError) {
      // Sólo el código y el estado HTTP: nunca el cuerpo del proveedor ni el token.
      logger.warn("[talana:testConnection]", { code: err.code, status: err.status })
      return { ok: false, message: talanaConnectionErrorMessage(err.code, err.status) }
    }
    logger.error("[talana:testConnection]", { code: err instanceof Error ? err.name : "unknown" })
    return { ok: false, message: "No se pudo probar la conexión con Talana." }
  }
}
