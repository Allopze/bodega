import type { PreventiveRef } from "@/lib/mantencion/status"
import type { MantExecutorKind, MantItemValue, MantPhotoKind } from "@/lib/mantencion/types"
import type { SyncWarning } from "@/lib/mantencion/contracts"
import type { MantViewer } from "./access"
import type { VehicleContext } from "./records-create-context"

/**
 * Tipos compartidos de la creación de un registro (validación e inserción).
 */

/**
 * Un RECHAZO definitivo del envío. 422 = el registro no cumple una regla
 * (queda «Rechazado» en el teléfono con el motivo, nunca se pierde); 409 = faltan
 * fotos (la app las vuelve a subir) o el identificador pertenece a otra persona.
 */
export interface RecordFailure {
  ok: false
  status: 409 | 422
  code: "rejected" | "invalid" | "missing_photos"
  message: string
  field?: string
}

export const reject = (message: string, field?: string): RecordFailure => ({ ok: false, status: 422, code: "rejected", message, field })
export const invalid = (message: string, field?: string): RecordFailure => ({ ok: false, status: 422, code: "invalid", message, field })

export type Validated<T> = { ok: true; value: T } | RecordFailure

export interface Author {
  userId: string
  name: string
  viewer: MantViewer
}

export interface PlanItem {
  itemKey: string
  groupName: string
  itemName: string
  sortOrder: number
  value: MantItemValue
  reason: string | null
  manufacturerWarning: boolean
}

export interface PreventivePlan {
  scheduleId: string
  scheduleVersion: number
  scheduleName: string
  intervalValue: number
  suggestedIntervalValue: number
  manualScheduleReason: string | null
  notes: string
  items: PlanItem[]
  duplicateOf: PreventiveRef | null
}

export interface CorrectivePlan {
  /** Nombres (snapshot), no ids: un catálogo editado después no cambia el documento firmado. */
  workTypes: string[]
  oils: string[]
  description: string
  noParts: boolean
  hours: number
  inWorkshop: boolean
  entryDate: string | null
  workOrder: string | null
  parts: Array<{ quantity: number; description: string }>
  drivers: Array<{ id: string; name: string }>
}

/** Todo lo que `createRecord` inserta, ya validado y con los snapshots resueltos. */
export interface RecordPlan {
  vehicle: VehicleContext
  outOfWorksite: boolean
  readingJumpAlert: boolean
  executor: { kind: MantExecutorKind; userId: string | null; workshopId: string | null; name: string }
  preventive: PreventivePlan | null
  corrective: CorrectivePlan | null
  /** Fotos en el orden del envío. */
  photos: Array<{ id: string; kind: MantPhotoKind }>
  warnings: SyncWarning[]
}
