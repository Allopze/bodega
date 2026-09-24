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

export const SST_DOCUMENT_DATA_CLASSES = [
  "operational",
  "personal",
  "sensitive_preventive",
  "clinical",
  "reserved_investigation",
  "client_secret",
] as const

export const sstDocumentCreateSchema = z.object({
  // Igual que en `sstDocumentTypeUpsertSchema`: la categoría la fija el tipo y
  // el admin puede crear categorías nuevas, así que un enum cerrado rechazaba
  // documentos de tipos reales. La existencia la garantiza la FK.
  categorySlug:    z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "Categoría inválida"),
  typeId:          z.string().optional().or(z.literal("")),
  folderId:        z.string().optional().nullable().or(z.literal("")),
  internalCode:    z.string().trim().max(60).optional().or(z.literal("")),
  title:           z.string().trim().min(1, "Título requerido").max(200),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  dataClass:       z.enum(SST_DOCUMENT_DATA_CLASSES).default("operational"),
  effectiveFrom:   z.string().optional().or(z.literal("")),
  expiresAt:       z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  requiresAcknowledgment: z.boolean().optional(),
  tags:            z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  extraMetadata:   z.record(z.string(), z.unknown()).default({}),
})

export const sstDocumentUpdateSchema = z.object({
  id:              z.string().min(1),
  /** Clasificar: fija el tipo (y con él la categoría). Vacío lo quita. */
  typeId:          z.string().optional().or(z.literal("")),
  folderId:        z.string().optional().nullable().or(z.literal("")),
  title:           z.string().trim().min(1).max(200).optional(),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional(),
  dataClass:       z.enum(SST_DOCUMENT_DATA_CLASSES).optional(),
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


export const sstDocumentArchiveSchema = z.object({
  documentId: z.string().min(1),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentSearchSchema = z.object({
  q:            z.string().trim().max(160).optional().or(z.literal("")),
  folderId:     z.string().optional().nullable().or(z.literal("")),
  categorySlug: z.enum(SST_DOCUMENT_CATEGORY_SLUGS).optional().or(z.literal("")),
  status:       z.enum(SST_DOCUMENT_STATUSES).optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional().or(z.literal("")),
  worksiteId:   z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
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
  // La fuente de verdad de las categorías es la tabla `sst_document_categories`,
  // que el admin puede extender (p. ej. `procedimientos_operacionales_audit`):
  // un enum cerrado rechazaría esas categorías reales. Acá se valida el formato
  // y `upsertDocumentType` verifica la existencia contra la tabla.
  categorySlug:  z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "Categoría inválida"),
  code:          z.string().trim().min(1).max(40),
  name:          z.string().trim().min(1).max(160),
  description:   z.string().max(500).optional().or(z.literal("")),
  defaultConfidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  defaultValidityMonths:  z.coerce.number().int().positive().max(600).optional(),
  requiresApproval:       z.boolean().default(true),
  requiresAcknowledgment: z.boolean().default(false),
  /** Días para entregar cada versión vigente a toda la dotación; `null` apaga
   *  la entrega y omitirlo conserva el valor actual. */
  distributionDueDays:    z.coerce.number().int().min(1, "El plazo de entrega es de al menos 1 día").max(365, "El plazo de entrega no supera 365 días").nullable().optional(),
  /**
   * Las dos vías por las que un tipo documental acredita en el programa anual.
   * Son campos distintos porque son momentos distintos: publicar una versión
   * prueba que el documento existe; un acuse prueba que alguien lo recibió.
   *
   * Sin exponerlos acá, la única forma de enganchar un tipo al PDTP era editar
   * `DEFAULT_DOCUMENT_TYPES` y desplegar.
   *
   * Omitirlos conserva lo que el tipo ya declaraba: desde que el formulario
   * cablea identidades de catálogo, los números son un snapshot histórico y no
   * la configuración vigente. Un `[]` explícito sí los apaga.
   */
  pdtpActivityNumbers:               z.array(z.number().int().positive()).optional(),
  pdtpAcknowledgmentActivityNumbers: z.array(z.number().int().positive()).optional(),
  isActive:    z.boolean().default(true),
})

export const sstDocumentFolderCreateSchema = z.object({
  name:       z.string().trim().min(1, "Nombre requerido").max(120),
  parentId:   z.string().min(1).optional().nullable().or(z.literal("")),
  worksiteId: z.string().min(1).optional().nullable().or(z.literal("")),
})

export const sstDocumentFolderUpdateSchema = z.object({
  id:   z.string().min(1, "Carpeta requerida"),
  name: z.string().trim().min(1, "Nombre requerido").max(120),
})

export const sstDocumentFolderMoveSchema = z.object({
  id:       z.string().min(1, "Carpeta requerida"),
  parentId: z.string().min(1).nullable().optional().or(z.literal("")),
})

export const sstDocumentMoveSchema = z.object({
  id:       z.string().min(1, "Documento requerido"),
  folderId: z.string().min(1).nullable().optional().or(z.literal("")),
})

/* Tipos derivados */
export type SstDocumentSearchInput = z.infer<typeof sstDocumentSearchSchema>
export type SstDocumentCreateInput = z.infer<typeof sstDocumentCreateSchema>
export type SstDocumentUpdateInput = z.infer<typeof sstDocumentUpdateSchema>
export type SstDocumentFolderCreateInput = z.infer<typeof sstDocumentFolderCreateSchema>
export type SstDocumentFolderUpdateInput = z.infer<typeof sstDocumentFolderUpdateSchema>
export type SstDocumentFolderMoveInput = z.infer<typeof sstDocumentFolderMoveSchema>
export type SstDocumentMoveInput = z.infer<typeof sstDocumentMoveSchema>
