import { createHash, createHmac } from "node:crypto"

/**
 * Los enlaces PPA son credenciales de capacidad: el valor sin hash solo se
 * entrega una vez al trabajador y nunca se persiste en la base de datos.
 */
export function hashPpaPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Secretos con los que puede haberse derivado un enlace: el vigente primero y
 * después los rotados. Misma fuente y mismo formato (lista separada por comas)
 * que `authSecrets` en lib/auth/auth.ts, para no inventar una segunda
 * convención de rotación.
 */
function ppaSecrets(): string[] {
  const current = process.env.AUTH_SECRET?.trim()
  if (!current) throw new Error("[ppa] AUTH_SECRET no configurado: no se puede emitir el enlace público.")
  const previous = (process.env.AUTH_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
  return [current, ...previous]
}

function deriveWith(secret: string, clientSubmissionId: string): string {
  return createHmac("sha256", secret).update(`ppa:public-token:v1:${clientSubmissionId}`).digest("hex")
}

/**
 * Token derivado de la clave de idempotencia del envío.
 *
 * Un reenvío de la cola offline tiene que devolver EL MISMO enlace que el
 * primer intento, pero la base sólo guarda el hash (ver arriba): no hay de
 * dónde recuperar el valor original. Derivarlo con HMAC del secreto del
 * servidor lo hace reproducible sin persistirlo — la fila sigue sin contener
 * nada que permita reconstruir el enlace, porque `client_submission_id` (que
 * sí es visible en la base) no basta para calcularlo sin el secreto.
 */
export function derivePpaPublicToken(clientSubmissionId: string): string {
  return deriveWith(ppaSecrets()[0]!, clientSubmissionId)
}

/**
 * El token que de verdad abre `storedHash`, o null si ninguno lo abre.
 *
 * La derivación es determinista sobre `AUTH_SECRET`, y el repo soporta rotarlo
 * (`AUTH_SECRET_PREVIOUS`). Tras una rotación, un reenvío de la cola offline
 * derivaba un token distinto del que se hasheó en el insert original: la fila
 * devuelta era la correcta, pero el enlace daba 404. Se prueban los secretos
 * rotados contra el hash guardado para devolver el enlace que sigue vivo, que
 * es exactamente lo que ya hace next-auth con las sesiones firmadas.
 */
export function resolvePpaPublicToken(clientSubmissionId: string, storedHash: string): string | null {
  for (const secret of ppaSecrets()) {
    const candidate = deriveWith(secret, clientSubmissionId)
    if (hashPpaPublicToken(candidate) === storedHash) return candidate
  }
  return null
}
