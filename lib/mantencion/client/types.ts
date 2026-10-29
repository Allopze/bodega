import type {
  CatalogOtherEquipment,
  MantCatalog,
  ObservationReply,
  SyncRecord,
  SyncWarning,
  WorkshopUpdatePayload,
} from "../contracts"
import type { MantPhotoKind, MantUnit } from "../types"

/** Una cuenta que ya entró en este dispositivo (D7/D8). La credencial es del autor, no de la sesión. */
export interface DeviceAccount {
  userId: string
  name: string
  email: string
  /** Credencial de dispositivo (Bearer). Es un secreto: nunca se muestra ni se registra. */
  token: string
  expiresAt: string
  /** PBKDF2-SHA256 del PIN de 4 dígitos; `null` hasta que lo define. */
  pin: { hash: string; salt: string; iterations: number } | null
  pinFailures: number
  pinLockedUntil: number | null
  /** `needs_login`: la credencial venció o la revocaron; hay que entrar de nuevo para enviar. */
  status: "ok" | "needs_login"
  lastUsedAt: string
}

export interface StoredOthers {
  /** Valor tal cual del encabezado ETag, para `If-None-Match`. */
  etag: string | null
  version: string
  equipment: CatalogOtherEquipment[]
  fetchedAt: string
}

export interface StoredCatalog {
  userId: string
  etag: string | null
  catalog: MantCatalog
  fetchedAt: string
  others: StoredOthers | null
}

export type QueueStatus = "pending" | "sending" | "sent" | "rejected" | "needs_login"

interface QueueBase {
  id: string
  authorUserId: string
  status: QueueStatus
  attempts: number
  /** Epoch ms: no se reintenta antes de esta hora (backoff). */
  nextAttemptAt: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
}

export interface RecordSummary {
  kind: "P" | "C"
  vehicleId: string
  equipmentCode: string
  equipmentPlate: string
  unit: MantUnit
  intervalValue: number | null
  workDate: string
  reading: number
  inWorkshop: boolean
  workshopEntryDate: string | null
}

export interface QueueRecordItem extends QueueBase {
  type: "record"
  payload: SyncRecord
  summary: RecordSummary
  /** Los ids de fotos que el registro necesita; las fotos viven en el almacén `photos`. */
  photoIds: string[]
  folio: string | null
  receivedAt: string | null
  warnings: SyncWarning[]
  /** Motivo del rechazo definitivo (409/422): el registro queda «Rechazado» y se puede corregir. */
  rejection: { message: string; field: string | null } | null
}

export interface QueueWorkshopItem extends QueueBase {
  type: "workshop"
  payload: WorkshopUpdatePayload
  summary: { vehicleId: string; equipmentCode: string; equipmentPlate: string }
}

export interface QueueReplyItem extends QueueBase {
  type: "reply"
  payload: ObservationReply
  summary: { folio: string | null; equipmentCode: string }
}

export type QueueItem = QueueRecordItem | QueueWorkshopItem | QueueReplyItem

export interface StoredPhoto {
  id: string
  authorUserId: string
  kind: MantPhotoKind
  blob: Blob
  sha256: string
  width: number
  height: number
  stampedAt: string
  takenAtExif: string | null
  exif: Record<string, string> | null
  deviceId: string
  /** El servidor ya confirmó esta foto (PUT idempotente). No libera el Blob: eso sólo ocurre al confirmar el registro. */
  uploaded: boolean
  createdAt: string
}
