import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "../fuel-vehicles"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionCapaActions } from "./capa"
import { preventionContainers } from "./containers"
import { preventionEmergencyResources } from "./emergency"
import { sstDocumentVersions } from "./library"
import { preventionRiskEntries } from "./risk-legal"

/* ── Plantillas versionadas ───────────────────────────────────────────────
 * El contenido reutiliza `ChecklistDefinition` de `lib/sst/types`, que ya
 * modela secciones, ítems y `danoPotencial`. La plantilla guarda un snapshot
 * inmutable al aprobarse: una edición posterior del catálogo en código no debe
 * cambiar la evidencia de una inspección ya ejecutada.
 */
export const preventionInspectionTemplates = pgTable("prevention_inspection_templates", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull(),
  versionLabel:      text("version_label").notNull(),
  name:              text("name").notNull(),
  kind:              text("kind").notNull(),
  sourceDefinitionCode: text("source_definition_code"),
  provenanceKind:    text("provenance_kind").notNull().default("platform_definition"),
  sourceDocumentVersionId: text("source_document_version_id").references(() => sstDocumentVersions.id, { onDelete: "restrict" }),
  /** Copia inmutable de la procedencia al incorporar la plantilla. */
  sourceSnapshot:    jsonb("source_snapshot").$type<{
    documentId: string
    versionId: string
    fileName: string
    revision: string | null
    effectiveFrom: string | null
    checksumSha256: string
  } | null>(),
  parityReport:      jsonb("parity_report").$type<{
    status: "pending" | "passed" | "failed"
    verifiedAt: string | null
    verifiedByUserId: string | null
    expectedItems: number | null
    actualItems: number | null
    differences: string[]
  }>(),
  definitionSnapshot: jsonb("definition_snapshot").notNull(),
  contentHash:       text("content_hash").notNull(),
  status:            text("status").notNull().default("draft"),
  legalFramework:    text("legal_framework"),
  authorUserId:      text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId:  text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:        timestamp("approved_at", { withTimezone: true, mode: "string" }),
  supersededAt:      timestamp("superseded_at", { withTimezone: true, mode: "string" }),
  supersededByTemplateId: text("superseded_by_template_id"),
  /** Números de actividad PDTP (campo `n`) que esta plantilla acredita al
   * completar un run. Null = no vinculado al PDTP (comportamiento previo). */
  pdtpActivityNumbers: jsonb("pdtp_activity_numbers").$type<number[]>(),
  /* Actividades que acredita al REVISARSE, no al ejecutarse. Conjunto aparte y
   * no un flag sobre el anterior: el programa distingue el acto de llenar el
   * instrumento del acto de revisarlo y firmarlo —n=25 la hace el operador,
   * n=26 la firma el supervisor— y son dos personas, dos fechas y dos
   * ocurrencias. Acreditar la firma al completar daría por firmado lo que
   * nadie revisó; de ahí que el disparador sea `reviewed`, donde el servicio
   * ya garantiza que el revisor no es quien ejecutó. */
  pdtpReviewActivityNumbers: jsonb("pdtp_review_activity_numbers").$type<number[]>(),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_template_version_unique").on(table.code, table.versionLabel),
  index("prevention_inspection_template_status_idx").on(table.code, table.status),
  check("prevention_inspection_template_kind_valid", sql`${table.kind} IN ('inspection', 'observation', 'audit')`),
  check("prevention_inspection_template_provenance_valid", sql`${table.provenanceKind} IN ('official_document', 'platform_definition')`),
  check("prevention_inspection_template_official_source_consistent", sql`${table.provenanceKind} <> 'official_document' OR ${table.status} <> 'approved' OR ${table.sourceDocumentVersionId} IS NOT NULL`),
  check("prevention_inspection_template_status_valid", sql`${table.status} IN ('draft', 'approved', 'superseded')`),
  check("prevention_inspection_template_hash_valid", sql`length(${table.contentHash}) = 64`),
  check("prevention_inspection_template_approved_consistent", sql`${table.status} <> 'approved' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
  check("prevention_inspection_template_version_positive", sql`${table.version} >= 1`),
])

/* ── Catálogo de desviaciones por instrumento ─────────────────────────────
 * Los instrumentos de checklist derivan sus hallazgos de los ítems marcados "no
 * cumple", y la gravedad la declara el ítem. Pero hay actividades del programa
 * —observación de conductas, inspección de área, caminata de seguridad— que no
 * son un checklist puntuado: se registra que se hicieron y **qué desviaciones se
 * encontraron**, sin lista fija de preguntas.
 *
 * Para esas, la gravedad tiene que venir de algún lado que no sea el criterio de
 * quien registra: de este catálogo. Y es **por plantilla** a propósito — una
 * desviación en un carro no es la misma que en un área de trabajo, y compartir
 * una lista global obligaría a que cada instrumento filtrara la ajena.
 */
export const preventionInspectionDeviationCatalog = pgTable("prevention_inspection_deviation_catalog", {
  id:            text("id").primaryKey(),
  templateId:    text("template_id").notNull().references(() => preventionInspectionTemplates.id, { onDelete: "cascade" }),
  label:         text("label").notNull(),
  /** Misma escala que los ítems del catálogo SST: de acá sale la criticidad del hallazgo. */
  danoPotencial: text("dano_potencial").notNull(),
  /* Retirar una desviación no borra su fila: los hallazgos ya levantados la
   * referencian y su gravedad es evidencia de por qué tuvieron el plazo que
   * tuvieron. Se desactiva para que deje de ofrecerse. */
  isActive:      boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_deviation_label_unique").on(table.templateId, table.label),
  index("prevention_inspection_deviation_template_idx").on(table.templateId, table.isActive),
  check("prevention_inspection_deviation_dano_valid", sql`${table.danoPotencial} IN ('leve', 'moderado', 'grave', 'fatal')`),
  check("prevention_inspection_deviation_label_length", sql`length(${table.label}) >= 3`),
])

/* ── Programación por faena y frecuencia ──────────────────────────────────── */
export const preventionInspectionPrograms = pgTable("prevention_inspection_programs", {
  id:                text("id").primaryKey(),
  templateId:        text("template_id").notNull().references(() => preventionInspectionTemplates.id, { onDelete: "restrict" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  frequency:         text("frequency").notNull(),
  intervalDays:      integer("interval_days").notNull(),
  nextDueOn:         text("next_due_on").notNull(),
  assignedToUserId:  text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  riskEntryId:       text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  subjectType:       text("subject_type"),
  /** Recurso concreto que programa inspeccionar (función #11). */
  subjectResourceId: text("subject_resource_id").references(() => preventionEmergencyResources.id, { onDelete: "set null" }),
  /* Equipo de flota programado. Alternativa excluyente a `subjectResourceId`:
   * el inventario de emergencias no modela camiones ni maquinaria, y el padrón
   * que sí lo hace es `fuelVehicles`. Se agrega como FK propia y no como par
   * polimórfico (`subjectKind` + `subjectRef`) porque el motor PDTP ya intentó
   * eso —`subjectId` referencia `fuelVehicles.id`/`workers.id` sin FK física—
   * y por eso no puede garantizar que el sujeto exista. */
  subjectVehicleId:  text("subject_vehicle_id").references(() => fuelVehicles.id, { onDelete: "set null" }),
  /** Contenedor del catálogo programado. Tercera alternativa excluyente. */
  subjectContainerId: text("subject_container_id").references(() => preventionContainers.id, { onDelete: "set null" }),
  isActive:          boolean("is_active").notNull().default(true),
  version:           integer("version").notNull().default(1),
  createdByUserId:   text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_program_due_idx").on(table.nextDueOn, table.isActive),
  index("prevention_inspection_program_worksite_idx").on(table.worksiteId, table.isActive),
  check("prevention_inspection_program_frequency_valid", sql`${table.frequency} IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual', 'on_demand')`),
  check("prevention_inspection_program_interval_positive", sql`${table.intervalDays} > 0`),
  check("prevention_inspection_program_version_positive", sql`${table.version} >= 1`),
])

