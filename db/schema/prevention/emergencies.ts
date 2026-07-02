import { relations } from "drizzle-orm"
import { index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const emergencyPlans = pgTable("emergency_plans", {
  id:          text("id").primaryKey(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  version:     integer("version").notNull(),
  threats:     jsonb("threats").notNull(),
  roles:       jsonb("roles").notNull(),
  routes:      jsonb("routes").notNull(),
  approvedBy:  text("approved_by").references(() => users.id),
  approvedAt:  timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_plans_ws_version_unique").on(table.worksiteId, table.version),
])

export const emergencyDrills = pgTable("emergency_drills", {
  id:           text("id").primaryKey(),
  planId:       text("plan_id").notNull().references(() => emergencyPlans.id),
  type:         text("type").notNull(),
  scheduledAt:  timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  executedAt:   timestamp("executed_at", { withTimezone: true, mode: "string" }),
  attendees:    integer("attendees"),
  findings:     jsonb("findings").notNull(),
  effectiveness: text("effectiveness"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("emergency_drills_plan_scheduled_idx").on(table.planId, table.scheduledAt),
])

export const emergencyTeams = pgTable("emergency_teams", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  name:       text("name").notNull(),
  leaderId:   text("leader_id").notNull().references(() => users.id),
  members:    jsonb("members").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_teams_ws_name_unique").on(table.worksiteId, table.name),
])

export const emergencyEquipment = pgTable("emergency_equipment", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  kind:              text("kind").notNull(),
  code:              text("code").notNull(),
  location:          text("location").notNull(),
  lastInspectionAt:  timestamp("last_inspection_at", { withTimezone: true, mode: "string" }),
  nextInspectionAt:  timestamp("next_inspection_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_equipment_ws_kind_code_unique").on(table.worksiteId, table.kind, table.code),
])

export const equipmentInspections = pgTable("equipment_inspections", {
  id:          text("id").primaryKey(),
  equipmentId: text("equipment_id").notNull().references(() => emergencyEquipment.id),
  performedAt: timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  performedBy: text("performed_by").notNull().references(() => users.id),
  status:      text("status").notNull().default("vigente"),
  findings:    jsonb("findings").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("equipment_inspections_equip_date_idx").on(table.equipmentId, table.performedAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const emergencyPlansRelations = relations(emergencyPlans, ({ one, many }) => ({
  worksite:  one(worksites, { fields: [emergencyPlans.worksiteId], references: [worksites.id] }),
  approver:  one(users, { fields: [emergencyPlans.approvedBy], references: [users.id] }),
  drills:    many(emergencyDrills),
}))

export const emergencyDrillsRelations = relations(emergencyDrills, ({ one }) => ({
  plan: one(emergencyPlans, { fields: [emergencyDrills.planId], references: [emergencyPlans.id] }),
}))

export const emergencyTeamsRelations = relations(emergencyTeams, ({ one }) => ({
  worksite: one(worksites, { fields: [emergencyTeams.worksiteId], references: [worksites.id] }),
  leader:   one(users, { fields: [emergencyTeams.leaderId], references: [users.id] }),
}))

export const emergencyEquipmentRelations = relations(emergencyEquipment, ({ one, many }) => ({
  worksite:    one(worksites, { fields: [emergencyEquipment.worksiteId], references: [worksites.id] }),
  inspections: many(equipmentInspections),
}))

export const equipmentInspectionsRelations = relations(equipmentInspections, ({ one }) => ({
  equipment:  one(emergencyEquipment, { fields: [equipmentInspections.equipmentId], references: [emergencyEquipment.id] }),
  performedByUser: one(users, { fields: [equipmentInspections.performedBy], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type EmergencyPlan = typeof emergencyPlans.$inferSelect
export type NewEmergencyPlan = typeof emergencyPlans.$inferInsert
export type EmergencyDrill = typeof emergencyDrills.$inferSelect
export type NewEmergencyDrill = typeof emergencyDrills.$inferInsert
export type EmergencyTeam = typeof emergencyTeams.$inferSelect
export type NewEmergencyTeam = typeof emergencyTeams.$inferInsert
export type EmergencyEquipment = typeof emergencyEquipment.$inferSelect
export type NewEmergencyEquipment = typeof emergencyEquipment.$inferInsert
export type EquipmentInspection = typeof equipmentInspections.$inferSelect
export type NewEquipmentInspection = typeof equipmentInspections.$inferInsert
