import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * `PPA-001` (auditoría 2026-09-14): el panel interno repartía el acceso público
 * como `"<origen>/ppa?faena=<worksiteId>"`. Ese parámetro NO es una credencial:
 * el id de la faena es un dato ordinario que aparece en cualquier URL de la
 * aplicación, la página pública lo aceptaba con sólo existir y `submitPpaAction`
 * escribía contra cualquier faena activa. Cualquiera con la URL base podía
 * alimentar el registro preventivo de una faena en la que nunca estuvo.
 *
 * La superficie hermana del mismo repositorio ya lo hacía bien: TAE exige un
 * `accessToken` y resuelve la faena en el servidor (`getTaeLinkWorksiteId`).
 * Este módulo copia ese contrato —la faena la acredita el enlace, no el
 * cliente— con el mecanismo más liviano que el repositorio ya usa para lo
 * mismo: HMAC derivado del secreto del servidor, sin columna ni tabla nueva
 * (igual que `lib/services/prevention-ack-token.ts`).
 *
 * DIFERENCIA CON TAE, deliberada y con costo: TAE guarda una fila por enlace y
 * por eso puede revocarlo o caducarlo. Acá el token se DERIVA del id de la
 * faena, así que es estable y no se puede revocar sin persistir algo. Es un
 * intercambio consciente: cierra el agujero sin migración, y deja abierta —como
 * decisión de producto, no de código— si los enlaces PPA necesitan caducidad y
 * revocación como los TAE. Cuando esa decisión exista, el reemplazo es una
 * tabla de enlaces y este módulo desaparece.
 */

/** Secretos vigentes y rotados, misma convención que `authSecrets` y PPA/TAE. */
function accessSecrets(): string[] {
  const current = process.env.AUTH_SECRET?.trim()
  if (!current) throw new Error("[ppa] AUTH_SECRET no configurado: no se puede emitir el enlace de faena.")
  const previous = (process.env.AUTH_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
  return [current, ...previous]
}

function deriveWith(secret: string, worksiteId: string): string {
  return createHmac("sha256", secret).update(`ppa:worksite-access:v1:${worksiteId}`).digest("hex")
}

/** Token vigente de la faena. Determinista: el QR impreso se puede reimprimir igual. */
export function derivePpaWorksiteAccessToken(worksiteId: string): string {
  return deriveWith(accessSecrets()[0]!, worksiteId)
}

/**
 * ¿Este token acredita esta faena? Se prueban también los secretos rotados:
 * rotar `AUTH_SECRET` no puede invalidar de golpe los QR ya pegados en terreno.
 */
export function verifyPpaWorksiteAccessToken(worksiteId: string, token: unknown): boolean {
  if (!worksiteId) return false
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false
  const provided = Buffer.from(token, "utf8")
  let ok = false
  for (const secret of accessSecrets()) {
    const candidate = Buffer.from(deriveWith(secret, worksiteId), "utf8")
    // Tiempo constante y sin cortocircuito: no se sale al primer acierto para
    // no filtrar por tiempo cuál secreto acertó.
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) ok = true
  }
  return ok
}

/** Nombre del parámetro que lleva el token en el enlace público. */
export const PPA_ACCESS_TOKEN_PARAM = "t"

/** Query string del enlace acreditado de una faena, sin el origen. */
export function ppaWorksiteAccessQuery(worksiteId: string): string {
  return `?faena=${encodeURIComponent(worksiteId)}&${PPA_ACCESS_TOKEN_PARAM}=${derivePpaWorksiteAccessToken(worksiteId)}`
}
