/**
 * Avisos de OnWay cuando la integración queda esperando a una persona.
 *
 * El antecedente que los motiva: entre el 2026-11-22 y el 2026-11-24 el GPS
 * estuvo detenido 2 días y 16 h con 2 873 corridas fallidas seguidas. La única
 * señal existía, pero sólo se veía entrando a TI › Integraciones o a Monitoreo
 * GPS; nadie pasa por ahí a menos que ya sospeche. Las 46 unidades que sólo
 * reportan por OnWay quedaron sin posición y nadie se enteró.
 *
 * Usa la infraestructura que ya existe —`createNotifications` deja la campana y
 * manda el correo por `lib/email/smtp.ts`, respetando `emails_enabled` y la
 * preferencia de cada persona—. No se agregó proveedor ni ajuste nuevo.
 *
 * Destinatarios: `flota:manage_gps`, el mismo permiso que gobierna
 * «Resolver verificación», para que quien recibe el aviso sea exactamente quien
 * puede hacer algo al respecto.
 *
 * Deduplicación por código de error y día chileno: mientras el problema dure se
 * avisa como máximo una vez al día, igual que `backup-health` y las alertas de
 * Prevención. El índice parcial `(user_id, dedupe_key)` de `notifications`
 * evita también el correo repetido.
 *
 * Nada de esto puede tumbar la corrida que lo invoca: cada función atrapa y
 * registra sus propios errores.
 */
import { logger } from "@/lib/logger"
import { todayInChile } from "@/lib/utils"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import type { OnwayClientErrorCode } from "./onway-client"

/** Quien puede resolver la verificación asistida es quien debe enterarse. */
export const ONWAY_ALERT_RECIPIENT_PERMISSION = "flota:manage_gps"

const MONITORING_HREF = "/flota/monitoreo"

/**
 * Qué códigos ameritan interrumpir a una persona.
 *
 * `ONWAY_INTERACTIVE_AUTH_REQUIRED` es el caso central: la automatización no
 * puede avanzar sola y el remedio es un clic humano. Los otros dos dejan la
 * integración igual de detenida y con la misma causa probable —credenciales o
 * cuenta—, así que también avisan. Un hipo de red (`ONWAY_PORTAL_TIMEOUT`) no:
 * el siguiente intento suele pasar y avisarlo sería ruido.
 */
const ACTIONABLE_CODES: ReadonlySet<OnwayClientErrorCode> = new Set<OnwayClientErrorCode>([
  "ONWAY_INTERACTIVE_AUTH_REQUIRED",
  "ONWAY_AUTH_REJECTED",
  "ONWAY_CREDENTIALS_REQUIRED",
  "ONWAY_SNAPSHOT_EMPTY",
])

export interface OnwayAlertInput {
  code: OnwayClientErrorCode
  /** Última captura con datos, para decir cuánto lleva detenido. */
  latestObservedAt?: string | null
  now?: Date
}

/** Texto de usuario: qué pasó y qué hacer, sin códigos técnicos en el título. */
function messageFor(input: OnwayAlertInput): { title: string; body: string } {
  const stale = input.latestObservedAt
    ? ` La última posición recibida es del ${input.latestObservedAt.slice(0, 16).replace("T", " ")} UTC.`
    : ""
  switch (input.code) {
    case "ONWAY_INTERACTIVE_AUTH_REQUIRED":
      return {
        title: "El GPS OnWay está esperando una verificación",
        body: `Entel OnWay pide un CAPTCHA u OTP y la actualización automática quedó en pausa: no se resuelve sola. Entra a Monitoreo GPS y usa «Resolver verificación»; mientras no se resuelva, las unidades que sólo reportan por OnWay no actualizan su posición.${stale}`,
      }
    case "ONWAY_AUTH_REJECTED":
      return {
        title: "Entel OnWay rechazó las credenciales del GPS",
        body: `El portal rechazó el usuario o la contraseña configurados, así que el monitoreo está detenido. Revisa las credenciales en Monitoreo GPS › Configuración de OnWay.${stale}`,
      }
    case "ONWAY_CREDENTIALS_REQUIRED":
      return {
        title: "Faltan las credenciales del GPS OnWay",
        body: `La sincronización con Entel OnWay está activa pero no hay usuario y contraseña utilizables. Configúralos en Monitoreo GPS › Configuración de OnWay.${stale}`,
      }
    default:
      return {
        title: "Entel OnWay no devolvió ningún equipo",
        body: `El portal aceptó la sesión pero respondió con cero equipos: la cuenta perdió la flota o no es la que corresponde. Revisa la cuenta configurada en Monitoreo GPS › Configuración de OnWay; mientras tanto no se actualiza ninguna posición.${stale}`,
      }
  }
}

/**
 * Avisa que OnWay necesita intervención humana. Se llama desde el cron cuando
 * el intento automático se rindió con un código accionable.
 */
export async function alertOnwayNeedsAttention(input: OnwayAlertInput): Promise<void> {
  if (!ACTIONABLE_CODES.has(input.code)) return
  const now = input.now ?? new Date()
  try {
    const recipients = await getUserIdsWithPermission(ONWAY_ALERT_RECIPIENT_PERMISSION)
    if (recipients.length === 0) {
      logger.error("[flota/onway/alerta] nadie a quien avisar: ningún usuario activo tiene flota:manage_gps")
      return
    }
    const { title, body } = messageFor({ ...input, now })
    await createNotifications(recipients, {
      type: "system_alert",
      title,
      body,
      entityType: "fleet_gps_sync_run",
      entityId: "fleet-onway-sync",
      entityHref: MONITORING_HREF,
      dedupeKey: `onway-attention:${input.code}:${todayInChile(now)}`,
    })
  } catch (error) {
    logger.error("[flota/onway/alerta] no se pudo avisar que OnWay necesita atención", error)
  }
}
