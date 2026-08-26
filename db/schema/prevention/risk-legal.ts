import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionCommitteeMeetings } from "./cphs"
import { preventionCapaActions } from "./capa"
import { pdtpActivities, pdtpPrograms } from "./pdtp"

export const preventionRiskMethodologies = pgTable("prevention_risk_methodologies", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  versionLabel: text("version_label").notNull(),
  kind: text("kind").notNull(),
  authoritySource: text("authority_source").notNull(),
  configuration: jsonb("configuration").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_methodologies_code_version_unique").on(table.code, table.versionLabel),
  check("prevention_risk_methodologies_kind_valid", sql`${table.kind} IN ('primary', 'special')`),
])

export const preventionRiskProcesses = pgTable("prevention_risk_processes", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_processes_scope_code_unique").on(table.worksiteId, table.code),
  index("prevention_risk_processes_scope_active_idx").on(table.worksiteId, table.isActive),
])

export const preventionRiskTasks = pgTable("prevention_risk_tasks", {
  id: text("id").primaryKey(),
  processId: text("process_id").notNull().references(() => preventionRiskProcesses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isRoutine: boolean("is_routine").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_tasks_process_code_unique").on(table.processId, table.code),
])

export const preventionRiskPositions = pgTable("prevention_risk_positions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => preventionRiskTasks.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  workerPositionKey: text("worker_position_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_positions_task_code_unique").on(table.taskId, table.code),
])

export const preventionRiskMatrices = pgTable("prevention_risk_matrices", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  matrixVersion: integer("matrix_version").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  methodologyId: text("methodology_id").notNull().references(() => preventionRiskMethodologies.id, { onDelete: "restrict" }),
  methodologySnapshot: jsonb("methodology_snapshot").notNull(),
  revisionReason: text("revision_reason").notNull(),
  participationSummary: text("participation_summary").notNull(),
  /* Sesión del comité paritario donde se revisó esta matriz. `participation_summary`
   * es texto libre y sirve para describir; esto la vuelve verificable, que es lo
   * que exige la certificación Mutual para acreditar participación del CPHS. */
  committeeMeetingId: text("committee_meeting_id").references(() => preventionCommitteeMeetings.id, { onDelete: "set null" }),
  consultationEvidenceReference: text("consultation_evidence_reference").notNull(),
  effectiveFrom: text("effective_from"),
  reviewDueAt: text("review_due_at"),
  // Un lote de importación genera a lo más una matriz (unique parcial más
  // abajo). Sin FK ni unique, dos activaciones concurrentes podían dejar dos
  // matrices apuntando al mismo lote, cada una con parte de las filas.
  sourceImportBatchId: text("source_import_batch_id").references((): AnyPgColumn => preventionRiskImportBatches.id, { onDelete: "restrict" }),
  // Auto-FK con `restrict`, mismo criterio que `supersedesRequirementId`: la
  // cadena de supersesión es la evidencia de qué matriz reemplazó a cuál
  // (DS 44 art. 62) y no puede quedar apuntando a un id inexistente.
  supersedesMatrixId: text("supersedes_matrix_id").references((): AnyPgColumn => preventionRiskMatrices.id, { onDelete: "restrict" }),
  publishedHashSha256: text("published_hash_sha256"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  publishedByUserId: text("published_by_user_id").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_matrices_scope_version_unique").on(table.worksiteId, table.matrixVersion),
  index("prevention_risk_matrices_scope_status_idx").on(table.worksiteId, table.status),
  uniqueIndex("prevention_risk_matrices_one_published_scope_unique").on(table.worksiteId).where(sql`${table.status} = 'published'`),
  // Un lote de importación genera a lo más una matriz: es el invariante que
  // `activateRiskImportBatch` comprobaba sólo en aplicación.
  uniqueIndex("prevention_risk_matrices_source_batch_unique").on(table.sourceImportBatchId).where(sql`${table.sourceImportBatchId} IS NOT NULL`),
  check("prevention_risk_matrices_status_valid", sql`${table.status} IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'superseded')`),
  check("prevention_risk_matrices_version_positive", sql`${table.matrixVersion} > 0 AND ${table.version} > 0`),
  check("prevention_risk_matrices_publish_evidence", sql`${table.status} NOT IN ('approved', 'published', 'superseded') OR (${table.reviewedByUserId} IS NOT NULL AND ${table.approvedByUserId} IS NOT NULL)`),
])

