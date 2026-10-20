import type { FollowupRecord } from "./stages/seguimiento/model"
import type { Re20PublicData, Re20SensitivePayload } from "@/lib/services/prevention-incident-re20-schema"
import type { Re20SlaPolicy } from "@/lib/prevention/incidents"

/* Tipos compartidos del expediente RE-20. Cada etapa (`stages/<id>.tsx`) trabaja
 * sobre estos tipos y sobre la API de `useRe20Workspace`; ninguna define los suyos. */

/** Datos públicos del expediente, tal como los valida el servidor (`re20PublicDataSchema`). */
export type Re20Data = Re20PublicData
/** Datos reservados (declaraciones, entrevista, DIAT, detalle clínico) sin el propósito de acceso. */
export type Re20Sensitive = Omit<Re20SensitivePayload, "purpose">
export type Re20Task = Re20Data["tasks"][number]

export type Re20StageId = "preliminar" | "declaraciones" | "diat" | "investigacion" | "calidad" | "difusion" | "seguimiento"

export interface Re20Incident {
  id: string
  code: string
  companyName: string
  location: string
  occurredAt: string
  knownAt: string
  /** Potencial del reporte: con «grave o fatal» el árbol es obligatorio también en cuasi accidentes. */
  potentialSeverity?: string | null
  status: string
  actualSeverity: string
  eventType: string
  isFatalOrSerious: boolean
  worksiteName: string
  version: number
}

/** Persona elegible como integrante, responsable o verificador: siempre nombre y cargo, nunca sólo un ID. */
export interface Re20Person {
  id: string
  name: string
  position: string | null
}

/** Persona registrada en el reporte inicial (accidentado, testigo…), sin datos reservados. */
export interface Re20InvolvedPerson {
  id: string
  displayLabel: string
  relationshipType: string
  employerName: string | null
}

export interface Re20CatalogOption {
  category: string
  code: string
  name: string
  isActive: boolean
  sortOrder?: number | null
}

export interface Re20QualityReview {
  id: string
  workspaceVersion: number
  criteria: Array<{ id: string; result: "meets" | "partial" | "does_not_meet"; observation?: string }>
  decision: string
  observation: string | null
  reviewerRole: string
  reviewedAt: string
  reviewerUserId?: string
  /** Nombre de quien revisó; el rol sólo dice si fue en reemplazo de la Jefa Dpto. */
  reviewerName?: string | null
}

export interface Re20DiffusionRecord {
  id: string
  kind: "shift" | "corrective_measures"
  summary: string
  status: "pending_confirmation" | "confirmed"
  markedAt: string
  confirmedAt?: string | null
  /** Quien la marcó no puede confirmarla: el servidor lo verifica por persona. */
  markedByUserId?: string
  markedByName?: string | null
  confirmedByName?: string | null
}

/** ONE PAGE (RE-20-06) ya publicados, de la tabla canónica de difusión. */
export interface Re20OnePageDiffusion {
  id: string
  diffusedAt: string
  createdByName: string | null
}

export interface Re20NotificationLane {
  notificationType: string
  status: string
  deadlineAt: string | null
  sentAt: string | null
  evidenceReference: string | null
}

export interface Re20CapaLink {
  id: string
  code: string
  status: string
}

export interface Re20LegacyInvestigation {
  methodology: string
  preliminaryReportText: string | null
  preliminaryReportAt: string | null
  conclusions: string | null
  immediateCauses: string[]
  basicCauses: string[]
  organizationalCauses: string[]
}

export interface Re20Permissions {
  /** Editar el expediente. Sin él (o con el caso cerrado) todo queda de sólo lectura. */
  canInvestigate: boolean
  /** Ver y editar datos reservados (con propósito) y adjuntar anexos. */
  canSensitive: boolean
  /** Registrar la presentación de la DIAT y otros avisos legales. */
  canNotify: boolean
  /** Registrar la revisión de calidad RE-20-13. */
  canReview: boolean
  /** Administrar catálogos y plazos (fuera del caso). */
  canConfigure: boolean
  /** Confirmar difusiones marcadas. */
  canConfirmDiffusion: boolean
}

