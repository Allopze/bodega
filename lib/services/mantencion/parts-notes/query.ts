import type { MantViewer } from "@/lib/services/mantencion/access"
import type {
  PartsNoteDetail, PartsNoteListFilters, PartsNoteListRow, PartsNotePrefill, PartsNoteTab, WorkOrderPartsOverview,
} from "@/lib/services/mantencion/parts/types"

/**
 * Lecturas de notas de pedido (bandeja, detalle, prellenado de la solicitud y
 * sección «Repuestos» de la OT). Stubs de la Fase 0 con la firma acordada: los
 * implementa la línea L3.
 */

export async function listPartsNotes(viewer: MantViewer, filters: PartsNoteListFilters): Promise<{ rows: PartsNoteListRow[]; total: number; counts: Record<PartsNoteTab, number> }> {
  void viewer
  void filters
  throw new Error("listPartsNotes: pendiente (línea L3)")
}

export async function getPartsNote(viewer: MantViewer, noteId: string): Promise<PartsNoteDetail | null> {
  void viewer
  void noteId
  throw new Error("getPartsNote: pendiente (línea L3)")
}

export async function loadPartsNotePrefill(viewer: MantViewer, noteId: string): Promise<PartsNotePrefill | null> {
  void viewer
  void noteId
  throw new Error("loadPartsNotePrefill: pendiente (línea L3)")
}

export async function loadWorkOrderPartsOverview(viewer: MantViewer, workOrderId: string): Promise<WorkOrderPartsOverview> {
  void viewer
  void workOrderId
  throw new Error("loadWorkOrderPartsOverview: pendiente (línea L3)")
}
