import { z } from "zod"

/* ── Documentación Preventiva — Biblioteca SST ────────────────────────────
 *
 * Validación de input para el módulo documental interno.
 * NO cubre contratistas (esa sección sigue su propio flujo).
 *
 * Las constantes de slugs y entity_types deben matchear exactamente los
 * CHECK constraints de db/schema/prevention.ts.
 */

export const SST_DOCUMENT_CATEGORY_SLUGS = [
  "gestion_preventiva",
  "legal_normativa",
  "capacitacion",
  "epp",
  "incidentes",
  "comite",
  "emergencias",
  "equipos_vehiculos",
  "fiscalizacion",
  "salud_ocupacional",
] as const

export const SST_DOCUMENT_STATUSES = [
  "borrador",
  "en_revision",
  "observado",
  "aprobado",
  "vigente",
  "vencido",
  "reemplazado",
  "archivado",
] as const

export const SST_DOCUMENT_VERSION_STATUSES = [
  "borrador",
  "en_revision",
  "observado",
  "aprobado",
  "vigente",
  "reemplazado",
  "archivado",
] as const

export const SST_DOCUMENT_CONFIDENTIALITIES = [
  "publico_interno",
  "restringido",
  "sensible",
] as const

export const SST_DOCUMENT_LINK_ENTITY_TYPES = [
  "worker",
  "worksite",
  "vehicle",
  "equipment",
  "incident",
  "training",
  "committee",
  "epp_delivery",
  "corrective_action",
  "emergency_plan",
] as const

export const sstDocumentCreateSchema = z.object({
  categorySlug:    z.enum(SST_DOCUMENT_CATEGORY_SLUGS),
  typeId:          z.string().optional().or(z.literal("")),
  internalCode:    z.string().trim().max(60).optional().or(z.literal("")),
  title:           z.string().trim().min(1, "Título requerido").max(200),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  effectiveFrom:   z.string().optional().or(z.literal("")),
  expiresAt:       z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  requiresAcknowledgment: z.boolean().optional(),
  tags:            z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  extraMetadata:   z.record(z.string(), z.unknown()).default({}),
})

export const sstDocumentUpdateSchema = z.object({
  id:              z.string().min(1),
  title:           z.string().trim().min(1).max(200).optional(),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional(),
  effectiveFrom:   z.string().optional().or(z.literal("")),
  expiresAt:       z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  requiresAcknowledgment: z.boolean().optional(),
  internalCode:    z.string().trim().max(60).optional().or(z.literal("")),
  tags:            z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  extraMetadata:   z.record(z.string(), z.unknown()).optional(),
})

export const sstDocumentVersionCreateSchema = z.object({
  documentId:    z.string().min(1, "Documento requerido"),
  effectiveFrom: z.string().optional().or(z.literal("")),
  effectiveTo:   z.string().optional().or(z.literal("")),
  changelog:     z.string().max(2000).optional().or(z.literal("")),
  supersedesId:  z.string().optional().or(z.literal("")),
})

export const sstDocumentStatusChangeSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  toStatus:   z.enum(SST_DOCUMENT_STATUSES),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentVersionStatusChangeSchema = z.object({
  versionId: z.string().min(1, "Versión requerida"),
  toStatus:  z.enum(SST_DOCUMENT_VERSION_STATUSES),
  comment:   z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentApproveSchema = z.object({
  documentId: z.string().min(1),
  versionId:  z.string().min(1).optional().or(z.literal("")),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentObserveSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  versionId:  z.string().optional().or(z.literal("")),
  comment:    z.string().trim().min(1, "El comentario es obligatorio al observar").max(2000),
})

export const sstDocumentArchiveSchema = z.object({
  documentId: z.string().min(1),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentLinkSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  entityType: z.enum(SST_DOCUMENT_LINK_ENTITY_TYPES),
  entityId:   z.string().min(1, "Entidad requerida"),
  notes:      z.string().max(500).optional().or(z.literal("")),
})

export const sstDocumentUnlinkSchema = z.object({
  linkId: z.string().min(1, "Link requerido"),
})

export const sstDocumentAckSchema = z.object({
  versionId: z.string().min(1, "Versión requerida"),
  signature: z.string().trim().min(2, "Firma o nombre requerido").max(120),
})

export const sstDocumentSearchSchema = z.object({
  q:            z.string().trim().max(160).optional().or(z.literal("")),
  categorySlug: z.enum(SST_DOCUMENT_CATEGORY_SLUGS).optional().or(z.literal("")),
  status:       z.enum(SST_DOCUMENT_STATUSES).optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional().or(z.literal("")),
  worksiteId:   z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  entityType:   z.enum(SST_DOCUMENT_LINK_ENTITY_TYPES).optional().or(z.literal("")),
  entityId:     z.string().optional().or(z.literal("")),
  expiresBefore: z.string().optional().or(z.literal("")),
  expiresAfter:  z.string().optional().or(z.literal("")),
  page:          z.coerce.number().int().min(1).default(1),
  pageSize:      z.coerce.number().int().min(1).max(200).default(25),
})

export const sstDocumentCategoryUpsertSchema = z.object({
  slug:        z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "Slug debe ser snake_case"),
  name:        z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder:   z.coerce.number().int().default(0),
  isActive:    z.boolean().default(true),
})

export const sstDocumentTypeUpsertSchema = z.object({
  id:            z.string().optional().or(z.literal("")),
  categorySlug:  z.enum(SST_DOCUMENT_CATEGORY_SLUGS),
  code:          z.string().trim().min(1).max(40),
  name:          z.string().trim().min(1).max(160),
  description:   z.string().max(500).optional().or(z.literal("")),
  defaultConfidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  defaultValidityMonths:  z.coerce.number().int().positive().max(600).optional(),
  requiresApproval:       z.boolean().default(true),
  requiresAcknowledgment: z.boolean().default(false),
  isActive:    z.boolean().default(true),
})

/* Tipos derivados */
export type SstDocumentSearchInput = z.infer<typeof sstDocumentSearchSchema>
export type SstDocumentCreateInput = z.infer<typeof sstDocumentCreateSchema>
export type SstDocumentUpdateInput = z.infer<typeof sstDocumentUpdateSchema>
