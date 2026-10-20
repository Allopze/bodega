/**
 * Tipos compartidos y helpers sin JSX del catálogo de plantillas y de la
 * programación de inspecciones. Vivían en el antiguo archivo único del catálogo;
 * ahora los consumen `plantillas/_components/*`, `programacion/_components/*` y
 * las páginas que arman estos datos.
 */

export interface Coverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  criticalityInert: boolean
}

export interface TemplateItem {
  id: string
  code: string
  versionLabel: string
  name: string
  kind: string
  status: string
  /** Si es `superseded` y nadie la reemplazó, fue retirada a propósito: se llama «Retirada». */
  supersededByTemplateId: string | null
  authorUserId: string
  version: number
  coverage: Coverage
  /** Actividades del PDTP (campo `n`) que acredita al completarse un run. */
  pdtpActivityNumbers: number[] | null
  /** Actividades que acredita al REVISARSE (la firma, no la ejecución). */
  pdtpReviewActivityNumbers: number[] | null
  /**
   * Lo que acredita hoy, ya resuelto con la regla del servidor (los vínculos del
   * catálogo ganan sobre los números) y con las etiquetas armadas. La tabla y el
   * diálogo leen de acá: antes cada uno leía una fuente distinta.
   */
  pdtpAccreditation: {
    source: "catalog" | "numbers" | "none"
    executeSource: "catalog" | "numbers" | "none"
    reviewSource: "catalog" | "numbers" | "none"
    execute: string[]
    review: string[]
  }
  /** Identidades con que se precarga el diálogo de acreditación, por eje. */
  pdtpPreloadExecuteIds: string[]
  pdtpPreloadReviewIds: string[]
  /** Números que acreditan por número y no tienen actividad en el catálogo corporativo. */
  pdtpUnmappedNumbers: { execute: number[]; review: number[] }
  /** Desviaciones que este instrumento ofrece al registrar, con su gravedad. */
  deviations: DeviationEntry[]
  /** Desviaciones registradas como "Otra" que aún no están en el catálogo. */
  unclassifiedDeviations: { description: string; criticality: string; occurrences: number }[]
  /** El instrumento registra desviaciones (el catálogo de desviaciones sólo tiene sentido ahí). */
  recordsDeviations: boolean
  /** Definición de `lib/sst/definitions` de la que salió el snapshot. */
  sourceDefinitionCode: string | null
  /** Quién es el ejecutante de registro (D04). */
  executorOfRecord: string
  /** El catálogo en código difiere del snapshot congelado (A-03). */
  definitionDrifted: boolean
  /** La definición de origen ya no existe en el catálogo en código. */
  definitionMissing: boolean
  provenanceKind: string
  /** Transcribe un anexo oficial: no puede aprobarse sin su planilla vinculada. */
  needsOfficialSource: boolean
  /** Checksum del archivo oficial, para ofrecer sólo el que coincide. `null` si no se conoce. */
  officialChecksumSha256: string | null
  sourceDocumentVersionId: string | null
  sourceSnapshot: { documentId: string; versionId: string; fileName: string; revision: string | null; effectiveFrom: string | null; checksumSha256: string } | null
  parityReport: { status: string; differences: string[] } | null
  contentHash: string
}

export interface DocumentSourceOption {
  id: string
  documentId: string
  documentCode: string | null
  documentTitle: string
  fileName: string
  checksumSha256: string
  status: string
  effectiveFrom: string | null
}

export function isOfficialProvenance(value: string) {
  return value === "official_document"
}

export function parityStatusLabel(status: string | undefined) {
  if (status === "passed") return "Paridad aprobada"
  if (status === "failed") return "Con diferencias"
  return "Paridad pendiente"
}

/**
 * Una entrada del catálogo maestro, vista desde un instrumento.
 *
 * Trae el maestro entero —no sólo lo que el instrumento ofrece— porque el
 * diálogo es un selector: hay que poder marcar lo que todavía no está.
 */
export interface DeviationEntry {
  id: string
  label: string
  /** La gravedad que propone el maestro. */
  danoPotencial: string
  /** Si el maestro la tiene vigente. Retirarla ahí la apaga en todos lados. */
  isActive: boolean
  /** La criticidad que produciría con la gravedad del maestro. */
  criticality: string
  /** Si este instrumento la ofrece a quien registra en terreno. */
  selected: boolean
  /** Gravedad propia de este instrumento; null = hereda la del maestro. */
  danoPotencialOverride: string | null
  /** La que se aplica realmente al registrar acá. */
  effectiveDano: string
  effectiveCriticality: string
}

export interface ProgramItem {
  id: string
  templateId: string
  worksiteId: string
  templateName: string
  worksiteName: string
  frequency: string
  intervalDays: number
  nextDueOn: string
  assignedToUserId: string | null
  assigneeName: string | null
  riskEntryId: string | null
  riskLabel: string | null
  subjectType: string | null
  /** Nombre del sujeto del inventario elegido (recurso, equipo o contenedor), si hay uno. */
  subjectLabel: string | null
  /** Sujeto del inventario; excluyente con `subjectVehicleId` (INS-04). */
  subjectResourceId: string | null
  subjectVehicleId: string | null
  subjectContainerId: string | null
  /** Define si esta programación exige contenedor del catálogo. */
  templateDefinitionCode: string | null
  isActive: boolean
  /** I-04: la plantilla puede haber quedado `superseded` desde que se creó el programa. */
  templateApproved: boolean
  version: number
}

export interface ImportableDefinition {
  code: string
  title: string
  version: string
  sections: number
  items: number
  coverage: Coverage
  /** Actividades del PDTP que acreditará al ejecutarse (cableado del programa). */
  pdtpActivities: { n: number; name: string }[]
  /** Tipo con que debe nacer: una auditoría no entra como inspección. */
  defaultKind: string
  /** Transcribe un anexo oficial: la fuente documental es obligatoria para poder aprobarla. */
  needsOfficialSource: boolean
  /** Checksum del anexo oficial, para preseleccionar en la Biblioteca el archivo que coincide. */
  officialChecksumSha256: string | null
}

export interface PdtpActivityOption { n: number; name: string; year: number }

export function templateStatusVariant(status: string): "default" | "success" | "outline" {
  if (status === "approved") return "success"
  if (status === "superseded") return "outline"
  return "default"
}

export function coverageLabel(coverage: Coverage) {
  return `${coverage.withDanoPotencial}/${coverage.totalItems} con gravedad`
}
