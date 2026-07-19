import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/* ── Empresas contratistas ────────────────────────────────────────────────
 * El DS 76 obliga a la empresa principal a mantener un registro de sus
 * contratistas y subcontratistas por obra, faena o servicios. `parentCompanyId`
 * modela la subcontratación sin duplicar la ficha de la empresa.
 */
export const preventionContractorCompanies = pgTable("prevention_contractor_companies", {
  id:                    text("id").primaryKey(),
  rut:                   text("rut").notNull().unique(),
  legalName:             text("legal_name").notNull(),
  tradeName:             text("trade_name"),
  businessActivity:      text("business_activity"),
  insuranceAdministrator: text("insurance_administrator"),
  contactName:           text("contact_name"),
  contactEmail:          text("contact_email"),
  contactPhone:          text("contact_phone"),
  parentCompanyId:       text("parent_company_id"),
  isActive:              boolean("is_active").notNull().default(true),
  createdByUserId:       text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_contractor_company_active_idx").on(table.isActive),
  check("prevention_contractor_company_rut_valid", sql`length(${table.rut}) >= 8`),
  check("prevention_contractor_company_not_self_parent", sql`${table.parentCompanyId} IS NULL OR ${table.parentCompanyId} <> ${table.id}`),
])

/* ── Contratos por faena ──────────────────────────────────────────────────── */
export const preventionContractorContracts = pgTable("prevention_contractor_contracts", {
  id:                  text("id").primaryKey(),
  code:                text("code").notNull().unique(),
  companyId:           text("company_id").notNull().references(() => preventionContractorCompanies.id, { onDelete: "restrict" }),
  worksiteId:          text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  relationship:        text("relationship").notNull(),
  scope:               text("scope").notNull(),
  startsOn:            text("starts_on").notNull(),
  endsOn:              text("ends_on"),
  plannedHeadcount:    integer("planned_headcount"),
  status:              text("status").notNull().default("draft"),
  accessBlocked:       boolean("access_blocked").notNull().default(true),
  accessBlockReason:   text("access_block_reason"),
  accessReleasedByUserId: text("access_released_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  accessReleasedAt:    timestamp("access_released_at", { withTimezone: true, mode: "string" }),
  version:             integer("version").notNull().default(1),
  createdByUserId:     text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_contractor_contract_worksite_idx").on(table.worksiteId, table.status),
  index("prevention_contractor_contract_company_idx").on(table.companyId),
  check("prevention_contractor_contract_relationship_valid", sql`${table.relationship} IN ('contractor', 'subcontractor', 'service_provider')`),
  check("prevention_contractor_contract_status_valid", sql`${table.status} IN ('draft', 'active', 'suspended', 'finished')`),
  check("prevention_contractor_contract_dates_valid", sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`),
  check("prevention_contractor_contract_headcount_valid", sql`${table.plannedHeadcount} IS NULL OR ${table.plannedHeadcount} > 0`),
  check("prevention_contractor_contract_version_positive", sql`${table.version} >= 1`),
])

/* ── Trabajadores acreditados ─────────────────────────────────────────────
 * No son trabajadores de Chome: se identifican por RUT propio y viven ligados
 * al contrato, no a la dotación interna.
 */
export const preventionContractorWorkers = pgTable("prevention_contractor_workers", {
  id:               text("id").primaryKey(),
  contractId:       text("contract_id").notNull().references(() => preventionContractorContracts.id, { onDelete: "cascade" }),
  rut:              text("rut").notNull(),
  firstName:        text("first_name").notNull(),
  lastName:         text("last_name").notNull(),
  position:         text("position"),
  shift:            text("shift"),
  status:           text("status").notNull().default("pending"),
  accessBlocked:    boolean("access_blocked").notNull().default(true),
  startsOn:         text("starts_on"),
  endsOn:           text("ends_on"),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_contractor_worker_unique").on(table.contractId, table.rut),
  index("prevention_contractor_worker_status_idx").on(table.contractId, table.status),
  check("prevention_contractor_worker_status_valid", sql`${table.status} IN ('pending', 'accredited', 'rejected', 'withdrawn')`),
  check("prevention_contractor_worker_rut_valid", sql`length(${table.rut}) >= 8`),
])

/* ── Requisitos de acreditación ───────────────────────────────────────────
 * Qué evidencia exige la empresa principal, a quién y con qué criticidad.
 * `blocking` distingue el incumplimiento que impide el ingreso del que sólo
 * advierte, igual que en competencias.
 */
export const preventionAccreditationRequirements = pgTable("prevention_accreditation_requirements", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  appliesTo:        text("applies_to").notNull(),
  worksiteId:       text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  relationship:     text("relationship"),
  enforcement:      text("enforcement").notNull().default("blocking"),
  requiresExpiry:   boolean("requires_expiry").notNull().default(true),
  legalBasis:       text("legal_basis").notNull(),
  isActive:         boolean("is_active").notNull().default(true),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_accreditation_requirement_scope_idx").on(table.appliesTo, table.isActive),
  check("prevention_accreditation_requirement_applies_valid", sql`${table.appliesTo} IN ('company', 'contract', 'worker')`),
  check("prevention_accreditation_requirement_enforcement_valid", sql`${table.enforcement} IN ('blocking', 'warning')`),
  check("prevention_accreditation_requirement_relationship_valid", sql`${table.relationship} IS NULL OR ${table.relationship} IN ('contractor', 'subcontractor', 'service_provider')`),
  check("prevention_accreditation_requirement_basis_valid", sql`length(${table.legalBasis}) >= 5`),
])

/* ── Evidencia presentada ─────────────────────────────────────────────────
 * Ciclo: pendiente → presentado → observado/aprobado → vencido. Un documento
 * aprobado con fecha pasada se trata como vencido aunque el job no lo haya
 * marcado todavía.
 */
export const preventionAccreditationItems = pgTable("prevention_accreditation_items", {
  id:                  text("id").primaryKey(),
  requirementId:       text("requirement_id").notNull().references(() => preventionAccreditationRequirements.id, { onDelete: "restrict" }),
  contractId:          text("contract_id").notNull().references(() => preventionContractorContracts.id, { onDelete: "cascade" }),
  contractorWorkerId:  text("contractor_worker_id").references(() => preventionContractorWorkers.id, { onDelete: "cascade" }),
  status:              text("status").notNull().default("pending"),
  documentReference:   text("document_reference"),
  checksumSha256:      text("checksum_sha256"),
  issuedOn:            text("issued_on"),
  expiresOn:           text("expires_on"),
  submittedByUserId:   text("submitted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  submittedAt:         timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  reviewedByUserId:    text("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt:          timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  observation:         text("observation"),
  version:             integer("version").notNull().default(1),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_accreditation_item_unique").on(table.requirementId, table.contractId, table.contractorWorkerId),
  index("prevention_accreditation_item_contract_idx").on(table.contractId, table.status),
  index("prevention_accreditation_item_expiry_idx").on(table.expiresOn, table.status),
  check("prevention_accreditation_item_status_valid", sql`${table.status} IN ('pending', 'submitted', 'observed', 'approved', 'expired')`),
  check("prevention_accreditation_item_checksum_valid", sql`${table.checksumSha256} IS NULL OR length(${table.checksumSha256}) = 64`),
  check("prevention_accreditation_item_observed_has_comment", sql`${table.status} <> 'observed' OR length(${table.observation}) >= 5`),
  check("prevention_accreditation_item_submitted_has_reference", sql`${table.status} IN ('pending') OR length(${table.documentReference}) >= 3`),
  check("prevention_accreditation_item_expiry_after_issue", sql`${table.expiresOn} IS NULL OR ${table.issuedOn} IS NULL OR ${table.expiresOn} >= ${table.issuedOn}`),
  check("prevention_accreditation_item_version_positive", sql`${table.version} >= 1`),
])

/* ── Reuniones de coordinación DS 76 ──────────────────────────────────────
 * El reglamento exige coordinación efectiva entre empresa principal y
 * contratistas. Los acuerdos se derivan a CAPA común, no a una lista suelta.
 */
export const preventionCoordinationMeetings = pgTable("prevention_coordination_meetings", {
  id:                 text("id").primaryKey(),
  code:               text("code").notNull().unique(),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  heldAt:             timestamp("held_at", { withTimezone: true, mode: "string" }).notNull(),
  subject:            text("subject").notNull(),
  agenda:             text("agenda").notNull(),
  attendees:          jsonb("attendees").notNull(),
  minutes:            text("minutes"),
  riskExchangeSummary: text("risk_exchange_summary"),
  status:             text("status").notNull().default("planned"),
  closedByUserId:     text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:           timestamp("closed_at", { withTimezone: true, mode: "string" }),
  version:            integer("version").notNull().default(1),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_coordination_meeting_worksite_idx").on(table.worksiteId, table.heldAt),
  check("prevention_coordination_meeting_status_valid", sql`${table.status} IN ('planned', 'held', 'closed', 'cancelled')`),
  check("prevention_coordination_meeting_closed_has_minutes", sql`${table.status} <> 'closed' OR length(${table.minutes}) >= 10`),
  check("prevention_coordination_meeting_version_positive", sql`${table.version} >= 1`),
])

export const preventionCoordinationParticipants = pgTable("prevention_coordination_participants", {
  id:         text("id").primaryKey(),
  meetingId:  text("meeting_id").notNull().references(() => preventionCoordinationMeetings.id, { onDelete: "cascade" }),
  contractId: text("contract_id").notNull().references(() => preventionContractorContracts.id, { onDelete: "cascade" }),
  attended:   boolean("attended").notNull().default(false),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_coordination_participant_unique").on(table.meetingId, table.contractId),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionContractorHistory = pgTable("prevention_contractor_history", {
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
  index("prevention_contractor_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionContractorCompaniesRelations = relations(preventionContractorCompanies, ({ one, many }) => ({
  parent: one(preventionContractorCompanies, { fields: [preventionContractorCompanies.parentCompanyId], references: [preventionContractorCompanies.id], relationName: "contractorParent" }),
  contracts: many(preventionContractorContracts),
}))

export const preventionContractorContractsRelations = relations(preventionContractorContracts, ({ one, many }) => ({
  company: one(preventionContractorCompanies, { fields: [preventionContractorContracts.companyId], references: [preventionContractorCompanies.id] }),
  worksite: one(worksites, { fields: [preventionContractorContracts.worksiteId], references: [worksites.id] }),
  workers: many(preventionContractorWorkers),
  items: many(preventionAccreditationItems),
}))

export const preventionContractorWorkersRelations = relations(preventionContractorWorkers, ({ one, many }) => ({
  contract: one(preventionContractorContracts, { fields: [preventionContractorWorkers.contractId], references: [preventionContractorContracts.id] }),
  items: many(preventionAccreditationItems),
}))

export const preventionAccreditationItemsRelations = relations(preventionAccreditationItems, ({ one }) => ({
  requirement: one(preventionAccreditationRequirements, { fields: [preventionAccreditationItems.requirementId], references: [preventionAccreditationRequirements.id] }),
  contract: one(preventionContractorContracts, { fields: [preventionAccreditationItems.contractId], references: [preventionContractorContracts.id] }),
  contractorWorker: one(preventionContractorWorkers, { fields: [preventionAccreditationItems.contractorWorkerId], references: [preventionContractorWorkers.id] }),
}))

export const preventionCoordinationMeetingsRelations = relations(preventionCoordinationMeetings, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionCoordinationMeetings.worksiteId], references: [worksites.id] }),
  participants: many(preventionCoordinationParticipants),
}))

export const preventionCoordinationParticipantsRelations = relations(preventionCoordinationParticipants, ({ one }) => ({
  meeting: one(preventionCoordinationMeetings, { fields: [preventionCoordinationParticipants.meetingId], references: [preventionCoordinationMeetings.id] }),
  contract: one(preventionContractorContracts, { fields: [preventionCoordinationParticipants.contractId], references: [preventionContractorContracts.id] }),
}))

export type PreventionContractorCompany = typeof preventionContractorCompanies.$inferSelect
export type PreventionContractorContract = typeof preventionContractorContracts.$inferSelect
export type PreventionContractorWorker = typeof preventionContractorWorkers.$inferSelect
export type PreventionAccreditationRequirement = typeof preventionAccreditationRequirements.$inferSelect
export type PreventionAccreditationItem = typeof preventionAccreditationItems.$inferSelect
export type PreventionCoordinationMeeting = typeof preventionCoordinationMeetings.$inferSelect
