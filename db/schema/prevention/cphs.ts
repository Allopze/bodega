import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionCapaActions } from "./capa"

/* ── Comité Paritario por centro de trabajo ───────────────────────────────
 * El DS 44 exige consulta y participación, y comité donde corresponda. El
 * mandato tiene vigencia: un comité vencido deja de ser un órgano válido.
 */
export const preventionCommittees = pgTable("prevention_committees", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  name:             text("name").notNull(),
  constitutedOn:    text("constituted_on").notNull(),
  mandateEndsOn:    text("mandate_ends_on").notNull(),
  status:           text("status").notNull().default("active"),
  meetingDayOfMonth: integer("meeting_day_of_month"),
  /* Registro ante la Dirección del Trabajo. Es un dato del comité, no un
   * documento: el acta y el comprobante se adjuntan por `sst_document_links`
   * con `entity_type = 'committee'`. */
  dtRegisteredOn:   text("dt_registered_on"),
  dtRegistrationReference: text("dt_registration_reference"),
  dissolvedReason:  text("dissolved_reason"),
  dissolvedAt:      timestamp("dissolved_at", { withTimezone: true, mode: "string" }),
  version:          integer("version").notNull().default(1),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_active_worksite_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_committee_status_valid", sql`${table.status} IN ('active', 'dissolved', 'expired')`),
  check("prevention_committee_mandate_valid", sql`${table.mandateEndsOn} > ${table.constitutedOn}`),
  check("prevention_committee_meeting_day_valid", sql`${table.meetingDayOfMonth} IS NULL OR ${table.meetingDayOfMonth} BETWEEN 1 AND 28`),
  check("prevention_committee_dissolve_consistent", sql`(${table.dissolvedAt} IS NULL AND ${table.dissolvedReason} IS NULL) OR (${table.dissolvedAt} IS NOT NULL AND length(${table.dissolvedReason}) >= 10)`),
  check("prevention_committee_dt_registration_consistent", sql`${table.dtRegisteredOn} IS NULL OR length(${table.dtRegistrationReference}) >= 3`),
  check("prevention_committee_version_positive", sql`${table.version} >= 1`),
])

/* ── Delegado de Seguridad y Salud en el Trabajo ──────────────────────────
 * Bajo 25 trabajadores no corresponde comité, pero entre 10 y 25 sí
 * corresponde delegado cuando no hay CPHS aplicable. El umbral vive en
 * `lib/prevention/cphs-organization.ts`; acá sólo se registra la designación.
 */
