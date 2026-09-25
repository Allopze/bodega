import { createHash } from "node:crypto"
import { extname } from "node:path"
import { db, type DB } from "@/db"
import {
  sstDocumentAudit,
  type SstDocument,
  type SstDocumentVersion,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { createSstDocumentPath } from "@/lib/storage/config"
import { writeSstDocument } from "@/lib/storage/sst-backend"
import { type WorksiteScope } from "@/lib/auth/scope"
import { todayInChile } from "@/lib/utils"
import { buildFolderOptionLabels } from "./labels"
import { PreventionDocumentDomainError } from "./errors"

export type {
  SstDocumentStatus,
  SstDocumentConfidentiality,
  DashboardCounters,
  ExpiringDocument,
  FolderBreadcrumbItem,
} from "./types"
import type { SstDocumentStatus, SstDocumentConfidentiality, FolderBreadcrumbItem } from "./types"
export { buildFolderOptionLabels }

export const MAX_FILE_SIZE = 25 * 1024 * 1024
export const EXPIRY_ALERT_THRESHOLDS = [30, 15, 7] as const

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

export type GeneralLibraryDataClass =
  | "operational"
  | "personal"
  | "sensitive_preventive"
  | "clinical"
  | "reserved_investigation"
  | "client_secret"

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

export function normalizeFolderName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ")
  if (!normalized) throw new PreventionDocumentDomainError("Nombre de carpeta requerido.")
  return normalized
}

export function folderSlug(name: string): string {
  return normalizeFolderName(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "carpeta"
}

export function buildFolderHref(folderId: string | null | undefined): string {
  if (!folderId) return "/prevencion/documentacion"
  return `/prevencion/documentacion?folder=${encodeURIComponent(folderId)}`
}

export function buildFolderBreadcrumbs(path: FolderBreadcrumbItem[]) {
  return [
    { label: "Prevención", href: "/prevencion" },
    { label: "Documentación", href: path.length ? "/prevencion/documentacion" : undefined },
    ...path.map((folder, index) => ({
      label: folder.name,
      href: index === path.length - 1 ? undefined : buildFolderHref(folder.id),
    })),
  ]
}

export function canMoveFolder(args: {
  folderId: string
  targetParentId: string | null | undefined
  descendantIds: readonly string[]
}) {
  if (!args.targetParentId) return true
  if (args.targetParentId === args.folderId) return false
  return !args.descendantIds.includes(args.targetParentId)
}

export function assertScopeAccess(worksiteId: string | null, scope: WorksiteScope) {
  if (scope.mode === "all") return
  if (!worksiteId) {
    throw new PreventionDocumentDomainError("El documento no tiene faena asignada; requiere alcance global.")
  }
  if (scope.mode === "none" || !scope.ids.includes(worksiteId)) {
    throw new PreventionDocumentDomainError("Documento no encontrado o sin acceso a la faena.")
  }
}

export function assertConfidentialityAllowed(
  confidentiality: SstDocumentConfidentiality,
  userPermissions: readonly string[],
) {
  if (confidentiality === "publico_interno") return
  if (confidentiality === "sensible" && !userPermissions.includes("prevention:docs:manage_sensitive")) {
    throw new PreventionDocumentDomainError("No tienes permisos para gestionar documentos sensibles.")
  }
  if (confidentiality === "restringido" && !userPermissions.includes("prevention:docs:manage_restricted")) {
    throw new PreventionDocumentDomainError("No tienes permisos para gestionar documentos restringidos.")
  }
}

export function allowedDocumentConfidentialities(
  userPermissions: readonly string[],
): SstDocumentConfidentiality[] {
  const allowed: SstDocumentConfidentiality[] = ["publico_interno"]
  if (userPermissions.includes("prevention:docs:manage_restricted")) allowed.push("restringido")
  if (userPermissions.includes("prevention:docs:manage_sensitive")) allowed.push("sensible")
  return allowed
}

export function canReadDocumentConfidentiality(
  confidentiality: string,
  userPermissions: readonly string[],
): boolean {
  return allowedDocumentConfidentialities(userPermissions)
    .includes(confidentiality as SstDocumentConfidentiality)
}

const PROHIBITED_GENERAL_LIBRARY_PATTERNS = [
  /\bficha clinica\b/,
  /\bdiagnostico medico\b/,
  /\bresultado (de )?examen\b/,
  /\bresultado (de )?test (de )?(alcohol|droga)/,
  /\bcaso ley karin\b/,
  /\bdeclaracion (de )?testigo\b/,
] as const

export function assertGeneralLibraryContentAllowed(args: {
  dataClass?: string | null
  title?: string | null
  fileName?: string | null
}) {
  const dataClass = args.dataClass || "operational"
  if (dataClass === "clinical" || dataClass === "reserved_investigation") {
    throw new PreventionDocumentDomainError("Los antecedentes clínicos o de investigación reservada deben registrarse en su dominio seguro, no en la biblioteca general.")
  }
  const searchable = `${args.title ?? ""} ${args.fileName ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (PROHIBITED_GENERAL_LIBRARY_PATTERNS.some((pattern) => pattern.test(searchable))) {
    throw new PreventionDocumentDomainError("El archivo parece contener antecedentes clínicos o de investigación reservada y no puede cargarse en la biblioteca general.")
  }
}

export function todayIso(): string {
  // Día calendario de Chile continental: toISOString() daría el día UTC, que
  // rota 3-4 h antes que el chileno y desalineaba estos cálculos del filtro
  // "vencidos" (que ya usaba hora de Chile).
  return todayInChile()
}

export function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null
  const target = new Date(`${dateIso}T00:00:00Z`).getTime()
  if (Number.isNaN(target)) return null
  const today = new Date(`${todayIso()}T00:00:00Z`).getTime()
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
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
  folderSegments?: readonly string[],
): Promise<string> {
  // El backend activo (filesystem o Cloudreve) decide dónde vive el archivo;
  // el filePath lógico que se persiste en BD incluye los segmentos de carpeta
  // para materializar el árbol de la plataforma en el drive.
  const logicalPath = createSstDocumentPath(storageName, folderSegments)
  return writeSstDocument(logicalPath, Buffer.from(buffer))
}

/**
 * `client` permite que la traza comparta la transacción de la escritura que
 * audita. Sin él convivían dos convenciones para la misma tabla —este helper
 * con `db` suelto, e inserts directos con `tx` en `workflow.ts`/`integrity.ts`/
 * `distribution.ts`— y cada camino nuevo elegía al azar si su traza era
 * atómica: un fallo tras el UPDATE dejaba el cambio sin registro.
 */
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
}, client: Pick<DB, "insert"> = db) {
  const now = new Date().toISOString()
  await client.insert(sstDocumentAudit).values({
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
