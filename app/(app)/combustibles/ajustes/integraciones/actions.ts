"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import {
  clearCopecSettings,
  CopecSettingsError,
  loadCopecConfig,
  saveCopecSettings,
} from "@/lib/combustibles/copec-settings"
import { withCopecWebServiceSession } from "@/lib/combustibles/copec-ws"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import {
  VisionLinkClientError,
  verifyVisionLinkCredentials,
} from "@/lib/integrations/visionlink/visionlink-client"
import {
  clearVisionLinkSettings,
  loadVisionLinkConfig,
  saveVisionLinkSettings,
} from "@/lib/integrations/visionlink/visionlink-settings"
import { logger } from "@/lib/logger"
import { EncryptedSettingsError } from "@/lib/services/encrypted-settings"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/masters"

/**
 * Acciones de «Combustibles › Ajustes › Integraciones»: guardar, restaurar y
 * probar la conexión de Copec y VisionLink.
 *
 * Todas van con `combustibles:manage_integrations`, el mismo permiso que abre la
 * página: quien puede ver el estado de las integraciones es quien tiene que
 * poder arreglarlas. Ocultar el botón no es autorización, así que cada acción
 * vuelve a comprobarlo. Un secreto viaja del navegador al servidor y no vuelve:
 * ninguna respuesta lleva un valor de la configuración.
 */

const PERMISSION = "combustibles:manage_integrations" as const
const REVALIDATE = FUEL_PATHS.ajustesIntegraciones

type ActionResult = { ok: boolean; message: string }

/** Probar la conexión llama al proveedor con las credenciales reales: se acota por persona. */
const TEST_LIMIT = { maxAttempts: 3, lockMs: 10 * 60_000 } as const
const TEST_RATE_LIMITED_MESSAGE = "Probaste la conexión demasiadas veces seguidas. Espera unos minutos e inténtalo de nuevo."

const KEYRING_MESSAGE =
  "Este servidor no tiene el llavero de cifrado configurado, así que no puede guardar credenciales. " +
  "Configura DTE_SETTINGS_KEYRING y DTE_SETTINGS_ACTIVE_KEY_ID, o deja las credenciales en el .env del servidor."

/** Un campo de archivo o ausente no es un valor: se trata como vacío. */
function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : ""
}

/**
 * Los topes existen para que un envío deformado no llegue a la capa de cifrado:
 * las credenciales reales miden decenas de caracteres, no kilobytes.
 */
const visionLinkSchema = z.object({
  clientId: z.string().trim().max(200, "El client id es demasiado largo"),
  clientSecret: z.string().trim().max(500, "El client secret es demasiado largo"),
  scope: z.string().trim().max(300, "El scope es demasiado largo"),
  syncEnabled: z.boolean(),
  clearClientSecret: z.boolean(),
})

const copecSchema = z.object({
  username: z.string().trim().max(200, "El usuario es demasiado largo"),
  password: z.string().trim().max(500, "La contraseña es demasiado larga"),
  clientRut: z.string().trim().max(20, "El RUT es demasiado largo"),
  importerEmail: z.string().trim().max(254, "El correo es demasiado largo"),
  syncEnabled: z.boolean(),
  clearUsername: z.boolean(),
  clearPassword: z.boolean(),
})

/** El mensaje que corresponde a un fallo de guardado; nunca el texto original de un error interno. */
function saveFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof EncryptedSettingsError) {
    return error.code === "SETTINGS_KEYRING_REQUIRED"
      ? KEYRING_MESSAGE
      : "No se puede guardar un valor y borrarlo a la vez."
  }
  // El texto de un error de validación está escrito para quien administra.
  if (error instanceof CopecSettingsError) return error.message
  logger.error("[combustibles/integraciones] no se pudo guardar", { message: String(error) })
  return fallback
}

/* ── VisionLink ──────────────────────────────────────────────────────────── */

