import type { SyncPartsNote, SyncPartsNoteResponse } from "@/lib/mantencion/contracts"
import type { SyncContext } from "@/lib/services/mantencion/sync-auth"

/**
 * Alta de una nota de pedido desde el teléfono (`POST /api/mantencion/sync/notas-pedido`).
 * Stub de la Fase 0 con la firma acordada: lo implementa la línea L3.
 */
export async function createPartsNoteFromDevice(payload: SyncPartsNote, context: SyncContext): Promise<{ status: number; body: SyncPartsNoteResponse }> {
  void payload
  void context
  throw new Error("createPartsNoteFromDevice: pendiente (línea L3)")
}
