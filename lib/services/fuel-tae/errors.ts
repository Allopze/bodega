/**
 * Rechazo de negocio de una carga en terreno. Se responde 422 con un mensaje
 * pensado para el operador (qué pasó y cómo corregirlo), distinto de un 400 por
 * carga mal formada o de un acceso no autorizado.
 */
export type TaeRejectionCode =
  | "meter_regression"
  | "reading_required"
  | "over_capacity"
  | "invalid_liters"
  | "filler_seal"
  | "seal_reason_required"
  | "evidence_missing"
  | "invalid_time"
  | "invalid_medium"

export class TaeSubmissionRejected extends Error {
  readonly status = 422
  constructor(message: string, readonly code: TaeRejectionCode, readonly field?: string) {
    super(message)
    this.name = "TaeSubmissionRejected"
  }
}

/** Detecta el rechazo por forma, por si conviven dos copias del módulo. */
export function isTaeSubmissionRejected(error: unknown): error is TaeSubmissionRejected {
  return error instanceof Error && error.name === "TaeSubmissionRejected" && (error as { status?: unknown }).status === 422
}