export const preventionRiskEntries = pgTable("prevention_risk_entries", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  processId: text("process_id").notNull().references(() => preventionRiskProcesses.id, { onDelete: "restrict" }),
  taskId: text("task_id").notNull().references(() => preventionRiskTasks.id, { onDelete: "restrict" }),
  positionId: text("position_id").notNull().references(() => preventionRiskPositions.id, { onDelete: "restrict" }),
  hazardCode: text("hazard_code").notNull(),
  hazard: text("hazard").notNull(),
  /* "Riesgo" (§11.12 de la ficha) es un dato DISTINTO de "Peligro" en la
   * plantilla real (columnas K=PELIGRO y L=RIESGO separadas en RE-04 IPER;
   * p. ej. peligro="cinta transportadora sin resguardo", riesgo="atrapamiento").
   * El esquema sólo tenía `hazard` — se agrega acá al descubrir el vacío
   * implementando el importador real. Nullable: filas existentes conflaban
   * ambos en `hazard` y no se puede reconstruir el riesgo específico sin
   * inventar texto; el creador guiado y el importador lo exigen desde ahora. */
  risk: text("risk"),
  riskFactor: text("risk_factor").notNull(),
  expectedEventOrDamage: text("expected_event_or_damage").notNull(),
  exposedPeopleDescription: text("exposed_people_description").notNull(),
  exposedPeopleCount: integer("exposed_people_count"),
  genderConsiderations: text("gender_considerations").notNull(),
  sensitiveWorkerConsiderations: text("sensitive_worker_considerations").notNull(),
  specialMethodologyReference: text("special_methodology_reference"),
  /* La evaluación "inherente" (antes de controles) es opcional a propósito:
   * la plantilla real de la empresa (RE-04 IPER) sólo tiene UNA evaluación
   * P×C por fila, que mapea a residual. Forzar una segunda evaluación en el
   * creador guiado inventaría un dato que nadie completa. */
  inherentDimensions: jsonb("inherent_dimensions"),
  inherentScore: numeric("inherent_score", { precision: 12, scale: 4, mode: "number" }),
  inherentLevel: text("inherent_level"),
  residualDimensions: jsonb("residual_dimensions").notNull(),
  residualScore: numeric("residual_score", { precision: 12, scale: 4, mode: "number" }),
  residualLevel: text("residual_level").notNull(),
  /* Motor de evaluación P×C (lib/prevention/risk-engine.ts). Nullable: filas
   * existentes no tienen probabilidad/consecuencia y no se inventan
   * (scripts/backfill-risk-classification.ts sólo deriva `riskClassification`
   * desde `residualLevel`, deja P/C en null). La obligatoriedad para filas
   * nuevas la impone `riskEntrySchema`, no el DDL. */
  probability: integer("probability"),
  consequence: integer("consequence"),
  riskMagnitude: integer("risk_magnitude"),
  riskClassification: text("risk_classification"),
  /* Discrepancia entre el MR/clasificación que traía el Excel importado y el
   * calculado por el sistema (ficha §67): se guarda para trazabilidad, nunca
   * bloquea el lote. Forma: {excelMagnitude, excelClassification,
   * systemMagnitude, systemClassification}. */
  evaluationDivergence: jsonb("evaluation_divergence"),
  /* Columnas de la plantilla real (RE-04 IPER) sin destino hasta ahora:
   * RUTINARIA/NO RUTINARIA, LUGAR DE TRABAJO ESPECÍFICO, N° TRABAJADORES
   * F/M/OTRO, ESTA CONTROLADO EL RIESGO, PLAZOS. */
  isRoutine: boolean("is_routine").notNull().default(true),
  specificWorkplace: text("specific_workplace"),
  exposedWorkersFemale: integer("exposed_workers_female"),
  exposedWorkersMale: integer("exposed_workers_male"),
  exposedWorkersOther: integer("exposed_workers_other"),
  controlStatusText: text("control_status_text"),
  controlDeadlineText: text("control_deadline_text"),
  isCritical: boolean("is_critical").notNull().default(false),
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  responsibleSnapshot: text("responsible_snapshot").notNull(),
  evidenceReference: text("evidence_reference"),
  sourceRowNumber: integer("source_row_number"),
  sourceOriginal: jsonb("source_original"),
  sourceNormalized: jsonb("source_normalized"),
  normalizationDecision: text("normalization_decision"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_entries_matrix_identity_unique").on(table.matrixId, table.processId, table.taskId, table.positionId, table.hazardCode),
  index("prevention_risk_entries_matrix_level_idx").on(table.matrixId, table.residualLevel),
  // Vista matriz (Fase 5): filtro por clasificación dentro de una matriz — la
  // consulta más frecuente de una tabla que puede superar las 200 filas.
  index("prevention_risk_entries_matrix_classification_idx").on(table.matrixId, table.riskClassification),
  /* MIPER-01: el nivel era texto libre al escribir y un enum inglés al leer, así
   * que convivían "Alto", "critico", "moderate" y "high" en la misma columna y la
   * UI pintaba en gris todo lo que no fuera inglés. La fuente de verdad es
   * lib/prevention/risk-levels (`RISK_LEVELS`); esto la vuelve exigible también
   * para lo que entra por seeds y scripts, que no pasan por Zod. */
  check("prevention_risk_entries_inherent_level_valid", sql`${table.inherentLevel} IS NULL OR ${table.inherentLevel} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_risk_entries_residual_level_valid", sql`${table.residualLevel} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_risk_entries_exposed_count_valid", sql`${table.exposedPeopleCount} IS NULL OR ${table.exposedPeopleCount} >= 0`),
  check("prevention_risk_entries_version_positive", sql`${table.version} > 0`),
  /* Motor P×C (lib/prevention/risk-engine.ts). `probability`/`consequence`
   * fijos a 1/2/4 porque hoy sólo existe la metodología ISP 3×3; el CHECK de
   * `risk_magnitude` es el invariante agnóstico a la escala (producto, no
   * enumeración) para que una metodología futura de otra escala no exija
   * tocar este constraint — y para que ninguna ruta de escritura pueda dejar
   * la tripleta inconsistente, sea cual sea la metodología. */
  check("prevention_risk_entries_probability_valid", sql`${table.probability} IS NULL OR ${table.probability} IN (1, 2, 4)`),
  check("prevention_risk_entries_consequence_valid", sql`${table.consequence} IS NULL OR ${table.consequence} IN (1, 2, 4)`),
  check("prevention_risk_entries_magnitude_product", sql`${table.riskMagnitude} IS NULL OR (${table.probability} IS NOT NULL AND ${table.consequence} IS NOT NULL AND ${table.riskMagnitude} = ${table.probability} * ${table.consequence})`),
  check("prevention_risk_entries_classification_valid", sql`${table.riskClassification} IS NULL OR ${table.riskClassification} IN ('tolerable', 'moderado', 'importante', 'intolerable')`),
  check("prevention_risk_entries_control_status_text_valid", sql`${table.controlStatusText} IS NULL OR ${table.controlStatusText} IN ('controlled', 'partial', 'partial_immediate')`),
  check("prevention_risk_entries_exposed_workers_valid", sql`(${table.exposedWorkersFemale} IS NULL OR ${table.exposedWorkersFemale} >= 0) AND (${table.exposedWorkersMale} IS NULL OR ${table.exposedWorkersMale} >= 0) AND (${table.exposedWorkersOther} IS NULL OR ${table.exposedWorkersOther} >= 0)`),
])

/* ── Mapa de riesgos espacial ─────────────────────────────────────────────
 * Plano de planta por faena con marcadores ubicados sobre la imagen (no una
 * matriz tabular ni un heatmap): requisito Oro de la certificación Mutual.
 * No hay librería de mapas en el repo; el marcador se guarda como porcentaje
 * de la imagen (0-100), y el overlay se dibuja con CSS puro en el cliente.
 */
export const preventionRiskMapLayouts = pgTable("prevention_risk_map_layouts", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  imagePath: text("image_path").notNull(),
  imageMimeType: text("image_mime_type").notNull(),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_map_layout_active_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_risk_map_layout_status_valid", sql`${table.status} IN ('active', 'archived')`),
  check("prevention_risk_map_layout_version_positive", sql`${table.version} >= 1`),
])

