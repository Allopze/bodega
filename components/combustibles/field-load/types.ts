import type { TaeAccessConfig } from "@/lib/services/fuel-tae/types"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import type { QueuedTaeEvidence } from "@/lib/pwa/tae-offline-queue"

export type FieldLoadConfig = TaeAccessConfig

export type FieldLoadStep = "vehicle" | "meter" | "liters" | "seals" | "people" | "review"

export const FIELD_LOAD_STEPS: ReadonlyArray<{ id: FieldLoadStep; title: string }> = [
  { id: "vehicle", title: "Equipo" },
  { id: "meter", title: "Medidor" },
  { id: "liters", title: "Litros" },
  { id: "seals", title: "Sellos" },
  { id: "people", title: "Personas" },
  { id: "review", title: "Revisar y enviar" },
]

/** Lo que el operador va contestando. Los números viajan como texto hasta enviar para respetar lo que escribió. */
export interface FieldLoadDraft {
  vehicleId: string
  productId: string
  supplyMediumId: string
  meterReading: string
  liters: string
  removedSealNumber: string
  installedSealNumber: string
  /** «No hay sello» marcado de forma explícita (el campo vacío solo no basta: hay que decir por qué). */
  noRemovedSeal: boolean
  noInstalledSeal: boolean
  noSealReason: string
  driverName: string
  supervisorName: string
  notes: string
}

export const EMPTY_DRAFT: FieldLoadDraft = {
  vehicleId: "",
  productId: "",
  supplyMediumId: "",
  meterReading: "",
  liters: "",
  removedSealNumber: "",
  installedSealNumber: "",
  noRemovedSeal: false,
  noInstalledSeal: false,
  noSealReason: "",
  driverName: "",
  supervisorName: "",
  notes: "",
}

export type FieldLoadPhotos = Partial<Record<TaeEvidenceKind, File>>

export type SubmitOutcome =
  /** `detail` es lo que el anfitrión quiera mostrar en su pantalla final (`renderSent`); el formulario no lo mira. */
  | { kind: "sent"; href?: string; detail?: unknown }
  | { kind: "queued" }
  | { kind: "rejected"; message: string; field?: string }
  /** El servidor pide confirmar antes de registrar (p. ej. una posible carga duplicada): se muestra el aviso y se puede seguir. */
  | { kind: "confirm"; message: string; link?: { href: string; label: string } }
  | { kind: "failed"; message: string }

/** Carga de otro día, tal como viaja en el payload: hora de pared de Chile (`2026-10-12T14:30`) y motivo. */
export interface FieldLoadPastLoad {
  loadedAt: string
  reason: string
}

/** Envía (o encola) una carga ya armada. La PWA pública usa la cola sin conexión; el registro autenticado envía directo. */
export type FieldLoadSubmitter = (payload: Record<string, unknown>, evidence: QueuedTaeEvidence[]) => Promise<SubmitOutcome>

export interface IdentityTransport {
  url: string
  body: (rut: string) => Record<string, unknown>
}
