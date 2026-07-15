import { createHash } from "node:crypto"

/**
 * Los enlaces PPA son credenciales de capacidad: el valor sin hash solo se
 * entrega una vez al trabajador y nunca se persiste en la base de datos.
 */
export function hashPpaPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
