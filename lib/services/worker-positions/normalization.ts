import { createHash } from "node:crypto"
export { WORKER_CAPABILITY_CODE_PATTERN } from "@/lib/worker-positions/capability-code"

/**
 * Forma canónica de un código de `worker_capabilities`.
 *
 * Espejo exacto del CHECK `worker_capabilities_code_valid`. Vive en este módulo
 * hoja —sin dependencias— para que validación, servicios de cargos y PDTP
 * compartan la misma definición en vez de cuatro copias del literal.
 */
export function normalizeWorkerPositionKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function cleanWorkerPositionDisplayName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ")
}

export function buildWorkerPositionAutoCode(normalizedKey: string): string {
  const digest = createHash("md5").update(normalizedKey, "utf8").digest("hex")
  return `AUTO-${digest.slice(0, 12).toUpperCase()}`
}
