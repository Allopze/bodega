import type { InspectionErrorCode } from "@/lib/prevention/inspection-capture"

/**
 * Error de negocio de una inspección con un código que el cliente puede leer.
 *
 * Sin `cause` a propósito: `safeActionMessage` trata cualquier error con `cause`
 * como un error del driver y lo reemplaza por el texto genérico, así que un
 * `cause` aquí ocultaría el mensaje que la persona necesita leer.
 * El código viaja al cliente en `data.code` (ver `run()` de la acción).
 */
export class InspectionRunError extends Error {
  readonly code: InspectionErrorCode

  constructor(code: InspectionErrorCode, message: string) {
    super(message)
    this.name = "InspectionRunError"
    this.code = code
  }
}

/** Detecta por forma, como `safeActionMessage`: sigue valiendo con dos copias del módulo. */
export function inspectionErrorCodeOf(error: unknown): InspectionErrorCode | null {
  if (!(error instanceof Error)) return null
  const candidate = error as { name?: unknown; code?: unknown }
  if (candidate.name !== "InspectionRunError" || typeof candidate.code !== "string") return null
  return candidate.code as InspectionErrorCode
}
