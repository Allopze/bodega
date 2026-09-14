import { createHmac, timingSafeEqual } from "node:crypto"

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
 */
export type PreventionAckKind = "capacitacion" | "permiso"

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

function deriveWith(secret: string, kind: PreventionAckKind, targetId: string): string {
  return createHmac("sha256", secret).update(`prevention:ack:v1:${kind}:${targetId}`).digest("hex")
}

/** Token vigente para el destino del acuse. Determinista: el mismo enlace se puede reimprimir. */
export function derivePreventionAckToken(kind: PreventionAckKind, targetId: string): string {
  return deriveWith(ackSecrets()[0]!, kind, targetId)
}

/**
 * ¿Este token abre este destino? Se prueban los secretos rotados, igual que
 * hace `resolvePpaPublicToken`: rotar `AUTH_SECRET` no debe invalidar de golpe
 * los enlaces ya repartidos en terreno.
 */
export function verifyPreventionAckToken(kind: PreventionAckKind, targetId: string, token: unknown): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false
  const provided = Buffer.from(token, "utf8")
  let ok = false
  for (const secret of ackSecrets()) {
    const candidate = Buffer.from(deriveWith(secret, kind, targetId), "utf8")
    // Comparación de tiempo constante y sin cortocircuito: no se sale del
    // bucle al primer acierto para no filtrar por tiempo qué secreto acertó.
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) ok = true
  }
  return ok
}

/** Ruta pública del acuse. El id va en la URL para que verificar sea O(1). */
export function preventionAckPath(kind: PreventionAckKind, targetId: string): string {
  return `/acuse/${kind}/${encodeURIComponent(targetId)}/${derivePreventionAckToken(kind, targetId)}`
}
