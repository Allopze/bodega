/**
 * Contratos de la captura en terreno de una inspección (cliente y servidor).
 *
 * Módulo puro y sin dependencias de React ni de la base: lo importan el hook de
 * autoguardado, el detalle de la ejecución y la acción del servidor. La Fase 0
 * deja los tipos y el lector del código de error; el resto de las funciones
 * (normalizar, armar el envío, rebasar un borrador) las agrega la línea de
 * autoguardado sobre este mismo archivo.
 */

/**
 * Códigos que el servidor adjunta a un rechazo permanente (`data.code`). Sin
 * ellos el cliente solo ve un texto y no puede distinguir un conflicto de
 * versión —que se arregla recuperando— de un error que reintentar no corrige.
 */
export type InspectionErrorCode =
  | "version_conflict"
  | "not_editable"
  | "evidence_guard"
  | "invalid_row"
  | "not_ready"

const ERROR_CODES: readonly InspectionErrorCode[] = [
  "version_conflict",
  "not_editable",
  "evidence_guard",
  "invalid_row",
  "not_ready",
]

/** Lee `data.code` de un resultado de acción; `null` si no trae uno conocido. */
export function saveErrorCodeOf(result: { ok: boolean; data?: Record<string, unknown> } | null | undefined): InspectionErrorCode | null {
  if (!result || result.ok) return null
  const code = result.data?.code
  return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code)
    ? (code as InspectionErrorCode)
    : null
}

/** Estado de guardado que la pantalla muestra, una sola fuente para escritorio y móvil. */
export type CaptureSaveState =
  | { kind: "saved"; heldCount: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "retrying" }
  | { kind: "conflict" }
  | { kind: "not_editable" }
  | { kind: "rejected"; message: string }
  | { kind: "closing" }
  | { kind: "queued_close" }

/**
 * Fila que se queda en el dispositivo sin enviarse: o es inválida (falta un
 * motivo) o se limpió a «Sin responder» teniendo fotos, que el servidor no
 * permite dejar sin respuesta.
 */
export interface HeldRow {
  key: string
  reason: "invalid" | "unanswer_with_photos"
  problem: string
}
