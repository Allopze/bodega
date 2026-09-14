import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionLegalRequirements, preventionRiskEntries } from "./risk-legal"

/* ── Catálogo de cursos ───────────────────────────────────────────────────
 * `minimumDurationMinutes` y `validityMonths` son parámetros regulatorios
 * configurables, no constantes de código: el DS 44 art. 16 exige capacitación
 * de al menos 8 horas con periodicidad no superior a 2 años, pero la
 * aplicabilidad concreta la valida Prevención por curso. El servicio verifica
 * el piso legal contra estos valores en vez de asumirlos.
 */
export const preventionTrainingCourses = pgTable("prevention_training_courses", {
  id:                     text("id").primaryKey(),
  code:                   text("code").notNull().unique(),
  name:                   text("name").notNull(),
  kind:                   text("kind").notNull(),
  description:            text("description"),
  minimumDurationMinutes: integer("minimum_duration_minutes").notNull().default(480),
  validityMonths:         integer("validity_months"),
  requiresAssessment:     boolean("requires_assessment").notNull().default(true),
  passingScore:           integer("passing_score").notNull().default(70),
  legalRequirementId:     text("legal_requirement_id").references(() => preventionLegalRequirements.id, { onDelete: "set null" }),
  riskEntryId:            text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  legalBasis:             text("legal_basis"),
  isActive:               boolean("is_active").notNull().default(true),
  /** Números de actividad PDTP (campo `n`) que este curso acredita al cerrar
   * una sesión. Null = no vinculado al PDTP (comportamiento previo). */
  pdtpActivityNumbers:    jsonb("pdtp_activity_numbers").$type<number[]>(),
  createdByUserId:        text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_training_course_kind_idx").on(table.kind, table.isActive),
  check("prevention_training_course_kind_valid", sql`${table.kind} IN ('induction_corporate', 'induction_worksite', 'odi', 'legal_mandatory', 'operational_talk', 'practical_training', 'certification', 'retraining')`),
  check("prevention_training_course_duration_positive", sql`${table.minimumDurationMinutes} > 0`),
  check("prevention_training_course_validity_positive", sql`${table.validityMonths} IS NULL OR ${table.validityMonths} > 0`),
  check("prevention_training_course_score_valid", sql`${table.passingScore} BETWEEN 0 AND 100`),
])

