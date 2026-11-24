/**
 * Cuarentena de los intentos automáticos de OnWay cuando Auth0 pide una
 * verificación interactiva (CAPTCHA/OTP).
 *
 * El CAPTCHA no se resuelve solo: lo resuelve una persona desde Monitoreo GPS.
 * Mientras eso no pasa, cada reintento automático es un golpe más contra el
 * tenant de Auth0 desde la misma IP, y el portal puede leerlo como señal para
 * seguir pidiendo el desafío. El cron lo hacía cada 5 minutos —288 veces al
 * día— y el refresco en vivo de la página, cada 50 s. Desde el 2026-11-22 eso
 * dejó 2 873 corridas fallidas seguidas sin que el desafío se resolviera.
 *
 * La cuarentena no reemplaza al lock ni a la verificación: sólo baja el ritmo a
 * un intento cada 30 minutos, lo suficiente para recuperarse solo si el
 * desafío desaparece y lo bastante espaciado para no alimentar el bloqueo.
 *
 * Es puro a propósito: la lectura de `fleet_gps_sync_runs` vive en
 * `onway-sync.ts`, para que esta regla se pueda probar sin base de datos.
 */

/**
 * Separación mínima entre intentos automáticos mientras el último se rindió
 * esperando a una persona. Seis veces menos carga que el cron de 5 minutos.
 */
export const ONWAY_INTERACTIVE_AUTH_COOLDOWN_MS = 30 * 60_000

/** El código que deja una corrida que se rindió esperando el desafío. */
export const ONWAY_INTERACTIVE_AUTH_ERROR_CODE = "ONWAY_INTERACTIVE_AUTH_REQUIRED"

export interface OnwayRunAttempt {
  startedAt: string
  status: string
  errorCode: string | null
}

/**
 * ¿Corresponde saltarse el intento automático?
 *
 * Sólo la última corrida decide, y sólo si falló pidiendo verificación
 * interactiva hace menos que la cuarentena. Un intento manual —o el que la
 * propia vista asistida dispara al resolverse el desafío— deja una corrida más
 * nueva, así que la cuarentena se levanta sola en cuanto hay una lectura
 * distinta, sin estado en memoria que un reinicio pueda perder.
 *
 * Una corrida `running` no activa la cuarentena: el lock ya impide solapar y
 * una fila colgada es otro problema (`hasStalledOnwayCronRun`).
 */
export function isOnwayInteractiveAuthCooldownActive(
  latest: OnwayRunAttempt | undefined,
  now: Date = new Date(),
): boolean {
  if (!latest) return false
  if (latest.status !== "failed" || latest.errorCode !== ONWAY_INTERACTIVE_AUTH_ERROR_CODE) return false
  const startedAt = new Date(latest.startedAt).getTime()
  if (!Number.isFinite(startedAt)) return false
  return now.getTime() - startedAt < ONWAY_INTERACTIVE_AUTH_COOLDOWN_MS
}