export interface Re20WorkspaceSnapshot {
  version: number
  data: Record<string, unknown>
  updatedAt: string
  /** Nombre de quien guardó la versión del servidor, para el diálogo de conflictos. */
  updatedByName?: string | null
}

export interface Re20OfflineAttachment {
  id: string
  fileName: string
  mimeType: string
  size: number
  contentBase64: string
}

export interface Re20Conflict {
  /** Sección de primer nivel de `Re20Data` («preliminary», «measures»…). */
  section: string
  base: unknown
  local: unknown
  remote: unknown
  choice?: "local" | "remote"
}

export interface Re20WorkspaceProps {
  /** Hora del render en el servidor: la primera pintura del cliente usa la misma para que los plazos relativos no rompan la hidratación. */
  renderedAt?: string
  /** Seguimientos RE-20-08/09 registrados (tabla canónica). */
  followups?: FollowupRecord[]
  onePageDiffusions?: Re20OnePageDiffusion[]
  incident: Re20Incident
  workspace: Re20WorkspaceSnapshot | null
  policy: Re20SlaPolicy
  options: Re20CatalogOption[]
  qualityReviews: Re20QualityReview[]
  legacyInvestigation: Re20LegacyInvestigation | null
  sensitivePayload: Record<string, unknown> | null
  sensitiveLoadError: string | null
  permissions: Re20Permissions
  currentUser: { id: string; name: string }
  /** Dueño de la bóveda local (el usuario de la sesión, o el perfil elegido sin conexión). */
  userId: string
  /** Personas elegibles para equipo, responsables y verificadores (nombre y cargo). */
  people: Re20Person[]
  /** Personas del reporte inicial. */
  involvedPeople: Re20InvolvedPerson[]
  diffusions: Re20DiffusionRecord[]
  notifications: Re20NotificationLane[]
  capa: Re20CapaLink[]
  /** Propósito de acceso reservado vigente (de la URL). */
  initialPurpose: string
  /** Etapa abierta al cargar (`?etapa=`). */
  initialStage?: string | null
  /** Pantalla pública sin conexión: nada se envía al servidor. */
  offlineOnly?: boolean
  initialLocalDraft?: Re20LocalDraft | null
}

/** Copia cifrada del expediente en la bóveda del dispositivo. Compatible con los borradores ya guardados. */
export interface Re20LocalDraft {
  incidentId: string
  baseVersion: number
  baseData: Record<string, unknown>
  data: Record<string, unknown>
  sensitive?: Re20Sensitive
  baseSensitive?: Re20Sensitive
  sensitiveConflict?: { local: Re20Sensitive; remote: Re20Sensitive }
  attachments: Re20OfflineAttachment[]
  conflicts?: Re20Conflict[]
  remoteVersion?: number
  remoteData?: Record<string, unknown>
  /** Antes sólo la revisión de calidad; ahora cualquier borrador de etapa (`ws.extras`). */
  qualityCriteria?: unknown
  extras?: Record<string, unknown>
  context: {
    incident: Re20Incident
    policy: Re20SlaPolicy
    options: Re20CatalogOption[]
    qualityReviews: Re20QualityReview[]
    legacyInvestigation: Re20LegacyInvestigation | null
    diffusions: Re20DiffusionRecord[]
    notifications: Re20NotificationLane[]
    capa: Re20CapaLink[]
    currentUser: { id: string; name: string }
    people?: Re20Person[]
    involvedPeople?: Re20InvolvedPerson[]
    canSensitive: boolean
    canNotify: boolean
    canReview: boolean
    canConfirmDiffusion: boolean
  }
  savedAt: string
}
