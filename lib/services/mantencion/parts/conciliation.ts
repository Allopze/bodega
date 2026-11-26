import type { MantViewer } from "@/lib/services/mantencion/access"
import type { ConciliateInput, PartsActionResult, PendingConciliationRow } from "./types"

/**
 * Conciliación de líneas de registro que quedaron «pendiente de conciliar» (faltó
 * stock al sincronizar). Stubs de la Fase 0 con la firma acordada: los implementa
 * la línea L4.
 */

export async function conciliatePart(viewer: MantViewer, input: ConciliateInput): Promise<PartsActionResult> {
  void viewer
  void input
  throw new Error("conciliatePart: pendiente (línea L4)")
}

export async function listPendingConciliation(viewer: MantViewer, filters: { worksiteId?: string; page?: number; pageSize?: number }): Promise<{ rows: PendingConciliationRow[]; total: number }> {
  void viewer
  void filters
  throw new Error("listPendingConciliation: pendiente (línea L4)")
}