/* ── Ejecución ────────────────────────────────────────────────────────────
 * `reviewed` es un estado distinto de `completed` a propósito: la auditoría
 * §7.8 exige revisión y cierre independientes de quien ejecutó.
 */
export const preventionInspectionRuns = pgTable("prevention_inspection_runs", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull().unique(),
  templateId:        text("template_id").notNull().references(() => preventionInspectionTemplates.id, { onDelete: "restrict" }),
  programId:         text("program_id").references(() => preventionInspectionPrograms.id, { onDelete: "set null" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  subjectType:       text("subject_type"),
  /* Denormalizado a propósito: el nombre del recurso al momento de inspeccionar
   * es evidencia congelada, igual que `itemLabel` en las respuestas. */
  subjectLabel:      text("subject_label"),
  /* Sujeto real del inventario (función #11). `preventionEmergencyResources` ya
   * es el inventario por faena —nombre, tipo, ubicación, serie,
   * `lastInspectedAt`, `nextInspectionAt`— con su propio CRUD y sus alertas de
   * vencimiento, que nadie alimentaba. No hace falta tabla nueva. */
  subjectResourceId: text("subject_resource_id").references(() => preventionEmergencyResources.id, { onDelete: "set null" }),
  /* Equipo de flota inspeccionado. Excluyente con `subjectResourceId` — ver el
   * CHECK `prevention_inspection_run_single_subject`. `subjectLabel` sigue
   * congelando cómo se llamaba el equipo al inspeccionarlo: renombrar la
   * patente después no debe reescribir la evidencia. */
  subjectVehicleId:  text("subject_vehicle_id").references(() => fuelVehicles.id, { onDelete: "set null" }),
  /* Contenedor inspeccionado. Excluyente con los dos anteriores. El catálogo
   * llegó después que la inspección del Anexo 14, que hasta entonces nombraba
   * el contenedor sólo por `subjectLabel` libre; las ejecuciones anteriores a
   * esta columna la conservan nula y su etiqueta intacta. */
  subjectContainerId: text("subject_container_id").references(() => preventionContainers.id, { onDelete: "set null" }),
  /* Quién origina la inspección. La certificación Mutual distingue las del
   * comité paritario de las del Departamento de Prevención, y las del mandante
   * no son ni una ni otra. Por defecto Prevención, que es el caso histórico. */
  origin:            text("origin").notNull().default("prevencion"),
  scheduledFor:      text("scheduled_for"),
  status:            text("status").notNull().default("planned"),
  assignedToUserId:  text("assigned_to_user_id").references(() => users.id, { onDelete: "restrict" }),
  executedByUserId:  text("executed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  executedAt:        timestamp("executed_at", { withTimezone: true, mode: "string" }),
  reviewedByUserId:  text("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt:        timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  reviewComment:     text("review_comment"),
  cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  cancelledAt:       timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  conformingCount:   integer("conforming_count").notNull().default(0),
  /** Respuestas 'partial' (escala B/R/M "Regular"). Puntúan 0,5 en `compliancePercent` — ver PARTIAL_STATUS_WEIGHT en lib/sst/compliance.ts. */
  partialCount:      integer("partial_count").notNull().default(0),
  nonConformingCount: integer("non_conforming_count").notNull().default(0),
  notApplicableCount: integer("not_applicable_count").notNull().default(0),
  compliancePercent: integer("compliance_percent"),
  officialComplianceBasisPoints: integer("official_compliance_basis_points"),
  normalizedComplianceBasisPoints: integer("normalized_compliance_basis_points"),
  ingestionSource:   text("ingestion_source").notNull().default("digital"),
  locationLatitude:  text("location_latitude"),
  locationLongitude: text("location_longitude"),
  /* Acta de cierre (`ClosingActDefinition` del catálogo SST). Las 12
   * definiciones la declaran —resultado global, restricciones y roles que
   * firman— y `itemsFromDefinition` la descartaba entera: sólo aplanaba
   * secciones. No se guarda como respuestas sintéticas porque contaminaría los
   * conteos y el export. */
  closingResult:       text("closing_result"),
  closingRestrictions: text("closing_restrictions"),
  /** `[{ role, name, userId|null, signedAt }]`. Firma registrada, sin trazo. */
  closingSignatures:   jsonb("closing_signatures").$type<{ role: string; name: string; userId: string | null; signedAt: string }[]>(),
  clientSubmissionId: text("client_submission_id"),
  version:           integer("version").notNull().default(1),
  createdByUserId:   text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_run_submission_unique").on(table.clientSubmissionId)
    .where(sql`${table.clientSubmissionId} IS NOT NULL`),
  // Idempotencia del materializador de programas: dos disparos del cron el
  // mismo día no duplican la ejecución del período. Misma técnica que
  // `pdtpExecutions.idempotencyKey`, pero sobre la clave natural del slot.
  uniqueIndex("prevention_inspection_run_program_slot_unique").on(table.programId, table.scheduledFor)
    .where(sql`${table.programId} IS NOT NULL AND ${table.scheduledFor} IS NOT NULL`),
  index("prevention_inspection_run_worksite_idx").on(table.worksiteId, table.status),
  index("prevention_inspection_run_subject_idx").on(table.subjectResourceId),
  index("prevention_inspection_run_subject_vehicle_idx").on(table.subjectVehicleId),
  index("prevention_inspection_run_subject_container_idx").on(table.subjectContainerId),
  index("prevention_inspection_run_template_idx").on(table.templateId, table.executedAt),
  check("prevention_inspection_run_status_valid", sql`${table.status} IN ('planned', 'in_progress', 'completed', 'reviewed', 'cancelled')`),
  check("prevention_inspection_run_origin_valid", sql`${table.origin} IN ('prevencion', 'cphs', 'mandante')`),
  check("prevention_inspection_run_compliance_valid", sql`${table.compliancePercent} IS NULL OR ${table.compliancePercent} BETWEEN 0 AND 100`),
  check("prevention_inspection_run_official_bps_valid", sql`${table.officialComplianceBasisPoints} IS NULL OR ${table.officialComplianceBasisPoints} BETWEEN 0 AND 10000`),
  check("prevention_inspection_run_normalized_bps_valid", sql`${table.normalizedComplianceBasisPoints} IS NULL OR ${table.normalizedComplianceBasisPoints} BETWEEN 0 AND 10000`),
  check("prevention_inspection_run_ingestion_source_valid", sql`${table.ingestionSource} IN ('digital', 'legacy_document_import', 'legacy_tracking_import')`),
  check("prevention_inspection_run_counts_nonnegative", sql`${table.conformingCount} >= 0 AND ${table.partialCount} >= 0 AND ${table.nonConformingCount} >= 0 AND ${table.notApplicableCount} >= 0`),
  check("prevention_inspection_run_cancel_consistent", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
  check("prevention_inspection_run_review_consistent", sql`(${table.reviewedAt} IS NULL AND ${table.reviewedByUserId} IS NULL) OR (${table.reviewedAt} IS NOT NULL AND ${table.reviewedByUserId} IS NOT NULL)`),
  check("prevention_inspection_run_version_positive", sql`${table.version} >= 1`),
  // Un run inspecciona a lo más un sujeto tipado. Sin esta invariante el
  // servicio tendría que elegir a cuál creerle al construir `subjectLabel`.
  check("prevention_inspection_run_single_subject", sql`num_nonnulls(${table.subjectResourceId}, ${table.subjectVehicleId}, ${table.subjectContainerId}) <= 1`),
])

/* ── Respuestas ───────────────────────────────────────────────────────────── */
export const preventionInspectionAnswers = pgTable("prevention_inspection_answers", {
  id:               text("id").primaryKey(),
  runId:            text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  sectionId:        text("section_id").notNull(),
  itemId:           text("item_id").notNull(),
  itemLabel:        text("item_label").notNull(),
  result:           text("result").notNull(),
  value:            text("value"),
  comment:          text("comment"),
  evidenceReference: text("evidence_reference"),
  danoPotencial:    text("dano_potencial"),
  /* La respuesta la pre-llenó el reconocimiento de la planilla y todavía no la
   * ratificó una persona. Sólo se marca en los ítems de daño potencial `fatal`
   * —frenos, dirección, acople—: son los que, leídos al revés, dejan el equipo
   * operando con una falla que mata. `assessRunCompletion` no deja cerrar la
   * subida mientras quede uno sin confirmar. Responder el ítem a mano lo
   * confirma por el acto de responderlo. */
  needsConfirmation: boolean("needs_confirmation").notNull().default(false),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_answer_unique").on(table.runId, table.sectionId, table.itemId),
  // 'partial' = escala B/R/M "Regular" (H-04, AUDITORIA_BUGS_2026-08-05.md):
  // el motor transversal solo tenía cumple/no cumple/no aplica, perdiendo el
  // estado intermedio que el catálogo de ítems B/R/M (lib/sst/definitions)
  // declara y que el motor SST (lib/sst/compliance.ts) ya puntúa en 0,5.
  // 'recorded' = ítem que no expresa conformidad (text/textarea/date/select):
  // su respuesta es `value`. Sin este estado, un relato libre sólo podía
  // guardarse mintiendo ('conforming', que infla el cumplimiento) o no
  // guardarse (B-08, auditoría 2026-08-18).
  // 'not_present' = "NT / NO TIENE" del Anexo 14 (Contenedores): el sujeto no
  // posee el componente. Estado propio y no un 'not_applicable' con comentario
  // porque en el papel son dos casillas distintas —"no corresponde" vs "no
  // existe"—; para el puntaje son idénticos (ver EXCLUDED_RESULTS en
  // lib/prevention/inspections.ts). No entra en el CHECK de comentario
  // obligatorio: "no aplica" exige motivo porque hay un criterio detrás, "no
  // tiene" es una constatación verificable contra el sujeto.
  check("prevention_inspection_answer_result_valid", sql`${table.result} IN ('conforming', 'partial', 'non_conforming', 'not_applicable', 'not_present', 'recorded')`),
  check("prevention_inspection_answer_recorded_has_value", sql`${table.result} <> 'recorded' OR length(${table.value}) >= 1`),
  // 'partial' exige observación igual que 'not_applicable': es la misma regla
  // que ya rige la escala B/R/M en el motor SST (requiresObservation en
  // lib/sst/compliance.ts — 'regular' siempre justifica por escrito, ahí
  // sin distinguir por ítem). 'non_conforming' queda fuera a propósito: ya
  // se permite sin comentario en este motor y cambiar eso es un ajuste
  // aparte, no parte de H-04.
  check("prevention_inspection_answer_requires_comment", sql`${table.result} NOT IN ('not_applicable', 'partial') OR length(${table.comment}) >= 3`),
  check("prevention_inspection_answer_dano_valid", sql`${table.danoPotencial} IS NULL OR ${table.danoPotencial} IN ('leve', 'moderado', 'grave', 'fatal')`),
])

/* ── Evidencia fotográfica por respuesta ──────────────────────────────────
 * Relación 1-a-N y no un campo suelto: evidenciar un incumplimiento suele
 * necesitar más de un ángulo. `evidenceReference` (texto libre) queda deprecado
 * — nunca tuvo UI que lo escribiera.
 *
 * `onDelete: cascade` desde la respuesta: borrar la respuesta se lleva sus
 * fotos, y el archivo físico lo recoge el GC de evidencias.
 *
 * Esa cascada NO es el camino por el que se quita evidencia (INS-03): dejar un
 * ítem en "Sin responder" borra su fila, y con ella destruía en silencio las
 * fotografías del hallazgo. `saveAnswersWithClient` ahora rechaza ese guardado
 * y exige quitar las fotos explícitamente; la cascada queda como red de
 * integridad para los borrados que sí son deliberados (cancelar el run).
 */
export const preventionInspectionAnswerEvidence = pgTable("prevention_inspection_answer_evidence", {
  id:               text("id").primaryKey(),
  answerId:         text("answer_id").notNull().references(() => preventionInspectionAnswers.id, { onDelete: "cascade" }),
  /** Ruta relativa bajo `storage/inspection-evidence/`, nunca el nombre original. */
  path:             text("path").notNull(),
  caption:          text("caption"),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_answer_evidence_answer_idx").on(table.answerId),
])

/* ── Documento origen: la foto de la planilla ─────────────────────────────
 * Tabla propia y no `preventionInspectionAnswerEvidence`: aquella cuelga de una
 * respuesta, y la foto del formulario es evidencia del run entero. `extraction`
 * guarda lo que leyó la máquina —celdas, confianza, versión del layout— para
 * poder auditar después qué dijo el reconocimiento frente a qué confirmó la
 * persona. Nace vacío mientras el detector no exista.
 */
export const preventionInspectionRunDocuments = pgTable("prevention_inspection_run_documents", {
  id:               text("id").primaryKey(),
  runId:            text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  /** Ruta relativa bajo `storage/inspection-evidence/`, nunca el nombre original. */
  path:             text("path").notNull(),
  fileName:         text("file_name"),
  mimeType:         text("mime_type"),
  fileSize:         integer("file_size"),
  checksumSha256:   text("checksum_sha256"),
  kind:             text("kind").notNull().default("source_form"),
  caption:          text("caption"),
  /** Lectura de la máquina. `null` = se subió sin reconocimiento. */
  extraction:       jsonb("extraction").$type<{
    layoutVersion: string
    cells: { sectionId: string; itemId: string; result: string; confidence: number }[]
  } | null>(),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_run_document_run_idx").on(table.runId, table.createdAt),
  check("prevention_inspection_run_document_kind_valid", sql`${table.kind} IN ('source_form', 'attachment')`),
  check("prevention_inspection_run_document_size_valid", sql`${table.fileSize} IS NULL OR ${table.fileSize} > 0`),
  check("prevention_inspection_run_document_checksum_valid", sql`${table.checksumSha256} IS NULL OR length(${table.checksumSha256}) = 64`),
])

/** Personas que participaron en una inspección no planeada. */
export const preventionInspectionRunParticipants = pgTable("prevention_inspection_run_participants", {
  id:               text("id").primaryKey(),
  runId:            text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  name:             text("name").notNull(),
  position:         text("position").notNull(),
  userId:           text("user_id").references(() => users.id, { onDelete: "set null" }),
  sortOrder:        integer("sort_order").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_run_participant_order_unique").on(table.runId, table.sortOrder),
  index("prevention_inspection_run_participant_run_idx").on(table.runId),
  check("prevention_inspection_run_participant_name_valid", sql`length(${table.name}) >= 2`),
  check("prevention_inspection_run_participant_position_valid", sql`length(${table.position}) >= 2`),
])

/* ── Hallazgos ────────────────────────────────────────────────────────────
 * Un hallazgo nace de una respuesta no conforme, o lo registra una persona como
 * desviación en los instrumentos que no puntúan ítems. Su criticidad deriva del
 * `danoPotencial` declarado —por el ítem o por el catálogo—, no del criterio del
 * ejecutante.
 */
export const preventionInspectionFindings = pgTable("prevention_inspection_findings", {
  id:                text("id").primaryKey(),
  runId:             text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  /* Quién lo puso ahí. `completeInspectionRun` rehace los hallazgos derivados en
   * cada cierre —borra los abiertos sin CAPA y los vuelve a calcular—, y sin
   * esta marca ese borrado se llevaba también las desviaciones que una persona
   * había registrado a mano.
   *
   * No sirve deducirlo de `answerId IS NULL`: un derivado también puede quedar
   * con `answerId` nulo si la búsqueda de su respuesta falla. La procedencia
   * tiene que ser explícita. */
  origin:            text("origin").notNull().default("derived"),
  answerId:          text("answer_id").references(() => preventionInspectionAnswers.id, { onDelete: "set null" }),
  /* De dónde salió la gravedad, que es lo que gobierna el plazo de la CAPA:
   *   `answerId` → la declaró el ítem de la plantilla (checklist puntuado).
   *   `catalogEntryId` → la declaró el catálogo de desviaciones.
   *   ambos nulos → la eligió quien registró, con "Otra desviación", y está
   *   esperando que Prevención la incorpore al catálogo.
   * El tercer caso es el único donde la gravedad depende de una persona, y por
   * eso tiene que poder consultarse: es la cola de trabajo del catálogo. */
  catalogEntryId:    text("catalog_entry_id").references(() => preventionInspectionDeviationCatalog.id, { onDelete: "set null" }),
  description:       text("description").notNull(),
  danoPotencial:     text("dano_potencial"),
  criticality:       text("criticality").notNull(),
  immediateMeasure:  text("immediate_measure"),
  potentialDamageDescription: text("potential_damage_description"),
  applicableLaw:     text("applicable_law"),
  capaActionId:      text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  status:            text("status").notNull().default("open"),
  closedByUserId:    text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:          timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_finding_run_idx").on(table.runId, table.status),
  check("prevention_inspection_finding_origin_valid", sql`${table.origin} IN ('derived', 'deviation')`),
  // Una desviación no sale de una respuesta: si trae `answer_id`, es derivada.
  check("prevention_inspection_finding_origin_consistent", sql`${table.origin} = 'derived' OR ${table.answerId} IS NULL`),
  check("prevention_inspection_finding_criticality_valid", sql`${table.criticality} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_inspection_finding_damage_valid", sql`${table.danoPotencial} IS NULL OR ${table.danoPotencial} IN ('leve', 'moderado', 'grave', 'fatal')`),
  check("prevention_inspection_finding_status_valid", sql`${table.status} IN ('open', 'capa_linked', 'closed')`),
  check("prevention_inspection_finding_closed_consistent", sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL)`),
])

/** Fotografías y documentos ligados a una desviación concreta. */
export const preventionInspectionFindingEvidence = pgTable("prevention_inspection_finding_evidence", {
  id:               text("id").primaryKey(),
  findingId:        text("finding_id").notNull().references(() => preventionInspectionFindings.id, { onDelete: "cascade" }),
  path:             text("path").notNull(),
  fileName:         text("file_name").notNull(),
  mimeType:         text("mime_type").notNull(),
  fileSize:         integer("file_size").notNull(),
  checksumSha256:   text("checksum_sha256").notNull(),
  caption:          text("caption"),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_finding_evidence_finding_idx").on(table.findingId, table.createdAt),
  check("prevention_inspection_finding_evidence_size_valid", sql`${table.fileSize} > 0`),
  check("prevention_inspection_finding_evidence_checksum_valid", sql`length(${table.checksumSha256}) = 64`),
])

/** Staging auditable para los Word y planillas históricas. */
export const preventionInspectionImportBatches = pgTable("prevention_inspection_import_batches", {
  id:               text("id").primaryKey(),
  sourceKind:       text("source_kind").notNull(),
  sourceFileName:   text("source_file_name").notNull(),
  sourceChecksumSha256: text("source_checksum_sha256").notNull(),
  status:           text("status").notNull().default("staged"),
  summary:          jsonb("summary").notNull().default(sql`'{}'::jsonb`),
  createdByUserId:  text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  appliedAt:        timestamp("applied_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  uniqueIndex("prevention_inspection_import_batch_checksum_unique").on(table.sourceKind, table.sourceChecksumSha256),
  check("prevention_inspection_import_batch_kind_valid", sql`${table.sourceKind} IN ('annex_08_docx', 'annex_15_xlsx')`),
  check("prevention_inspection_import_batch_status_valid", sql`${table.status} IN ('staged', 'applied', 'rejected')`),
  check("prevention_inspection_import_batch_checksum_valid", sql`length(${table.sourceChecksumSha256}) = 64`),
])

export const preventionInspectionImportRows = pgTable("prevention_inspection_import_rows", {
  id:               text("id").primaryKey(),
  batchId:          text("batch_id").notNull().references(() => preventionInspectionImportBatches.id, { onDelete: "cascade" }),
  sourceKey:        text("source_key").notNull(),
  rawSnapshot:      jsonb("raw_snapshot").notNull(),
  status:           text("status").notNull().default("pending_review"),
  runId:            text("run_id").references(() => preventionInspectionRuns.id, { onDelete: "set null" }),
  findingId:        text("finding_id").references(() => preventionInspectionFindings.id, { onDelete: "set null" }),
  capaActionId:     text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  reviewNote:       text("review_note"),
  reviewedByUserId:text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:       timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_import_row_source_unique").on(table.batchId, table.sourceKey),
  index("prevention_inspection_import_row_status_idx").on(table.status, table.createdAt),
  check("prevention_inspection_import_row_status_valid", sql`${table.status} IN ('pending_review', 'imported', 'duplicate', 'rejected')`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionInspectionHistory = pgTable("prevention_inspection_history", {
  id:          text("id").primaryKey(),
  entityType:  text("entity_type").notNull(),
  entityId:    text("entity_id").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  changeType:  text("change_type").notNull(),
  reason:      text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState:  jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionInspectionTemplatesRelations = relations(preventionInspectionTemplates, ({ many }) => ({
  programs: many(preventionInspectionPrograms),
  runs: many(preventionInspectionRuns),
}))

export const preventionInspectionProgramsRelations = relations(preventionInspectionPrograms, ({ one, many }) => ({
  template: one(preventionInspectionTemplates, { fields: [preventionInspectionPrograms.templateId], references: [preventionInspectionTemplates.id] }),
  worksite: one(worksites, { fields: [preventionInspectionPrograms.worksiteId], references: [worksites.id] }),
  runs: many(preventionInspectionRuns),
}))

export const preventionInspectionRunsRelations = relations(preventionInspectionRuns, ({ one, many }) => ({
  template: one(preventionInspectionTemplates, { fields: [preventionInspectionRuns.templateId], references: [preventionInspectionTemplates.id] }),
  program: one(preventionInspectionPrograms, { fields: [preventionInspectionRuns.programId], references: [preventionInspectionPrograms.id] }),
  worksite: one(worksites, { fields: [preventionInspectionRuns.worksiteId], references: [worksites.id] }),
  answers: many(preventionInspectionAnswers),
  findings: many(preventionInspectionFindings),
  documents: many(preventionInspectionRunDocuments),
  participants: many(preventionInspectionRunParticipants),
}))

export const preventionInspectionRunDocumentsRelations = relations(preventionInspectionRunDocuments, ({ one }) => ({
  run: one(preventionInspectionRuns, { fields: [preventionInspectionRunDocuments.runId], references: [preventionInspectionRuns.id] }),
}))

export const preventionInspectionAnswersRelations = relations(preventionInspectionAnswers, ({ one, many }) => ({
  run: one(preventionInspectionRuns, { fields: [preventionInspectionAnswers.runId], references: [preventionInspectionRuns.id] }),
  evidence: many(preventionInspectionAnswerEvidence),
}))

export const preventionInspectionAnswerEvidenceRelations = relations(preventionInspectionAnswerEvidence, ({ one }) => ({
  answer: one(preventionInspectionAnswers, { fields: [preventionInspectionAnswerEvidence.answerId], references: [preventionInspectionAnswers.id] }),
}))

export const preventionInspectionDeviationCatalogRelations = relations(preventionInspectionDeviationCatalog, ({ one, many }) => ({
  template: one(preventionInspectionTemplates, { fields: [preventionInspectionDeviationCatalog.templateId], references: [preventionInspectionTemplates.id] }),
  findings: many(preventionInspectionFindings),
}))

export const preventionInspectionFindingsRelations = relations(preventionInspectionFindings, ({ one }) => ({
  run: one(preventionInspectionRuns, { fields: [preventionInspectionFindings.runId], references: [preventionInspectionRuns.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionInspectionFindings.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionInspectionTemplate = typeof preventionInspectionTemplates.$inferSelect
export type PreventionInspectionProgram = typeof preventionInspectionPrograms.$inferSelect
export type PreventionInspectionRun = typeof preventionInspectionRuns.$inferSelect
export type PreventionInspectionAnswer = typeof preventionInspectionAnswers.$inferSelect
export type PreventionInspectionAnswerEvidence = typeof preventionInspectionAnswerEvidence.$inferSelect
export type PreventionInspectionFinding = typeof preventionInspectionFindings.$inferSelect
export type PreventionInspectionDeviationEntry = typeof preventionInspectionDeviationCatalog.$inferSelect
export type PreventionInspectionRunDocument = typeof preventionInspectionRunDocuments.$inferSelect
