/**
 * Política del recolector de evidencia huérfana, sin dependencias de servidor:
 * la ventana de gracia y el resumen acotado que devuelven las rutas HTTP.
 * Separada de `evidence-gc.ts` para que las rutas y sus pruebas la usen sin
 * cargar el acceso a la base ni al disco.
 */
import type { CleanupPdtpEvidenceOrphansResult } from "./evidence-gc"

/**
 * Ventana de gracia por omisión y mínima: 24 horas. W5-GC (T7a) la fijó en una
 * hora; la revisión final (2026-09-27) la subió porque en terreno se sube la
 * foto y se envía el formulario horas después (o al día siguiente, con señal),
 * y el barrido borraba ese upload antes del envío.
 */
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000
export const MIN_ORPHAN_AGE_LABEL = "24 horas"

/** Nombres que las respuestas HTTP muestran; la lista completa queda en `audit_log`. */
export const ORPHAN_SAMPLE_SIZE = 20

/**
 * Resumen acotado de un barrido para una respuesta HTTP: conteos y una muestra
 * de nombres. Con miles de huérfanos la lista completa no cabe en lo que lee
 * el runner (32 KiB) y tampoco sirve en pantalla.
 */
export function summarizeOrphanCleanup(result: CleanupPdtpEvidenceOrphansResult) {
  return {
    scanned: result.scanned,
    deleted: result.deleted,
    kept: result.kept,
    failed: result.failed,
    deletedSample: result.deletedNames.slice(0, ORPHAN_SAMPLE_SIZE),
  }
}
