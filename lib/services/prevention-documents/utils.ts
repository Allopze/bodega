import { and, desc, eq, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm"
import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import { join, extname } from "node:path"
import { db } from "@/db"
import {
  sstDocumentCategories,
  sstDocumentTypes,
  sstDocuments,
  sstDocumentVersions,
  sstDocumentLinks,
  sstDocumentAcknowledgments,
  sstDocumentAudit,
  users,
  worksites,
  workers,
  fuelVehicles,
  type SstDocument,
  type SstDocumentVersion,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { resolveSstDocumentFile, resolveSstDocumentsDir, createSstDocumentPath } from "@/lib/storage/config"
import { validateFileBuffer, MimeType, type MimeTypeSet } from "@/lib/file-validation"
import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentVersionCreateSchema,
  sstDocumentStatusChangeSchema,
  sstDocumentVersionStatusChangeSchema,
  sstDocumentApproveSchema,
  sstDocumentObserveSchema,
  sstDocumentArchiveSchema,
  sstDocumentLinkSchema,
  sstDocumentUnlinkSchema,
  sstDocumentAckSchema,
  sstDocumentSearchSchema,
  sstDocumentCategoryUpsertSchema,
  sstDocumentTypeUpsertSchema,
  SST_DOCUMENT_LINK_ENTITY_TYPES,
  type SstDocumentSearchInput,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import { recordAudit, recordStatusChange } from "@/lib/audit"

const ALLOWED_MIMES: MimeTypeSet = MimeType.INVOICE
export const MAX_FILE_SIZE = 25 * 1024 * 1024
export const EXPIRY_ALERT_THRESHOLDS = [30, 15, 7] as const

export type SstDocumentStatus =
  | "borrador" | "en_revision" | "observado" | "aprobado"
  | "vigente" | "vencido" | "reemplazado" | "archivado"

export type SstDocumentConfidentiality =
  | "publico_interno" | "restringido" | "sensible"

type SstDocumentLinkEntityType = (typeof SST_DOCUMENT_LINK_ENTITY_TYPES)[number]

export interface UploadInput {
  documentId: string
  file: File | { name: string; type: string; size: number; buffer: Uint8Array }
  effectiveFrom?: string
  effectiveTo?: string
  changelog?: string
  supersedesId?: string
}

export type DocumentWithCurrent = SstDocument
export type DocumentVersionRow = SstDocumentVersion

export interface RequestContext {
  userId: string
  userEmail?: string
  ip?: string
  userAgent?: string
}

export interface CreateDocumentInput {
  data: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}

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

export function assertScopeAccess(worksiteId: string | null, scope: WorksiteScope) {
  if (scope.mode === "all") return
  if (!worksiteId) {
    throw new Error("El documento no tiene faena asignada; requiere alcance global.")
  }
  if (scope.mode === "none" || !scope.ids.includes(worksiteId)) {
    throw new Error("Documento no encontrado o sin acceso a la faena.")
  }
}

export function assertConfidentialityAllowed(
  confidentiality: SstDocumentConfidentiality,
  userPermissions: readonly string[],
) {
  if (confidentiality === "publico_interno") return
  if (confidentiality === "sensible" && !userPermissions.includes("prevention:docs:manage_sensitive")) {
    throw new Error("No tienes permisos para gestionar documentos sensibles.")
  }
  if (confidentiality === "restringido" && !userPermissions.includes("prevention:docs:manage_restricted")) {
    throw new Error("No tienes permisos para gestionar documentos restringidos.")
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null
  const target = new Date(`${dateIso}T00:00:00Z`).getTime()
  if (Number.isNaN(target)) return null
  const now = Date.now()
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24))
}

export function effectiveStatus(
  docStatus: SstDocumentStatus,
  expiresAt: string | null | undefined,
): SstDocumentStatus {
  if (docStatus === "vigente" && expiresAt) {
    const d = daysUntil(expiresAt)
    if (d !== null && d < 0) return "vencido"
  }
  return docStatus
}

export function generateStorageName(originalName: string): string {
  const ext = extname(originalName).toLowerCase()
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ""
  return `${nanoid(20)}${safeExt}`
}

export function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex")
}

export async function readFileToBuffer(
  file: File | { name: string; type: string; size: number; buffer: Uint8Array }
): Promise<{ name: string; type: string; size: number; buffer: Uint8Array }> {
  if ("buffer" in file) {
    return { name: file.name, type: file.type, size: file.size, buffer: file.buffer }
  }
  const buffer = new Uint8Array(await file.arrayBuffer())
  return { name: file.name, type: file.type, size: file.size, buffer }
}

export async function persistFileOnDisk(
  storageName: string,
  buffer: Uint8Array,
): Promise<string> {
  const dir = resolveSstDocumentsDir()
  await mkdirp(dir)
  const absolutePath = join(dir, storageName)
  await writeBuffer(absolutePath, Buffer.from(buffer))
  return createSstDocumentPath(storageName)
}

export async function recordAuditEntry(args: {
  documentId: string
  versionId?: string | null
  userId?: string | null
  userEmail?: string
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  comment?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
}) {
  const now = new Date().toISOString()
  await db.insert(sstDocumentAudit).values({
    id: `sda-${nanoid()}`,
    documentId: args.documentId,
    versionId: args.versionId ?? null,
    userId: args.userId ?? null,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    action: args.action,
    comment: args.comment ?? null,
    metadata: args.metadata ?? null,
    ip: args.ip ?? null,
    createdAt: now,
  })
}
