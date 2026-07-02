import type { Badge } from "@/components/ui/badge"

export interface DocumentBundle {
  doc: {
    id: string
    title: string
    description: string | null
    internalCode: string | null
    categorySlug: string
    status: string
    confidentiality: string
    worksiteId: string | null
    effectiveFrom: string | null
    expiresAt: string | null
    currentVersionId: string | null
    requiresAcknowledgment: boolean
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    responsibleUserId: string | null
    tags: unknown
    updatedAt: string
  }
  versions: Array<{
    id: string
    version: number
    status: string
    fileName: string
    filePath: string
    fileSize: number
    mimeType: string
    checksum: string
    effectiveFrom: string | null
    effectiveTo: string | null
    changelog: string | null
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    approvedAt: string | null
    createdAt: string
  }>
  links: Array<{
    id: string
    entityType: string
    entityId: string
    notes: string | null
  }>
  acks: Array<{
    id: string
    versionId: string
    userId: string
    signature: string
    acknowledgedAt: string
  }>
  audit: Array<{
    id: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    comment: string | null
    userId: string | null
    versionId: string | null
    createdAt: string
  }>
}

export interface DetailViewProps {
  bundle: DocumentBundle
  userMap: Record<string, { id: string; name: string; email: string }>
  worksiteMap: Record<string, { id: string; name: string }>
  linkEnrichment: Record<string, Record<string, string>>
  canManage: boolean
  canApprove: boolean
  canArchive: boolean
  canAck: boolean
  canLink: boolean
  currentUserId: string
  currentUserName: string
}

export const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

export const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "outline"> = {
  borrador: "default",
  en_revision: "info",
  observado: "warning",
  aprobado: "info",
  vigente: "success",
  vencido: "danger",
  reemplazado: "outline",
  archivado: "outline",
}

export const LINK_TYPE_LABELS: Record<string, string> = {
  worker: "Trabajador",
  worksite: "Faena",
  vehicle: "Vehículo",
  equipment: "Equipo / maquinaria",
  incident: "Incidente / accidente",
  training: "Capacitación",
  committee: "Comité Paritario",
  epp_delivery: "Entrega EPP",
  corrective_action: "Acción correctiva",
  emergency_plan: "Plan de emergencia",
}
