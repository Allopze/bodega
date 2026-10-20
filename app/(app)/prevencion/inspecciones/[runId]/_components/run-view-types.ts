import type {
  assessRunCompletion,
  ClosingActSpec,
  InspectionItemSpec,
  summarizeCompliance,
} from "@/lib/prevention/inspections"
import type { summarizeCompletion } from "@/lib/prevention/inspection-capture"
import type { InspectionDraftApi } from "../_hooks/use-inspection-draft"
import type { useInspectionSaveChannel } from "../_hooks/use-inspection-save-channel"
import type { useGeolocation } from "../_hooks/use-geolocation"
import type { AnswerInfo, FindingInfo, RunDocumentInfo, RunInfo, SectionInfo } from "./types"

/**
 * El modelo que `InspectionRunDetail` arma una vez y entrega a UNA de las dos
 * vistas: `RunCaptureView` (se puede editar) o `RunReadView` (lectura y
 * revisión). Reúne lo que las vistas necesitan y nada más:
 *
 *   - lo que la pantalla recibe por props (run, secciones, permisos…);
 *   - el borrador y el canal de guardado, que siguen teniendo UN solo dueño
 *     cada uno (`useInspectionDraft`, `useInspectionSaveChannel`): las vistas
 *     los usan, no los reemplazan;
 *   - lo derivado de ellos (avance, bloqueos, qué botones aplican);
 *   - los manejadores compartidos.
 *
 * Es sólo un contenedor: no hay lógica aquí. Cada subcomponente declara con
 * `Pick<RunViewModel, …>` qué campos lee, así que agregar un campo nuevo es
 * aditivo y no obliga a tocar a los demás.
 */

/** Lo que dice `assessRunCompletion`: si se puede declarar ejecutada y qué lo impide. */
export type RunCompletion = ReturnType<typeof assessRunCompletion>
/** Cumplimiento calculado sobre lo que hay en pantalla (no el del servidor). */
export type RunComplianceSummary = ReturnType<typeof summarizeCompliance>
/** Una línea de «Para declarar ejecutada falta». */
export type RunPendingLine = ReturnType<typeof summarizeCompletion>["lines"][number]
/** El canal de guardado: lo único que habla con el servidor. */
export type RunSaveChannel = ReturnType<typeof useInspectionSaveChannel>
/** La captura de ubicación. */
export type RunGeolocation = ReturnType<typeof useGeolocation>

export interface RunParticipantInfo {
  id: string
  name: string
  position: string
  userId: string | null
}

export interface RunDeviationCatalogEntry {
  id: string
  label: string
  danoPotencial: string
  criticality: string
}

export interface RunViewModel {
  /* ── Lo que la pantalla recibe ─────────────────────────────────────────── */
  run: RunInfo
  templateKind: string
  worksiteName: string
  assigneeName: string | null
  executorName: string | null
  reviewerName: string | null
  sections: SectionInfo[]
  /** Los ítems de todas las secciones, aplanados y con `sectionId`/`itemId`. */
  items: InspectionItemSpec[]
  /** Lo que el servidor tiene guardado; para lo editable manda el borrador. */
  answers: AnswerInfo[]
  findings: FindingInfo[]
  documents: RunDocumentInfo[]
  closingAct: ClosingActSpec | null
  recordsDeviations: boolean
  recordsPreventiveActions: boolean
  deviationCatalog: RunDeviationCatalogEntry[]
  isUnplannedInspection: boolean
  participants: RunParticipantInfo[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  /** Quién puede cerrarla en esta faena (I-08). */
  reviewers: { id: string; name: string }[]
  pdtpActivityNumbers: number[]
  pdtpReviewActivityNumbers: number[]
  /** Reporte de Equipos: el papel es el insumo que el jefe de faena transcribe. */
  physicalSourceRequired: boolean

  /* ── Permisos ──────────────────────────────────────────────────────────── */
  canExecute: boolean
  canReview: boolean
  canManage: boolean
  canRequestRecharge: boolean
  canStopVehicle: boolean
  canIngest: boolean

  /* ── Qué modo y qué acciones aplican ───────────────────────────────────── */
  /** `canExecute` y estado `planned`/`in_progress`: elige la vista. */
  editable: boolean
  /** Completada, con permiso de revisión y sin ser quien la ejecutó (#47). */
  canCurrentUserReview: boolean
  /** Completada y quien mira la ejecutó: no puede cerrarla (I-08). */
  reviewBlocked: boolean
  /** Lo anterior, y además tiene el permiso: cambia sólo el texto. */
  selfReviewBlocked: boolean
  /** Hay barra fija en el teléfono: reserva el espacio al pie de la pantalla. */
  showMobileActionBar: boolean
  /** Hay hallazgos que mostrar: la inspección ya se declaró ejecutada o revisada. */
  showFindings: boolean

  /* ── Borrador y canal de guardado ──────────────────────────────────────── */
  inspectionDraft: InspectionDraftApi
  /** Atajos al borrador, para no escribir `inspectionDraft.x` en cada vista. */
  drafts: InspectionDraftApi["drafts"]
  closing: InspectionDraftApi["closing"]
  coords: InspectionDraftApi["coords"]
  channel: RunSaveChannel
  geo: RunGeolocation

  /* ── Derivados ─────────────────────────────────────────────────────────── */
  completion: RunCompletion
  summary: RunComplianceSummary
  /** Respuestas ya normalizadas (las que el servidor va a ver). */
  answeredCount: number
  /** Los obligatorios efectivos: el mismo conjunto que exige el cierre (I-02). */
  requiredItems: InspectionItemSpec[]
  /** `sectionId::itemId` de cada obligatorio efectivo (L4). */
  requiredKeys: ReadonlySet<string>
  answeredRequired: number
  /** Lo que falta para declarar ejecutada, sin las filas retenidas (P2-1). */
  pendingLines: RunPendingLine[]
  /** Filas retenidas en el dispositivo, por clave de ítem. */
  heldByKey: ReadonlyMap<string, RunSaveChannel["held"][number]>
  /** Motivo del rechazo de un cierre guardado, si el servidor lo rechazó. */
  rejection: string | null

  /* ── Manejadores ───────────────────────────────────────────────────────── */
  /** Salta al ítem (`sectionId::itemId`) y enfoca su primer control. */
  jumpToItem: (key: string) => void
}
