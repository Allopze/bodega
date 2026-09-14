/**
 * Request Module Config — parametriza la diferencia entre repuestos y servicios.
 *
 * Cada módulo (repuestos, servicios) provee una config de este tipo.
 * El factory en request-service.ts la usa para generar las funciones compartidas.
 */

import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import type { repuestoQuotations, serviceQuotations } from "@/db/schema"

/** Attribute names map: field name on RequestItemInput → display label */
export type AttributeNamesMap = Partial<Record<keyof RequestItemInput, string>>

// ── Storage helpers config ────────────────────────────────────────────────────

export interface StorageConfig {
  /** Directory where files are stored (e.g. resolveRepuestosDir()) */
  dir: () => string
  /** Create a relative storage path from a safe file name */
  createPath: (storageName: string) => string
  /** Resolve a relative path to an absolute filesystem path (null = invalid) */
  resolveFile: (filePath: string) => string | null
}

// ── Quotation table reference ────────────────────────────────────────────────

// ── Service function signatures (shared by both modules) ──────────────────────

export interface RequestServiceInput {
  id?:            string
  worksiteId:     string
  urgency:        "normal" | "high" | "critical"
  /** Despacho sugerido por el solicitante; la jefatura lo confirma al aprobar. */
  deliveryMode?:  string
  requiredDate:   string
  justification?: string | null
  items:          RequestItemInput[]
}

export interface RequestItemInput {
  id?:            string
  description:    string
  quantity:       number
  unitOfMeasure:  string
  sortOrder?:     number
  notes?:         string | null
  equipmentName?: string | null
  patent?:        string | null
  brand?:         string | null
  model?:         string | null
  partNumber?:    string | null
  location?:      string | null
}

export interface AddQuotationInput {
  requestId:        string
  totalAmount:      number
  supplierId?:      string | null
  supplierNameFree?: string | null
  notes?:           string | null
  fileBuffer:       Buffer
  fileName:         string
  mimeType?:        string | null
  fileSize?:        number | null
  uploadedBy:       string
  userEmail?:       string
}

export interface DeleteQuotationInput {
  quotationId:       string
  expectedRequestId: string
  session:           Session
  elevatedPermission: Permission
  userEmail?:        string
}

export interface SubmitRequestInput {
  requestId: string
  userId:    string
  userEmail?: string
}

export interface SelectQuotationInput {
  requestId:   string
  quotationId: string
  userId:      string
  /**
   * COT-002: por qué se eligió esta oferta. Obligatorio cuando no es la más
   * económica; opcional en el resto, y guardado igual si viene.
   */
  justification?: string | null
  userEmail?:  string
  roleContext?: string
  /** Scope-defensive: if set, only allows access to matching worksites. */
  worksiteIds?: string[] | "all"
}

/**
 * Typed service functions expected by the action factory.
 *
 * ARQ-1: acotado a las 3 acciones que el factory de acciones todavía
 * consume — persistDraft/submitRequest/cancelRequest ya no pasan por aquí
 * (viven en solicitudes/actions-module/, llamados directo a sus servicios).
 */
export interface RequestServiceFunctions {
  addQuotation:     (input: AddQuotationInput) => Promise<string>
  deleteQuotation:  (input: DeleteQuotationInput) => Promise<void>
  selectQuotation:  (input: SelectQuotationInput) => Promise<void>
}

// ── Complete module config ────────────────────────────────────────────────────

export interface RequestModuleConfig {
  /** The request_type discriminator column value */
  requestType: "repuestos" | "servicios"
  /** Prefix for auto-generated codes (e.g. "REP", "SER") */
  codePrefix: string
  /** Drizzle table reference for the quotations table */
  quotationsTable: typeof repuestoQuotations | typeof serviceQuotations
  /** Entity type value for audit logging */
  quotationEntityType: string
  /** Attribute names map: fieldName → displayLabel */
  attributeNames: AttributeNamesMap
  /** Storage paths */
  storage: StorageConfig
}