export async function saveVisionLinkSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  const parsed = visionLinkSchema.safeParse({
    clientId: formString(formData.get("clientId")),
    clientSecret: formString(formData.get("clientSecret")),
    scope: formString(formData.get("scope")),
    syncEnabled: formData.get("syncEnabled") === "on",
    clearClientSecret: formData.get("clearClientSecret") === "on",
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Parámetros inválidos" }
  if (parsed.data.clientSecret && parsed.data.clearClientSecret) {
    return { ok: false, message: "No se puede guardar un client secret nuevo y borrar el guardado a la vez." }
  }

  try {
    const result = await saveVisionLinkSettings(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)

    // Activar la actualización sin credenciales completas no es un error de
    // guardado, pero el cron quedaría apagado sin que nadie lo note: se avisa acá.
    const stored = await loadVisionLinkConfig()
    const warning = stored.syncEnabled && !stored.hasCredentials
      ? " Ojo: la actualización diaria quedó activa pero faltan credenciales, así que no va a correr."
      : ""
    return { ok: true, message: `${result.changed ? "Configuración de VisionLink guardada." : "No había cambios que guardar."}${warning}` }
  } catch (err) {
    return { ok: false, message: saveFailureMessage(err, "No se pudo guardar la configuración de VisionLink") }
  }
}

/** Borra lo guardado y vuelve a la configuración del `.env` del servidor. */
export async function clearVisionLinkSettingsAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  try {
    await clearVisionLinkSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Se restauró la configuración del servidor" }
  } catch (err) {
    logger.error("[combustibles/clearVisionLinkSettings]", { message: String(err) })
    return { ok: false, message: "No se pudo restaurar la configuración del servidor" }
  }
}

/** Mensaje en español de un fallo del proveedor; el código ya es seguro, el cuerpo de la respuesta no se muestra. */
function visionLinkFailureMessage(error: unknown): string {
  if (error instanceof VisionLinkClientError) {
    switch (error.code) {
      case "VISIONLINK_AUTH_FAILED":
        return "VisionLink rechazó las credenciales. Revisa el client id, el client secret y el scope."
      case "VISIONLINK_RATE_LIMITED":
        return "VisionLink limitó las consultas. Espera unos minutos e inténtalo de nuevo."
      case "VISIONLINK_TIMEOUT":
        return "VisionLink no respondió a tiempo. Inténtalo de nuevo."
      default:
        return "VisionLink respondió con un error. Inténtalo de nuevo más tarde."
    }
  }
  return "No fue posible conectar con VisionLink."
}

/**
 * Prueba la configuración GUARDADA (no lo que se esté escribiendo en el
 * formulario): pide sólo el token OAuth, sin leer datos de la flota.
 */
export async function testVisionLinkConnectionAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  const limit = await consumeFixedWindowLimit(`visionlink-test:${session.user.id}`, TEST_LIMIT)
  if (!limit.allowed) return { ok: false, message: TEST_RATE_LIMITED_MESSAGE }

  try {
    const config = await loadVisionLinkConfig()
    if (!config.hasCredentials) {
      return { ok: false, message: "Faltan credenciales: guarda el client id y el client secret antes de probar." }
    }
    await verifyVisionLinkCredentials(config)
    return { ok: true, message: "Conexión correcta: VisionLink aceptó las credenciales." }
  } catch (err) {
    // Sólo el código viaja al log: ni el cuerpo del proveedor ni las credenciales.
    logger.warn("[combustibles/testVisionLinkConnection]", { code: err instanceof VisionLinkClientError ? err.code : "UNKNOWN" })
    return { ok: false, message: visionLinkFailureMessage(err) }
  }
}

/* ── Copec ───────────────────────────────────────────────────────────────── */