/* ── Versiones de contenido ──────────────────────────────────────────────── */
export const preventionTrainingCourseVersions = pgTable("prevention_training_course_versions", {
  id:                  text("id").primaryKey(),
  courseId:            text("course_id").notNull().references(() => preventionTrainingCourses.id, { onDelete: "cascade" }),
  versionLabel:        text("version_label").notNull(),
  status:              text("status").notNull().default("draft"),
  contentOutline:      jsonb("content_outline").notNull(),
  durationMinutes:     integer("duration_minutes").notNull(),
  modality:            text("modality").notNull(),
  assessmentType:      text("assessment_type").notNull().default("theoretical"),
  passingScore:        integer("passing_score").notNull().default(70),
  contentHash:         text("content_hash").notNull(),
  effectiveFrom:       text("effective_from"),
  authorUserId:        text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewedByUserId:    text("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt:          timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  approvedByUserId:    text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:          timestamp("approved_at", { withTimezone: true, mode: "string" }),
  publishedByUserId:   text("published_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  publishedAt:         timestamp("published_at", { withTimezone: true, mode: "string" }),
  supersededAt:        timestamp("superseded_at", { withTimezone: true, mode: "string" }),
  supersededByVersionId: text("superseded_by_version_id"),
  observationComment:  text("observation_comment"),
  version:             integer("version").notNull().default(1),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_training_version_label_unique").on(table.courseId, table.versionLabel),
  index("prevention_training_version_status_idx").on(table.courseId, table.status),
  check("prevention_training_version_status_valid", sql`${table.status} IN ('draft', 'in_review', 'observed', 'approved', 'published', 'superseded')`),
  check("prevention_training_version_modality_valid", sql`${table.modality} IN ('presencial', 'elearning', 'mixta', 'practica', 'teorica')`),
  check("prevention_training_version_assessment_valid", sql`${table.assessmentType} IN ('none', 'theoretical', 'practical', 'both')`),
  check("prevention_training_version_duration_positive", sql`${table.durationMinutes} > 0`),
  check("prevention_training_version_score_valid", sql`${table.passingScore} BETWEEN 0 AND 100`),
  check("prevention_training_version_hash_valid", sql`length(${table.contentHash}) = 64`),
  check("prevention_training_version_observed_has_comment", sql`${table.status} <> 'observed' OR length(${table.observationComment}) >= 10`),
  check("prevention_training_version_version_positive", sql`${table.version} >= 1`),
])

/* ── Sesiones ─────────────────────────────────────────────────────────────
 * El instructor puede ser interno (usuario) o externo (relator contratado).
 * En ambos casos se exige evidencia de su competencia: el DS 44 art. 16 pide
 * capacitación con contenidos y evaluación, y un relator sin respaldo
 * invalida la evidencia formativa.
 */
export const preventionTrainingSessions = pgTable("prevention_training_sessions", {
  id:                    text("id").primaryKey(),
  code:                  text("code").notNull().unique(),
  courseVersionId:       text("course_version_id").notNull().references(() => preventionTrainingCourseVersions.id, { onDelete: "restrict" }),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  scheduledAt:           timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  startedAt:             timestamp("started_at", { withTimezone: true, mode: "string" }),
  endedAt:               timestamp("ended_at", { withTimezone: true, mode: "string" }),
  durationMinutes:       integer("duration_minutes"),
  modality:              text("modality").notNull(),
  location:              text("location"),
  instructorUserId:      text("instructor_user_id").references(() => users.id, { onDelete: "restrict" }),
  instructorExternalName: text("instructor_external_name"),
  instructorCompetencyEvidence: text("instructor_competency_evidence").notNull(),
  status:                text("status").notNull().default("planned"),
  cancellationReason:    text("cancellation_reason"),
  cancelledByUserId:     text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  closedByUserId:        text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:              timestamp("closed_at", { withTimezone: true, mode: "string" }),
  version:               integer("version").notNull().default(1),
  createdByUserId:       text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_training_session_worksite_idx").on(table.worksiteId, table.status),
  index("prevention_training_session_schedule_idx").on(table.scheduledAt),
  check("prevention_training_session_status_valid", sql`${table.status} IN ('planned', 'in_progress', 'completed', 'cancelled')`),
  check("prevention_training_session_modality_valid", sql`${table.modality} IN ('presencial', 'elearning', 'mixta', 'practica', 'teorica')`),
  check("prevention_training_session_instructor_present", sql`${table.instructorUserId} IS NOT NULL OR length(${table.instructorExternalName}) >= 3`),
  check("prevention_training_session_instructor_evidence", sql`length(${table.instructorCompetencyEvidence}) >= 5`),
  check("prevention_training_session_duration_positive", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0`),
  check("prevention_training_session_cancel_consistent", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
  check("prevention_training_session_version_positive", sql`${table.version} >= 1`),
])

/* ── Asistencia, evaluación y acuse ───────────────────────────────────────
 * Guarda el denominador real: convocados vs. presentes. El acuse firma
 * sesión, contenido y persona, igual que el acuse documental.
 */
export const preventionTrainingAttendance = pgTable("prevention_training_attendance", {
  id:                     text("id").primaryKey(),
  sessionId:              text("session_id").notNull().references(() => preventionTrainingSessions.id, { onDelete: "cascade" }),
  workerId:               text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  status:                 text("status").notNull().default("convened"),
  attendanceMinutes:      integer("attendance_minutes"),
  assessmentScore:        integer("assessment_score"),
  assessmentAttempts:     integer("assessment_attempts").notNull().default(0),
  assessmentResult:       text("assessment_result").notNull().default("pending"),
  excuseReason:           text("excuse_reason"),
  evidenceReference:      text("evidence_reference"),
  acknowledgementSha256:  text("acknowledgement_sha256"),
  acknowledgedAt:         timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  acknowledgementMethod:  text("acknowledgement_method"),
  acknowledgementIp:      text("acknowledgement_ip"),
  acknowledgementUserAgent: text("acknowledgement_user_agent"),
  /**
   * CAP-002 (auditoría 2026-09-14): por dónde entró el acuse. Antes sólo había
   * un canal posible —una sesión de la plataforma—, porque acusar exigía
   * cuenta; ahora existe la vía de enlace con token para el trabajador sin
   * cuenta y hay que poder distinguirlos en la evidencia.
   */
  acknowledgementChannel: text("acknowledgement_channel"),
  recordedByUserId:       text("recorded_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_training_attendance_unique").on(table.sessionId, table.workerId),
  index("prevention_training_attendance_worker_idx").on(table.workerId),
  check("prevention_training_attendance_status_valid", sql`${table.status} IN ('convened', 'attended', 'absent', 'excused')`),
  check("prevention_training_attendance_result_valid", sql`${table.assessmentResult} IN ('pending', 'approved', 'failed', 'not_required')`),
  check("prevention_training_attendance_score_valid", sql`${table.assessmentScore} IS NULL OR ${table.assessmentScore} BETWEEN 0 AND 100`),
  check("prevention_training_attendance_attempts_valid", sql`${table.assessmentAttempts} >= 0`),
  check("prevention_training_attendance_minutes_valid", sql`${table.attendanceMinutes} IS NULL OR ${table.attendanceMinutes} >= 0`),
  check("prevention_training_attendance_excuse_consistent", sql`${table.status} <> 'excused' OR length(${table.excuseReason}) >= 5`),
  check("prevention_training_attendance_ack_channel_valid", sql`(${table.acknowledgedAt} IS NULL AND ${table.acknowledgementChannel} IS NULL) OR (${table.acknowledgedAt} IS NOT NULL AND ${table.acknowledgementChannel} IN ('account', 'public_token'))`),
  check("prevention_training_attendance_ack_consistent", sql`(${table.acknowledgedAt} IS NULL AND ${table.acknowledgementSha256} IS NULL) OR (${table.acknowledgedAt} IS NOT NULL AND length(${table.acknowledgementSha256}) = 64 AND ${table.acknowledgementMethod} IS NOT NULL)`),
])

/* ── Competencia vigente por trabajador ───────────────────────────────────
 * Fuente única de "esta persona está habilitada". Se puebla desde una sesión
 * aprobada o desde una convalidación externa aprobada de forma segregada.
 */
export const preventionWorkerCompetencies = pgTable("prevention_worker_competencies", {
  id:                    text("id").primaryKey(),
  workerId:              text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  courseId:              text("course_id").notNull().references(() => preventionTrainingCourses.id, { onDelete: "restrict" }),
  sourceType:            text("source_type").notNull(),
  sourceSessionId:       text("source_session_id").references(() => preventionTrainingSessions.id, { onDelete: "set null" }),
  sourceAttendanceId:    text("source_attendance_id").references(() => preventionTrainingAttendance.id, { onDelete: "set null" }),
  grantedAt:             text("granted_at").notNull(),
  expiresAt:             text("expires_at"),
  status:                text("status").notNull().default("valid"),
  evidenceReference:     text("evidence_reference"),
  externalIssuer:        text("external_issuer"),
  externalCertificateNumber: text("external_certificate_number"),
  convalidationJustification: text("convalidation_justification"),
  convalidationApprovedByUserId: text("convalidation_approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  convalidationApprovedAt: timestamp("convalidation_approved_at", { withTimezone: true, mode: "string" }),
  revokedByUserId:       text("revoked_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  revokedAt:             timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  revocationReason:      text("revocation_reason"),
  createdByUserId:       text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_worker_competency_lookup_idx").on(table.workerId, table.courseId, table.status),
  index("prevention_worker_competency_expiry_idx").on(table.expiresAt, table.status),
  uniqueIndex("prevention_worker_competency_attendance_unique").on(table.sourceAttendanceId),
  check("prevention_worker_competency_source_valid", sql`${table.sourceType} IN ('session', 'convalidation', 'external_certificate')`),
  check("prevention_worker_competency_status_valid", sql`${table.status} IN ('valid', 'expired', 'revoked', 'superseded')`),
  check("prevention_worker_competency_convalidation_consistent", sql`${table.sourceType} <> 'convalidation' OR (length(${table.convalidationJustification}) >= 10 AND ${table.convalidationApprovedByUserId} IS NOT NULL AND ${table.convalidationApprovedAt} IS NOT NULL)`),
  check("prevention_worker_competency_external_consistent", sql`${table.sourceType} <> 'external_certificate' OR (length(${table.externalIssuer}) >= 2 AND length(${table.evidenceReference}) >= 3)`),
  check("prevention_worker_competency_revoke_consistent", sql`(${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL AND ${table.revocationReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByUserId} IS NOT NULL AND length(${table.revocationReason}) >= 5)`),
])

/* ── Requisitos de competencia ────────────────────────────────────────────
 * Define qué curso exige qué población. `enforcement` distingue el bloqueo
 * duro (tarea crítica) de la advertencia, según el audit §7.4.
 */
export const preventionCompetencyRequirements = pgTable("prevention_competency_requirements", {
  id:                 text("id").primaryKey(),
  courseId:           text("course_id").notNull().references(() => preventionTrainingCourses.id, { onDelete: "cascade" }),
  scopeType:          text("scope_type").notNull(),
  scopeValue:         text("scope_value"),
  worksiteId:         text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  enforcement:        text("enforcement").notNull().default("warning"),
  reason:             text("reason").notNull(),
  legalRequirementId: text("legal_requirement_id").references(() => preventionLegalRequirements.id, { onDelete: "set null" }),
  riskEntryId:        text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  isActive:           boolean("is_active").notNull().default(true),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_competency_requirement_scope_idx").on(table.scopeType, table.isActive),
  index("prevention_competency_requirement_worksite_idx").on(table.worksiteId, table.isActive),
  // `committee` lleva el id del comité en `scope_value`: permite declarar
  // "los integrantes del CPHS requieren este curso" (orientación en prevención,
  // curso de 20 horas), que es requisito de la certificación Mutual.
  check("prevention_competency_requirement_scope_valid", sql`${table.scopeType} IN ('global', 'worksite', 'position', 'task', 'committee')`),
  check("prevention_competency_requirement_enforcement_valid", sql`${table.enforcement} IN ('blocking', 'warning')`),
  check("prevention_competency_requirement_reason_valid", sql`length(${table.reason}) >= 10`),
  check("prevention_competency_requirement_scope_value_present", sql`${table.scopeType} IN ('global', 'worksite') OR length(${table.scopeValue}) >= 1`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionTrainingHistory = pgTable("prevention_training_history", {
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
  index("prevention_training_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionTrainingCoursesRelations = relations(preventionTrainingCourses, ({ one, many }) => ({
  legalRequirement: one(preventionLegalRequirements, { fields: [preventionTrainingCourses.legalRequirementId], references: [preventionLegalRequirements.id] }),
  riskEntry: one(preventionRiskEntries, { fields: [preventionTrainingCourses.riskEntryId], references: [preventionRiskEntries.id] }),
  versions: many(preventionTrainingCourseVersions),
  requirements: many(preventionCompetencyRequirements),
}))

export const preventionTrainingCourseVersionsRelations = relations(preventionTrainingCourseVersions, ({ one, many }) => ({
  course: one(preventionTrainingCourses, { fields: [preventionTrainingCourseVersions.courseId], references: [preventionTrainingCourses.id] }),
  author: one(users, { fields: [preventionTrainingCourseVersions.authorUserId], references: [users.id], relationName: "trainingVersionAuthor" }),
  approver: one(users, { fields: [preventionTrainingCourseVersions.approvedByUserId], references: [users.id], relationName: "trainingVersionApprover" }),
  sessions: many(preventionTrainingSessions),
}))

export const preventionTrainingSessionsRelations = relations(preventionTrainingSessions, ({ one, many }) => ({
  courseVersion: one(preventionTrainingCourseVersions, { fields: [preventionTrainingSessions.courseVersionId], references: [preventionTrainingCourseVersions.id] }),
  worksite: one(worksites, { fields: [preventionTrainingSessions.worksiteId], references: [worksites.id] }),
  instructor: one(users, { fields: [preventionTrainingSessions.instructorUserId], references: [users.id], relationName: "trainingSessionInstructor" }),
  attendance: many(preventionTrainingAttendance),
}))

export const preventionTrainingAttendanceRelations = relations(preventionTrainingAttendance, ({ one }) => ({
  session: one(preventionTrainingSessions, { fields: [preventionTrainingAttendance.sessionId], references: [preventionTrainingSessions.id] }),
  worker: one(workers, { fields: [preventionTrainingAttendance.workerId], references: [workers.id] }),
}))

export const preventionWorkerCompetenciesRelations = relations(preventionWorkerCompetencies, ({ one }) => ({
  worker: one(workers, { fields: [preventionWorkerCompetencies.workerId], references: [workers.id] }),
  course: one(preventionTrainingCourses, { fields: [preventionWorkerCompetencies.courseId], references: [preventionTrainingCourses.id] }),
  session: one(preventionTrainingSessions, { fields: [preventionWorkerCompetencies.sourceSessionId], references: [preventionTrainingSessions.id] }),
}))

export const preventionCompetencyRequirementsRelations = relations(preventionCompetencyRequirements, ({ one }) => ({
  course: one(preventionTrainingCourses, { fields: [preventionCompetencyRequirements.courseId], references: [preventionTrainingCourses.id] }),
  worksite: one(worksites, { fields: [preventionCompetencyRequirements.worksiteId], references: [worksites.id] }),
}))

export type PreventionTrainingCourse = typeof preventionTrainingCourses.$inferSelect
export type PreventionTrainingCourseVersion = typeof preventionTrainingCourseVersions.$inferSelect
export type PreventionTrainingSession = typeof preventionTrainingSessions.$inferSelect
export type PreventionTrainingAttendance = typeof preventionTrainingAttendance.$inferSelect
export type PreventionWorkerCompetency = typeof preventionWorkerCompetencies.$inferSelect
export type PreventionCompetencyRequirement = typeof preventionCompetencyRequirements.$inferSelect