export const preventionRiskMapMarkers = pgTable("prevention_risk_map_markers", {
  id: text("id").primaryKey(),
  layoutId: text("layout_id").notNull().references(() => preventionRiskMapLayouts.id, { onDelete: "cascade" }),
  riskEntryId: text("risk_entry_id").notNull().references(() => preventionRiskEntries.id, { onDelete: "restrict" }),
  xPct: numeric("x_pct", { precision: 5, scale: 2, mode: "number" }).notNull(),
  yPct: numeric("y_pct", { precision: 5, scale: 2, mode: "number" }).notNull(),
  label: text("label"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_map_marker_layout_idx").on(table.layoutId),
  check("prevention_risk_map_marker_x_valid", sql`${table.xPct} BETWEEN 0 AND 100`),
  check("prevention_risk_map_marker_y_valid", sql`${table.yPct} BETWEEN 0 AND 100`),
])

export const preventionRiskControls = pgTable("prevention_risk_controls", {
  id: text("id").primaryKey(),
  riskEntryId: text("risk_entry_id").notNull().references(() => preventionRiskEntries.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  hierarchy: text("hierarchy").notNull(),
  isExisting: boolean("is_existing").notNull().default(false),
  isCritical: boolean("is_critical").notNull().default(false),
  performanceStandard: text("performance_standard"),
  verificationFrequency: text("verification_frequency"),
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  responsibleSnapshot: text("responsible_snapshot").notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("proposed"),
  evidenceReference: text("evidence_reference"),
  lastVerifiedByUserId: text("last_verified_by_user_id").references(() => users.id),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "string" }),
  effectivenessStatus: text("effectiveness_status").notNull().default("not_assessed"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_controls_entry_idx").on(table.riskEntryId),
  check("prevention_risk_controls_hierarchy_valid", sql`${table.hierarchy} IN ('elimination', 'substitution', 'engineering', 'administrative', 'ppe')`),
  check("prevention_risk_controls_status_valid", sql`${table.status} IN ('proposed', 'implemented', 'verified', 'ineffective', 'retired')`),
  check("prevention_risk_controls_effectiveness_valid", sql`${table.effectivenessStatus} IN ('not_assessed', 'effective', 'ineffective')`),
  check("prevention_risk_controls_critical_standard", sql`${table.isCritical} = false OR (length(coalesce(${table.performanceStandard}, '')) >= 5 AND length(coalesce(${table.verificationFrequency}, '')) >= 2)`),
])

export const preventionRiskReviewTriggers = pgTable("prevention_risk_review_triggers", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  matrixId: text("matrix_id").references(() => preventionRiskMatrices.id, { onDelete: "set null" }),
  triggerType: text("trigger_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id),
  dueAt: text("due_at").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_review_triggers_scope_status_due_idx").on(table.worksiteId, table.status, table.dueAt),
  check("prevention_risk_review_triggers_type_valid", sql`${table.triggerType} IN ('annual', 'work_change', 'work_accident', 'occupational_disease', 'grave_imminent', 'new_material_process', 'audit_finding', 'critical_control_failure', 'legal_change', 'manual')`),
  check("prevention_risk_review_triggers_status_valid", sql`${table.status} IN ('pending', 'in_progress', 'completed', 'cancelled')`),
])

export const preventionRiskImportBatches = pgTable("prevention_risk_import_batches", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  sourceFileName: text("source_file_name").notNull(),
  sourceFilePath: text("source_file_path").notNull(),
  sourceChecksumSha256: text("source_checksum_sha256").notNull(),
  sourceSizeBytes: integer("source_size_bytes").notNull(),
  sourceSheetName: text("source_sheet_name").notNull(),
  status: text("status").notNull().default("staged"),
  totalRows: integer("total_rows").notNull().default(0),
  readyRows: integer("ready_rows").notNull().default(0),
  reviewRows: integer("review_rows").notNull().default(0),
  activatedMatrixId: text("activated_matrix_id").references(() => preventionRiskMatrices.id, { onDelete: "set null" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  activatedByUserId: text("activated_by_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_import_batches_scope_checksum_unique").on(table.worksiteId, table.sourceChecksumSha256),
  check("prevention_risk_import_batches_status_valid", sql`${table.status} IN ('staged', 'reviewed', 'approved', 'activated', 'rejected')`),
  check("prevention_risk_import_batches_size_positive", sql`${table.sourceSizeBytes} > 0`),
])

export const preventionRiskImportRows = pgTable("prevention_risk_import_rows", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => preventionRiskImportBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  original: jsonb("original").notNull(),
  normalized: jsonb("normalized").notNull(),
  fingerprintSha256: text("fingerprint_sha256").notNull(),
  status: text("status").notNull(),
  issues: jsonb("issues").notNull().default([]),
  resolution: text("resolution"),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  riskEntryId: text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_import_rows_batch_row_unique").on(table.batchId, table.rowNumber),
  check("prevention_risk_import_rows_status_valid", sql`${table.status} IN ('ready', 'needs_review', 'duplicate', 'rejected', 'activated')`),
])

export const preventionLegalRequirements = pgTable("prevention_legal_requirements", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  requirementVersion: integer("requirement_version").notNull(),
  sourceType: text("source_type").notNull(),
  authority: text("authority").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceReference: text("source_reference").notNull(),
  sourceUrl: text("source_url"),
  article: text("article").notNull(),
  requirement: text("requirement").notNull(),
  versionLabel: text("version_label").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  topic: text("topic").notNull(),
  chomeRole: text("chome_role").notNull(),
  evidenceRequired: text("evidence_required").notNull(),
  frequency: text("frequency").notNull(),
  status: text("status").notNull().default("draft"),
  /* Registro —no control— de qué requisito reemplazó este al publicarse. El
   * control es la supersesión por código de `transitionLegalRequirement`
   * (LEGAL-02) más el índice parcial de un solo publicado por código; esta
   * columna deja el enlace consultable en la fila.
   *
   * A propósito NO exige el mismo código: el enlace explícito existe para la
   * renumeración normativa, donde el artículo nuevo lleva otro código y es el
   * único modo de retirar el antiguo. `restrict` porque el registro legal es
   * oponible: no se borra un requisito que otro declara haber reemplazado.
   *
   * El nombre que Drizzle le genera a esta FK mide 90 caracteres y Postgres lo
   * guarda truncado a 63 —`prevention_legal_requirements_supersedes_requirement_id_prevent`—
   * emitiendo un NOTICE 42622 al aplicar la migración 0176. No se renombra a
   * propósito: Postgres trunca los identificadores también al LEERLOS, así que
   * un `DROP CONSTRAINT` escrito con el nombre largo encuentra igual la
   * constraint (verificado con ALTER TABLE ... DROP CONSTRAINT + ROLLBACK
   * contra una base real). Renombrarla costaría una migración de puro
   * cosmético sobre una tabla ya desplegada. */
  supersedesRequirementId: text("supersedes_requirement_id").references((): AnyPgColumn => preventionLegalRequirements.id, { onDelete: "restrict" }),
  publishedHashSha256: text("published_hash_sha256"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  publishedByUserId: text("published_by_user_id").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_legal_requirements_code_version_unique").on(table.code, table.requirementVersion),
  index("prevention_legal_requirements_status_topic_idx").on(table.status, table.topic),
  /* Un solo texto vigente por código, igual que la MIPER
   * (`prevention_risk_matrices_one_published_scope_unique`): dos versiones
   * publicadas del mismo artículo son dos obligaciones contradictorias y el
   * registro legal deja de ser oponible. La supersesión automática al publicar
   * (`transitionLegalRequirement`) es lo que evita chocar contra este índice. */
  uniqueIndex("prevention_legal_requirements_one_published_code_unique").on(table.code).where(sql`${table.status} = 'published'`),
  check("prevention_legal_requirements_source_type_valid", sql`${table.sourceType} IN ('legal', 'regulatory', 'contractual', 'standard', 'internal')`),
  check("prevention_legal_requirements_status_valid", sql`${table.status} IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'superseded')`),
  check("prevention_legal_requirements_publish_evidence", sql`${table.status} NOT IN ('approved', 'published', 'superseded') OR (${table.reviewedByUserId} IS NOT NULL AND ${table.approvedByUserId} IS NOT NULL)`),
])

export const preventionLegalApplicabilities = pgTable("prevention_legal_applicabilities", {
  id: text("id").primaryKey(),
  requirementId: text("requirement_id").notNull().references(() => preventionLegalRequirements.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  processId: text("process_id").references(() => preventionRiskProcesses.id, { onDelete: "set null" }),
  activityReference: text("activity_reference"),
  applicabilityStatus: text("applicability_status").notNull().default("pending"),
  rationale: text("rationale").notNull(),
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  responsibleSnapshot: text("responsible_snapshot").notNull(),
  evidenceReference: text("evidence_reference"),
  evidenceDueAt: text("evidence_due_at"),
  complianceStatus: text("compliance_status").notNull().default("not_assessed"),
  assessedByUserId: text("assessed_by_user_id").references(() => users.id),
  assessedAt: timestamp("assessed_at", { withTimezone: true, mode: "string" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_legal_applicabilities_requirement_scope_unique").on(table.requirementId, table.worksiteId, table.processId),
  /* LEGAL-04: el índice de arriba no cubre el caso más común. En SQL
   * `NULL != NULL`, así que con proceso nulo —"toda la faena", lo que envía el
   * formulario por defecto— no restringe nada: dos `proposeLegalApplicability`
   * simultáneos leen "no existe" y ambos insertan, y la faena queda con dos
   * pronunciamientos sobre el mismo requisito. Se agrega el índice parcial en
   * vez de `NULLS NOT DISTINCT` (Postgres 15+, y sólo lo expone
   * `unique()`, no `uniqueIndex()`) o de `COALESCE`: es el mismo efecto sin
   * reescribir el índice existente ni depender de la versión del motor.
   * `scripts/migration-preflight.mjs` bloquea el despliegue si la base ya
   * traía duplicados, porque un índice que falla al crearse rompe la migración. */
  uniqueIndex("prevention_legal_applicabilities_requirement_scope_null_process_unique")
    .on(table.requirementId, table.worksiteId)
    .where(sql`${table.processId} IS NULL`),
  index("prevention_legal_applicabilities_scope_status_idx").on(table.worksiteId, table.applicabilityStatus, table.complianceStatus),
  check("prevention_legal_applicabilities_status_valid", sql`${table.applicabilityStatus} IN ('pending', 'proposed_applicable', 'proposed_not_applicable', 'applicable', 'not_applicable')`),
  check("prevention_legal_applicabilities_compliance_valid", sql`${table.complianceStatus} IN ('not_assessed', 'compliant', 'partial', 'noncompliant', 'not_applicable')`),
  check("prevention_legal_applicabilities_non_applicable_evidence", sql`${table.applicabilityStatus} <> 'not_applicable' OR (length(${table.rationale}) >= 10 AND ${table.approvedByUserId} IS NOT NULL)`),
])

export const preventionLegalAssessments = pgTable("prevention_legal_assessments", {
  id: text("id").primaryKey(),
  applicabilityId: text("applicability_id").notNull().references(() => preventionLegalApplicabilities.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  finding: text("finding"),
  evidenceReference: text("evidence_reference"),
  capaActionId: text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "restrict" }),
  assessedByUserId: text("assessed_by_user_id").notNull().references(() => users.id),
  assessedAt: timestamp("assessed_at", { withTimezone: true, mode: "string" }).notNull(),
  nextAssessmentAt: text("next_assessment_at"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_legal_assessments_applicability_date_idx").on(table.applicabilityId, table.assessedAt),
  check("prevention_legal_assessments_status_valid", sql`${table.status} IN ('compliant', 'partial', 'noncompliant', 'not_applicable')`),
  check("prevention_legal_assessments_gap_capa", sql`${table.status} NOT IN ('partial', 'noncompliant') OR (${table.capaActionId} IS NOT NULL AND length(coalesce(${table.finding}, '')) >= 5)`),
])

export const preventionPdtpSourceLinks = pgTable("prevention_pdtp_source_links", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersionSnapshot: text("source_version_snapshot").notNull(),
  justification: text("justification").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  retiredByUserId: text("retired_by_user_id").references(() => users.id),
  retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
  retirementReason: text("retirement_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_pdtp_source_links_active_unique").on(table.activityId, table.worksiteId, table.sourceType, table.sourceId).where(sql`${table.isActive} = true`),
  index("prevention_pdtp_source_links_source_idx").on(table.sourceType, table.sourceId),
  // 'incident' se retiró: era inalcanzable desde la aplicación (nunca estuvo en
  // el zod enum) y duplicaba a 'incident_capa', que es el vínculo con sentido —
  // lo que cubre una actividad del programa es la acción correctiva del
  // incidente, no el incidente en sí. Ninguna fila puede tenerlo.
  check("prevention_pdtp_source_links_type_valid", sql`${table.sourceType} IN ('risk_control', 'legal_requirement', 'incident_capa', 'audit', 'contractual_obligation', 'capacitacion', 'inspeccion', 'cphs', 'epp', 'emergencia', 'campana', 'protocolo_minsal')`),
])

export const preventionPdtpUpdateObligations = pgTable("prevention_pdtp_update_obligations", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersionSnapshot: text("source_version_snapshot").notNull(),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("pending"),
  addressedByProgramId: text("addressed_by_program_id").references(() => pdtpPrograms.id, { onDelete: "set null" }),
  addressedByUserId: text("addressed_by_user_id").references(() => users.id),
  addressedAt: timestamp("addressed_at", { withTimezone: true, mode: "string" }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_pdtp_update_obligations_scope_status_due_idx").on(table.worksiteId, table.status, table.dueAt),
  check("prevention_pdtp_update_obligations_source_valid", sql`${table.sourceType} IN ('risk_matrix', 'legal_requirement')`),
  check("prevention_pdtp_update_obligations_status_valid", sql`${table.status} IN ('pending', 'addressed', 'overdue', 'waived')`),
])

export const preventionRiskLegalHistory = pgTable("prevention_risk_legal_history", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  changeType: text("change_type").notNull(),
  reason: text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_legal_history_entity_idx").on(table.domain, table.entityType, table.entityId, table.createdAt),
  check("prevention_risk_legal_history_domain_valid", sql`${table.domain} IN ('risk', 'legal', 'pdtp_coverage', 'import')`),
])

/* ── Programa de Trabajo Preventivo de MIPER = CAPA con sourceType:'risk' ──
 * El camino común (una acción por riesgo) usa `sourceId = riskEntryId`
 * directo en `prevention_capa_actions`, sin fila puente. Esta tabla sólo
 * cubre el caso N:N real: una acción que cubre varios riesgos a la vez
 * (generación en lote con "agrupar seleccionados"). Vive del lado MIPER, no
 * del lado CAPA, para no meter una FK a riesgos en un esquema que hoy es
 * agnóstico de fuente. */
export const preventionCapaRiskLinks = pgTable("prevention_capa_risk_links", {
  id: text("id").primaryKey(),
  capaActionId: text("capa_action_id").notNull().references(() => preventionCapaActions.id, { onDelete: "cascade" }),
  riskEntryId: text("risk_entry_id").notNull().references(() => preventionRiskEntries.id, { onDelete: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_capa_risk_links_unique").on(table.capaActionId, table.riskEntryId),
  index("prevention_capa_risk_links_capa_idx").on(table.capaActionId),
  index("prevention_capa_risk_links_risk_entry_idx").on(table.riskEntryId),
])

/* ── Doble aprobación (Prevención + Operaciones) — §48-51 de la ficha ──────
 * Hasta ahora `transitionRiskMatrix` sólo pedía una aprobación
 * (`prevention:risk:approve`). Una fila por dominio, única por
 * (matrixId, domain): cuando ambas quedan 'approved' en la misma
 * transacción, la matriz pasa a 'approved'. Un 'rejected' de cualquiera
 * borra ambas filas y la matriz vuelve a 'draft' — la ronda siguiente firma
 * de cero, porque el contenido cambió. */
export const preventionRiskMatrixApprovals = pgTable("prevention_risk_matrix_approvals", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  decision: text("decision").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull(),
  /* Backfill del modelo anterior (aprobación única): distingue una firma real
   * de una derivada de `approvedByUserId` al migrar. Columna, no texto en
   * `reason`, para poder auditar/revertir el backfill con una condición SQL
   * simple — ver scripts/backfill-risk-matrix-approvals.ts. */
  migratedFromLegacy: boolean("migrated_from_legacy").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_matrix_approvals_unique").on(table.matrixId, table.domain),
  index("prevention_risk_matrix_approvals_matrix_idx").on(table.matrixId),
  check("prevention_risk_matrix_approvals_domain_valid", sql`${table.domain} IN ('prevention', 'operations')`),
  check("prevention_risk_matrix_approvals_decision_valid", sql`${table.decision} IN ('approved', 'rejected')`),
])