export async function saveCopecSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  const parsed = copecSchema.safeParse({
    username: formString(formData.get("username")),
    password: formString(formData.get("password")),
    clientRut: formString(formData.get("clientRut")),
    importerEmail: formString(formData.get("importerEmail")),
    syncEnabled: formData.get("syncEnabled") === "on",
    clearUsername: formData.get("clearUsername") === "on",
    clearPassword: formData.get("clearPassword") === "on",
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Parámetros inválidos" }
  if ((parsed.data.username && parsed.data.clearUsername) || (parsed.data.password && parsed.data.clearPassword)) {
    return { ok: false, message: "No se puede guardar un valor nuevo y borrar el guardado a la vez." }
  }

  try {
    const result = await saveCopecSettings(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)

    // Lo que el cron necesita para correr de verdad, dicho al guardar y no a las
    // 05:30: sin credenciales queda apagado, sin usuario de la corrida falla.
    const stored = await loadCopecConfig()
    let warning = ""
    if (stored.syncEnabled && !stored.hasCredentials) {
      warning = " Ojo: la actualización diaria está activa pero faltan credenciales, así que no va a correr."
    } else if (stored.syncEnabled && !stored.importerEmail) {
      warning = " Ojo: falta el usuario que registra la actualización automática; la corrida de la mañana va a fallar hasta definirlo."
    }
    return { ok: true, message: `${result.changed ? "Configuración de Copec guardada." : "No había cambios que guardar."}${warning}` }
  } catch (err) {
    return { ok: false, message: saveFailureMessage(err, "No se pudo guardar la configuración de Copec") }
  }
}

/** Borra lo guardado y vuelve a la configuración del `.env` del servidor. */
export async function clearCopecSettingsAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  try {
    await clearCopecSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Se restauró la configuración del servidor" }
  } catch (err) {
    logger.error("[combustibles/clearCopecSettings]", { message: String(err) })
    return { ok: false, message: "No se pudo restaurar la configuración del servidor" }
  }
}

/** Mensaje en español según el tipo de falla; el texto del proveedor no se muestra. */
function copecFailureMessage(kind: "provider_limit" | "provider_rejected" | "network" | "invalid_file"): string {
  switch (kind) {
    case "provider_rejected":
      return "Copec rechazó la consulta. Revisa el usuario, la contraseña y el RUT de la empresa (el usuario debe ser ADMINISTRADOR CLIENTE)."
    case "provider_limit":
      return "Copec limitó las consultas. Espera unos minutos e inténtalo de nuevo."
    case "network":
      return "No fue posible conectar con el servicio web de Copec. Inténtalo de nuevo."
    case "invalid_file":
      return "Copec respondió algo que no se pudo leer. Inténtalo de nuevo más tarde."
  }
}

/**
 * Prueba la configuración GUARDADA con una sola consulta de diésel TCT del día
 * de ayer. Abrir la sesión sin consultar no contacta a Copec —sólo lee la
 * configuración—, así que no probaría nada: la consulta de un día es lo mínimo
 * que sí confirma que el servicio acepta usuario, contraseña y RUT.
 */
export async function testCopecConnectionAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (error) return error

  const limit = await consumeFixedWindowLimit(`copec-test:${session.user.id}`, TEST_LIMIT)
  if (!limit.allowed) return { ok: false, message: TEST_RATE_LIMITED_MESSAGE }

  const day = addDaysToPlainDate(todayInChile(), -1)
  try {
    const [result] = await withCopecWebServiceSession(
      (copec) => copec.download([{ product: "diesel", from: day, to: day }], "TCT"),
      { deadline: Date.now() + 25_000 },
    )
    if (!result) return { ok: false, message: "Copec no entregó respuesta. Inténtalo de nuevo." }
    if (result.unavailable) {
      return {
        ok: true,
        message: "Copec respondió y no rechazó las credenciales. Ayer no hubo cargas, así que no se pudo confirmar la lectura de datos.",
      }
    }
    if ("failure" in result) {
      logger.warn("[combustibles/testCopecConnection]", { kind: result.failure.kind })
      return { ok: false, message: copecFailureMessage(result.failure.kind) }
    }
    return { ok: true, message: "Conexión correcta: Copec aceptó las credenciales y entregó las cargas de ayer." }
  } catch (err) {
    // Faltan credenciales o el RUT no es válido: el texto está escrito para quien
    // administra y no lleva valores. Todo lo demás se aplasta en un genérico.
    return { ok: false, message: safeActionMessage(err, "No fue posible probar la conexión con Copec.") }
  }
}
