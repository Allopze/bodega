import { createHmac, timingSafeEqual } from "node:crypto"
import { parsePreventionAckLegacyUntil, parsePreventionAckTtlDays } from "@/lib/env"
import { addDaysToPlainDate, chileLocalDateTimeToUtc, todayInChile } from "@/lib/utils"

/**
 * `CAP-002` y `PER-002` (auditoría 2026-09-14): los dos acuses del sistema —el
 * del AST de un permiso de trabajo y el de una capacitación— exigían que el
 * trabajador fuera usuario de la plataforma (`row.workerUserId === access.userId`).
 * La mayoría del personal de faena no tiene cuenta, así que la constancia de
 * que la persona recibió la información sólo existía para quienes sí la tienen.
 *
 * Esta es la vía alternativa, y no inventa un mecanismo nuevo: es el mismo
 * patrón de enlace-capacidad que el repositorio ya usa dos veces (PPA y TAE),
 * con la misma fuente de secretos y la misma tolerancia a rotación que
 * `lib/services/ppa-module/public-token.ts`.
 *
 * Diferencia deliberada con PPA: allí el enlace se deriva de la clave de
 * idempotencia y se guarda su hash. Aquí no hace falta guardar nada — el
 * destino del acuse (una asistencia, un integrante de cuadrilla) ya tiene id
 * propio y estable, así que el enlace lleva el id y el token, y verificarlo es
 * recalcular el HMAC de ese id. Cero columnas nuevas y cero barrido de tabla
 * para resolver un token.
 *
 * PREV-M06 (informe 2026-09-26): ese HMAC v1 no vencía nunca. Un enlace impreso
 * o reenviado seguía abriendo el acuse indefinidamente (T7a ya lo cerró por
 * estado del permiso; esto lo cierra por tiempo). El token v2 lleva su
 * vencimiento DENTRO de lo firmado — `v2.<expUnix>.<hmac(prevention:ack:v2:kind:id:exp)>`
 * —, así que sigue sin haber columnas nuevas y alargar el plazo a mano rompe la
 * firma. Los v1 ya repartidos se rechazan salvo que `PREVENTION_ACK_LEGACY_UNTIL`
 * abra una ventana de transición.
 */
export type PreventionAckKind = "capacitacion" | "permiso"

/** PREV-M06: lo que ve quien abre o usa un enlace de acuse vencido. */
export const PREVENTION_ACK_EXPIRED_MESSAGE = "El enlace venció; pide uno nuevo a tu supervisor."

/**
 * Secretos con los que puede haberse emitido un enlace: el vigente primero y
 * después los rotados. Misma convención que `authSecrets` y que PPA.
 */
function ackSecrets(): string[] {
  const current = process.env.AUTH_SECRET?.trim()
  if (!current) throw new Error("[prevencion] AUTH_SECRET no configurado: no se puede emitir el enlace de acuse.")
  const previous = (process.env.AUTH_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
  return [current, ...previous]
}

const V1_RE = /^[0-9a-f]{64}$/
const V2_RE = /^v2\.(\d{1,12})\.([0-9a-f]{64})$/

function hmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

function v1Message(kind: PreventionAckKind, targetId: string) {
  return `prevention:ack:v1:${kind}:${targetId}`
}

function v2Message(kind: PreventionAckKind, targetId: string, exp: number) {
  return `prevention:ack:v2:${kind}:${targetId}:${exp}`
}

/**
 * ¿`provided` es el HMAC de `message` con alguno de los secretos? Tiempo
 * constante y sin cortocircuito: no se sale del bucle al primer acierto para no
 * filtrar por tiempo qué secreto acertó.
 */
function signedByAnySecret(message: string, provided: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8")
  let ok = false
  for (const secret of ackSecrets()) {
    const candidate = Buffer.from(hmac(secret, message), "utf8")
    if (candidate.length === providedBuffer.length && timingSafeEqual(candidate, providedBuffer)) ok = true
  }
  return ok
}

/**
 * Vencimiento (segundos Unix) de un enlace emitido en `now`: el cierre del día
 * chileno que cae `ttl` días después. Redondear al día hace que el enlace sea
 * estable durante la jornada —reimprimirlo da el mismo— y que el plazo se lea
 * como una fecha ("vence el 11-10-2026"), no como una hora arbitraria.
 */
function expiryFor(now: Date): number {
  const ttlDays = parsePreventionAckTtlDays(process.env.PREVENTION_ACK_TTL_DAYS)
  const lastDay = todayInChile(new Date(now.getTime() + ttlDays * 86_400_000))
  return Math.floor(Date.parse(chileLocalDateTimeToUtc(`${addDaysToPlainDate(lastDay, 1)}T00:00`)) / 1000)
}

/** Token vigente para el destino del acuse, con su vencimiento firmado. */
export function derivePreventionAckToken(kind: PreventionAckKind, targetId: string, now: Date = new Date()): string {
  const exp = expiryFor(now)
  return `v2.${exp}.${hmac(ackSecrets()[0]!, v2Message(kind, targetId, exp))}`
}

/**
 * - `valid`: la firma corresponde a este destino y el plazo no ha vencido.
 * - `expired`: la firma corresponde (el enlace lo emitimos nosotros) pero ya
 *   venció — o es un v1 fuera de la ventana de transición.
 * - `invalid`: cualquier otra cosa.
 *
 * Distinguir `expired` no revela si el destino existe: se decide sólo con la
 * firma, sin tocar la base, y sólo quien tiene el secreto puede fabricar una.
 */
export type PreventionAckTokenStatus = "valid" | "expired" | "invalid"

export function checkPreventionAckToken(
  kind: PreventionAckKind,
  targetId: string,
  token: unknown,
  now: Date = new Date(),
): PreventionAckTokenStatus {
  if (typeof token !== "string") return "invalid"

  const v2 = V2_RE.exec(token)
  if (v2) {
    const exp = Number(v2[1])
    if (!signedByAnySecret(v2Message(kind, targetId, exp), v2[2]!)) return "invalid"
    return now.getTime() < exp * 1000 ? "valid" : "expired"
  }

  if (V1_RE.test(token)) {
    // Se prueban los secretos rotados, igual que `resolvePpaPublicToken`.
    if (!signedByAnySecret(v1Message(kind, targetId), token)) return "invalid"
    const legacyUntil = parsePreventionAckLegacyUntil(process.env.PREVENTION_ACK_LEGACY_UNTIL)
    return legacyUntil && now.getTime() < legacyUntil.getTime() ? "valid" : "expired"
  }

  return "invalid"
}

/** ¿Este token abre este destino ahora? Atajo booleano de `checkPreventionAckToken`. */
export function verifyPreventionAckToken(
  kind: PreventionAckKind,
  targetId: string,
  token: unknown,
  now: Date = new Date(),
): boolean {
  return checkPreventionAckToken(kind, targetId, token, now) === "valid"
}

/**
 * Ruta pública del acuse y su vencimiento, para mostrarlo junto al enlace. El
 * id va en la URL para que verificar sea O(1).
 */
export function preventionAckLink(
  kind: PreventionAckKind,
  targetId: string,
  now: Date = new Date(),
): { path: string; expiresAt: Date } {
  const token = derivePreventionAckToken(kind, targetId, now)
  const exp = Number(token.split(".")[1])
  return { path: `/acuse/${kind}/${encodeURIComponent(targetId)}/${token}`, expiresAt: new Date(exp * 1000) }
}

/** Ruta pública del acuse. */
export function preventionAckPath(kind: PreventionAckKind, targetId: string, now: Date = new Date()): string {
  return preventionAckLink(kind, targetId, now).path
}
