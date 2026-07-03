export type SstDocumentStatus =
  | "borrador" | "en_revision" | "observado" | "aprobado"
  | "vigente" | "vencido" | "reemplazado" | "archivado"

export type SstDocumentConfidentiality =
  | "publico_interno" | "restringido" | "sensible"

export interface DashboardCounters {
  total: number
  byStatus: Record<SstDocumentStatus, number>
  expiringSoon: { within7: number; within15: number; within30: number }
  pendingReview: number
  observed: number
  ackPending: number
}

export interface ExpiringDocument {
  id: string
  title: string
  internalCode: string | null
  status: SstDocumentStatus
  expiresAt: string | null
  daysRemaining: number | null
  worksiteId: string | null
  categorySlug: string
  responsibleUserId: string | null
}

export interface DocumentExportRow {
  categoria: string
  tipo: string
  codigo: string
  titulo: string
  estado: string
  confidencialidad: string
  faena: string | null
  responsable: string | null
  subidoPor: string | null
  aprobadoPor: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  diasParaVencer: number | null
  versionVigente: number | null
  requiereAcuse: string
  actualizado: string
}

export interface FolderBreadcrumbItem {
  id: string
  name: string
}