export const preventionWorksiteDelegates = pgTable("prevention_worksite_delegates", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  workerId:        text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  designatedOn:    text("designated_on").notNull(),
  termEndsOn:      text("term_ends_on"),
  status:          text("status").notNull().default("active"),
  endedReason:     text("ended_reason"),
  endedAt:         timestamp("ended_at", { withTimezone: true, mode: "string" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_worksite_delegate_active_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_worksite_delegate_status_valid", sql`${table.status} IN ('active', 'ended')`),
  check("prevention_worksite_delegate_term_valid", sql`${table.termEndsOn} IS NULL OR ${table.termEndsOn} > ${table.designatedOn}`),
  check("prevention_worksite_delegate_end_consistent", sql`(${table.endedAt} IS NULL AND ${table.endedReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND length(${table.endedReason}) >= 10)`),
  check("prevention_worksite_delegate_version_positive", sql`${table.version} >= 1`),
])

/* ── Programa de trabajo del comité ───────────────────────────────────────
 * Decisión D5 (2026-08-12): las actividades *del* comité salieron del PDTP
 * porque el CPHS tiene su propio programa con su propio cumplimiento. Esto es
 * ese programa, y deliberadamente NO reusa el motor del PDTP: la ocurrencia es
 * derivada del mes planificado, sin slots ni obligaciones materializadas.
 */
export const preventionCommitteePrograms = pgTable("prevention_committee_programs", {
  id:              text("id").primaryKey(),
  committeeId:     text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  year:            integer("year").notNull(),
  status:          text("status").notNull().default("draft"),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt:      timestamp("approved_at", { withTimezone: true, mode: "string" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_program_unique").on(table.committeeId, table.year),
  check("prevention_committee_program_status_valid", sql`${table.status} IN ('draft', 'active', 'closed')`),
  check("prevention_committee_program_year_valid", sql`${table.year} BETWEEN 2020 AND 2100`),
  check("prevention_committee_program_approval_consistent", sql`${table.status} = 'draft' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
  check("prevention_committee_program_version_positive", sql`${table.version} >= 1`),
])

export const preventionCommitteeProgramActivities = pgTable("prevention_committee_program_activities", {
  id:              text("id").primaryKey(),
  programId:       text("program_id").notNull().references(() => preventionCommitteePrograms.id, { onDelete: "cascade" }),
  title:           text("title").notNull(),
  description:     text("description"),
  plannedMonth:    integer("planned_month").notNull(),
  dueOn:           text("due_on"),
  responsibleMemberId: text("responsible_member_id").references(() => preventionCommitteeMembers.id, { onDelete: "set null" }),
  commissionLabel: text("commission_label"),
  riskTopic:       text("risk_topic"),
  status:          text("status").notNull().default("planned"),
  completedAt:     timestamp("completed_at", { withTimezone: true, mode: "string" }),
  completionNote:  text("completion_note"),
  evidenceReference: text("evidence_reference"),
  evidenceChecksumSha256: text("evidence_checksum_sha256"),
  /* Seguimiento en la reunión mensual: qué sesión revisó esta actividad. */
  reviewedInMeetingId: text("reviewed_in_meeting_id").references(() => preventionCommitteeMeetings.id, { onDelete: "set null" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_committee_program_activity_idx").on(table.programId, table.plannedMonth),
  check("prevention_committee_program_activity_title_valid", sql`length(${table.title}) >= 5`),
  check("prevention_committee_program_activity_month_valid", sql`${table.plannedMonth} BETWEEN 1 AND 12`),
  check("prevention_committee_program_activity_status_valid", sql`${table.status} IN ('planned', 'done', 'cancelled')`),
  check("prevention_committee_program_activity_risk_topic_valid", sql`${table.riskTopic} IS NULL OR ${table.riskTopic} IN ('vial', 'higiene', 'ergonomia', 'psicosocial', 'silice', 'otro')`),
  check("prevention_committee_program_activity_done_consistent", sql`${table.status} <> 'done' OR ${table.completedAt} IS NOT NULL`),
  check("prevention_committee_program_activity_cancel_consistent", sql`${table.status} <> 'cancelled' OR length(${table.completionNote}) >= 10`),
  check("prevention_committee_program_activity_checksum_valid", sql`${table.evidenceChecksumSha256} IS NULL OR length(${table.evidenceChecksumSha256}) = 64`),
  check("prevention_committee_program_activity_version_positive", sql`${table.version} >= 1`),
])

/* ── Integrantes ──────────────────────────────────────────────────────────
 * El comité es paritario: representantes de la empresa y de las personas
 * trabajadoras, cada cual titular o suplente.
 */
export const preventionCommitteeMembers = pgTable("prevention_committee_members", {
  id:             text("id").primaryKey(),
  committeeId:    text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  workerId:       text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  representation: text("representation").notNull(),
  seat:           text("seat").notNull(),
  role:           text("role"),
  electedOn:      text("elected_on"),
  /* Sin `term_ends_on`: bajo el DS 54 el período del integrante ES el mandato
   * del comité, que ya vence por `mandate_ends_on` vía `expireLapsedCommittees`.
   * La columna se capturaba, viajaba al cliente y no la leía ninguna regla:
   * sugería un control por persona que no existe. (La del delegado sí se aplica
   * y por eso sigue.) */
  hasFuero:       boolean("has_fuero").notNull().default(false),
  status:         text("status").notNull().default("active"),
  replacedByMemberId: text("replaced_by_member_id"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_member_unique").on(table.committeeId, table.workerId)
    .where(sql`${table.status} = 'active'`),
  index("prevention_committee_member_committee_idx").on(table.committeeId, table.status),
  check("prevention_committee_member_representation_valid", sql`${table.representation} IN ('company', 'workers')`),
  check("prevention_committee_member_seat_valid", sql`${table.seat} IN ('titular', 'suplente')`),
  check("prevention_committee_member_role_valid", sql`${table.role} IS NULL OR ${table.role} IN ('presidente', 'secretario', 'integrante')`),
  check("prevention_committee_member_status_valid", sql`${table.status} IN ('active', 'replaced', 'resigned')`),
])

/* ── Sesiones y actas ─────────────────────────────────────────────────────── */
export const preventionCommitteeMeetings = pgTable("prevention_committee_meetings", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),
  committeeId:     text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  meetingType:     text("meeting_type").notNull().default("ordinary"),
  scheduledFor:    timestamp("scheduled_for", { withTimezone: true, mode: "string" }).notNull(),
  heldAt:          timestamp("held_at", { withTimezone: true, mode: "string" }),
  agenda:          text("agenda").notNull(),
  /* "Tabla previa": buena práctica de nivel Plata — la tabla se envía a los
   * integrantes antes de la sesión, no se improvisa en la reunión. */
  agendaSentAt:    timestamp("agenda_sent_at", { withTimezone: true, mode: "string" }),
  /* Envío del acta a la alta administración: requisito de nivel Oro. */
  sentToManagementAt: timestamp("sent_to_management_at", { withTimezone: true, mode: "string" }),
  minutes:         text("minutes"),
  status:          text("status").notNull().default("scheduled"),
  quorumReached:   boolean("quorum_reached").notNull().default(false),
  closedByUserId:  text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_committee_meeting_committee_idx").on(table.committeeId, table.scheduledFor),
  check("prevention_committee_meeting_type_valid", sql`${table.meetingType} IN ('ordinary', 'extraordinary')`),
  /* Sin `held`: nada lo escribía nunca. La sesión pasa de `scheduled` a
   * `closed` cuando se cierra el acta, y una convocatoria que no se realizó se
   * cancela. Un estado intermedio inalcanzable sólo servía para ramas de UI
   * muertas. */
  check("prevention_committee_meeting_status_valid", sql`${table.status} IN ('scheduled', 'closed', 'cancelled')`),
  check("prevention_committee_meeting_closed_has_minutes", sql`${table.status} <> 'closed' OR length(${table.minutes}) >= 20`),
  check("prevention_committee_meeting_cancel_consistent", sql`${table.status} <> 'cancelled' OR length(${table.cancellationReason}) >= 10`),
  check("prevention_committee_meeting_version_positive", sql`${table.version} >= 1`),
])

/* ── Asistencia nominativa ────────────────────────────────────────────────── */
export const preventionCommitteeAttendance = pgTable("prevention_committee_attendance", {
  id:        text("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => preventionCommitteeMeetings.id, { onDelete: "cascade" }),
  /* Nullable desde el nivel Plata: la fila también representa a un invitado que
   * no integra el comité. El quórum no se ve afectado: `assessQuorum` se calcula
   * sobre integrantes, no sobre asistentes, así que un invitado nunca puede
   * completar el quórum de una sesión. */
  memberId:  text("member_id").references(() => preventionCommitteeMembers.id, { onDelete: "cascade" }),
  guestWorkerId: text("guest_worker_id").references(() => workers.id, { onDelete: "restrict" }),
  guestName: text("guest_name"),
  attended:  boolean("attended").notNull().default(false),
  excuseReason: text("excuse_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_attendance_unique").on(table.meetingId, table.memberId),
  // Una fila es de un integrante o de un invitado, nunca de los dos ni de
  // ninguno; a un invitado hay que poder nombrarlo.
  check("prevention_committee_attendance_subject_valid", sql`(${table.memberId} IS NOT NULL AND ${table.guestWorkerId} IS NULL AND ${table.guestName} IS NULL) OR (${table.memberId} IS NULL AND (${table.guestWorkerId} IS NOT NULL OR length(${table.guestName}) >= 3))`),
])

/* ── Comisiones del comité (nivel Plata) ──────────────────────────────────
 * El manual de Mutual pide que el comité se organice en comisiones con un
 * propósito declarado. Un integrante puede estar en más de una, así que la
 * pertenencia va en su propia tabla y no como columna del integrante.
 */
export const preventionCommitteeCommissions = pgTable("prevention_committee_commissions", {
  id:              text("id").primaryKey(),
  committeeId:     text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  name:            text("name").notNull(),
  purpose:         text("purpose").notNull(),
  isActive:        boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_commission_unique").on(table.committeeId, table.name)
    .where(sql`${table.isActive}`),
  check("prevention_committee_commission_name_valid", sql`length(${table.name}) >= 3`),
  check("prevention_committee_commission_purpose_valid", sql`length(${table.purpose}) >= 10`),
])

export const preventionCommitteeCommissionMembers = pgTable("prevention_committee_commission_members", {
  id:           text("id").primaryKey(),
  commissionId: text("commission_id").notNull().references(() => preventionCommitteeCommissions.id, { onDelete: "cascade" }),
  memberId:     text("member_id").notNull().references(() => preventionCommitteeMembers.id, { onDelete: "cascade" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_commission_member_unique").on(table.commissionId, table.memberId),
])

/* ── Acuerdos ─────────────────────────────────────────────────────────────
 * Todo acuerdo con responsable y plazo se deriva a CAPA común: un acuerdo sin
 * acción trazable no es seguimiento, es una nota.
 *
 * Sin columna `status`: el único INSERT la fijaba en 'capa_linked' y ningún
 * UPDATE la movía, así que 'open' y 'closed' eran inalcanzables y el tablero
 * que contaba 'open' era estructuralmente cero. El estado de un acuerdo es el
 * de su CAPA — decisión "CAPA motor único", que prohíbe el espejo.
 */
export const preventionCommitteeAgreements = pgTable("prevention_committee_agreements", {
  id:             text("id").primaryKey(),
  meetingId:      text("meeting_id").notNull().references(() => preventionCommitteeMeetings.id, { onDelete: "cascade" }),
  description:    text("description").notNull(),
  capaActionId:   text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_committee_agreement_meeting_idx").on(table.meetingId),
])

/* ── Revisión por la dirección ────────────────────────────────────────────
 * DS 44 art. 22: el SG-SST se evalúa, no sólo se ejecuta. Las decisiones y
 * compromisos quedan trazables, y los compromisos con plazo van a CAPA.
 */
export const preventionManagementReviews = pgTable("prevention_management_reviews", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),
  worksiteId:      text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  periodLabel:     text("period_label").notNull(),
  heldAt:          timestamp("held_at", { withTimezone: true, mode: "string" }).notNull(),
  inputs:          jsonb("inputs").notNull(),
  conclusions:     text("conclusions"),
  resourceDecisions: text("resource_decisions"),
  status:          text("status").notNull().default("draft"),
  closedByUserId:  text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_management_review_period_idx").on(table.periodLabel, table.heldAt),
  check("prevention_management_review_status_valid", sql`${table.status} IN ('draft', 'closed')`),
  check("prevention_management_review_closed_consistent", sql`${table.status} <> 'closed' OR (length(${table.conclusions}) >= 20 AND ${table.closedByUserId} IS NOT NULL AND ${table.closedAt} IS NOT NULL)`),
  check("prevention_management_review_version_positive", sql`${table.version} >= 1`),
])

/* ── Certificación CPHS de Mutual de Seguridad CChC ───────────────────────
 * Expediente de preparación para auditoría. No bloquea la gestión preventiva:
 * es una meta de madurez sobre datos que el sistema ya tiene. El catálogo de
 * requisitos vive en `lib/prevention/cphs-certification.ts`, no en base.
 */
export const preventionCertificationDossiers = pgTable("prevention_certification_dossiers", {
  id:              text("id").primaryKey(),
  committeeId:     text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  level:           text("level").notNull().default("bronce"),
  periodYear:      integer("period_year").notNull(),
  status:          text("status").notNull().default("draft"),
  /* Condiciones administrativas del proceso, todas declaradas por Prevención. */
  adherenceConfirmed: boolean("adherence_confirmed").notNull().default(false),
  sagecopRegistered:  boolean("sagecop_registered").notNull().default(false),
  sagecopReference:   text("sagecop_reference"),
  contributionsStatus: text("contributions_status"),
  auditedFrom:     text("audited_from"),
  auditedTo:       text("audited_to"),
  auditedOn:       text("audited_on"),
  auditResult:     text("audit_result"),
  /** Plazo de 60 días que da Mutual para cerrar brechas tras la auditoría. */
  gapsDeadlineOn:  text("gaps_deadline_on"),
  validUntilOn:    text("valid_until_on"),
  submittedAt:     timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  submittedByUserId: text("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_certification_dossier_unique").on(table.committeeId, table.level, table.periodYear),
  check("prevention_certification_dossier_level_valid", sql`${table.level} IN ('bronce', 'plata', 'oro')`),
  check("prevention_certification_dossier_status_valid", sql`${table.status} IN ('draft', 'submitted', 'certified', 'rejected')`),
  check("prevention_certification_dossier_year_valid", sql`${table.periodYear} BETWEEN 2020 AND 2100`),
  check("prevention_certification_dossier_period_valid", sql`${table.auditedFrom} IS NULL OR ${table.auditedTo} IS NULL OR ${table.auditedTo} >= ${table.auditedFrom}`),
  check("prevention_certification_dossier_submit_consistent", sql`${table.status} = 'draft' OR (${table.submittedAt} IS NOT NULL AND ${table.submittedByUserId} IS NOT NULL)`),
  check("prevention_certification_dossier_version_positive", sql`${table.version} >= 1`),
])

/* Resultado por requisito. Los automáticos se calculan en vivo mientras el
 * expediente está en preparación y se congelan acá al presentarlo: un
 * expediente cuyo contenido cambia solo no sirve como evidencia de auditoría. */
export const preventionCertificationEvaluations = pgTable("prevention_certification_evaluations", {
  id:              text("id").primaryKey(),
  dossierId:       text("dossier_id").notNull().references(() => preventionCertificationDossiers.id, { onDelete: "cascade" }),
  requirementCode: text("requirement_code").notNull(),
  status:          text("status").notNull(),
  source:          text("source").notNull(),
  detail:          text("detail"),
  evidenceReference: text("evidence_reference"),
  /** Brecha convertida en acción correctiva trazable. */
  capaActionId:    text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  evaluatedAt:     timestamp("evaluated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  evaluatedByUserId: text("evaluated_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("prevention_certification_evaluation_unique").on(table.dossierId, table.requirementCode),
  check("prevention_certification_evaluation_status_valid", sql`${table.status} IN ('met', 'not_met', 'not_applicable')`),
  check("prevention_certification_evaluation_source_valid", sql`${table.source} IN ('auto', 'manual')`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionGovernanceHistory = pgTable("prevention_governance_history", {
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
  index("prevention_governance_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionCommitteesRelations = relations(preventionCommittees, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionCommittees.worksiteId], references: [worksites.id] }),
  members: many(preventionCommitteeMembers),
  meetings: many(preventionCommitteeMeetings),
}))

export const preventionCommitteeMembersRelations = relations(preventionCommitteeMembers, ({ one }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteeMembers.committeeId], references: [preventionCommittees.id] }),
  worker: one(workers, { fields: [preventionCommitteeMembers.workerId], references: [workers.id] }),
}))

export const preventionCommitteeMeetingsRelations = relations(preventionCommitteeMeetings, ({ one, many }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteeMeetings.committeeId], references: [preventionCommittees.id] }),
  attendance: many(preventionCommitteeAttendance),
  agreements: many(preventionCommitteeAgreements),
}))

export const preventionCommitteeAttendanceRelations = relations(preventionCommitteeAttendance, ({ one }) => ({
  meeting: one(preventionCommitteeMeetings, { fields: [preventionCommitteeAttendance.meetingId], references: [preventionCommitteeMeetings.id] }),
  member: one(preventionCommitteeMembers, { fields: [preventionCommitteeAttendance.memberId], references: [preventionCommitteeMembers.id] }),
}))

export const preventionCommitteeAgreementsRelations = relations(preventionCommitteeAgreements, ({ one }) => ({
  meeting: one(preventionCommitteeMeetings, { fields: [preventionCommitteeAgreements.meetingId], references: [preventionCommitteeMeetings.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionCommitteeAgreements.capaActionId], references: [preventionCapaActions.id] }),
}))

export const preventionWorksiteDelegatesRelations = relations(preventionWorksiteDelegates, ({ one }) => ({
  worksite: one(worksites, { fields: [preventionWorksiteDelegates.worksiteId], references: [worksites.id] }),
  worker: one(workers, { fields: [preventionWorksiteDelegates.workerId], references: [workers.id] }),
}))

export const preventionCommitteeProgramsRelations = relations(preventionCommitteePrograms, ({ one, many }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteePrograms.committeeId], references: [preventionCommittees.id] }),
  activities: many(preventionCommitteeProgramActivities),
}))

export const preventionCommitteeProgramActivitiesRelations = relations(preventionCommitteeProgramActivities, ({ one }) => ({
  program: one(preventionCommitteePrograms, { fields: [preventionCommitteeProgramActivities.programId], references: [preventionCommitteePrograms.id] }),
  responsibleMember: one(preventionCommitteeMembers, { fields: [preventionCommitteeProgramActivities.responsibleMemberId], references: [preventionCommitteeMembers.id] }),
  reviewedInMeeting: one(preventionCommitteeMeetings, { fields: [preventionCommitteeProgramActivities.reviewedInMeetingId], references: [preventionCommitteeMeetings.id] }),
}))

export type PreventionCommittee = typeof preventionCommittees.$inferSelect
export type PreventionCommitteeMember = typeof preventionCommitteeMembers.$inferSelect
export type PreventionCommitteeMeeting = typeof preventionCommitteeMeetings.$inferSelect
export type PreventionCommitteeAgreement = typeof preventionCommitteeAgreements.$inferSelect
export type PreventionManagementReview = typeof preventionManagementReviews.$inferSelect
export const preventionCertificationDossiersRelations = relations(preventionCertificationDossiers, ({ one, many }) => ({
  committee: one(preventionCommittees, { fields: [preventionCertificationDossiers.committeeId], references: [preventionCommittees.id] }),
  evaluations: many(preventionCertificationEvaluations),
}))

export const preventionCertificationEvaluationsRelations = relations(preventionCertificationEvaluations, ({ one }) => ({
  dossier: one(preventionCertificationDossiers, { fields: [preventionCertificationEvaluations.dossierId], references: [preventionCertificationDossiers.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionCertificationEvaluations.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionWorksiteDelegate = typeof preventionWorksiteDelegates.$inferSelect
export const preventionCommitteeCommissionsRelations = relations(preventionCommitteeCommissions, ({ one, many }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteeCommissions.committeeId], references: [preventionCommittees.id] }),
  members: many(preventionCommitteeCommissionMembers),
}))

export const preventionCommitteeCommissionMembersRelations = relations(preventionCommitteeCommissionMembers, ({ one }) => ({
  commission: one(preventionCommitteeCommissions, { fields: [preventionCommitteeCommissionMembers.commissionId], references: [preventionCommitteeCommissions.id] }),
  member: one(preventionCommitteeMembers, { fields: [preventionCommitteeCommissionMembers.memberId], references: [preventionCommitteeMembers.id] }),
}))

export type PreventionCommitteeCommission = typeof preventionCommitteeCommissions.$inferSelect
export type PreventionCertificationDossier = typeof preventionCertificationDossiers.$inferSelect
export type PreventionCertificationEvaluation = typeof preventionCertificationEvaluations.$inferSelect
export type PreventionCommitteeProgram = typeof preventionCommitteePrograms.$inferSelect
export type PreventionCommitteeProgramActivity = typeof preventionCommitteeProgramActivities.$inferSelect
