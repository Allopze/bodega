import { relations, sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"

/* ── Campañas Preventivas (R9 - Actividades PDTP 85-89) ─────────────────────
 * DS 44 / PDTP: campañas preventivas con registro de fecha, padrón de personas
 * alcanzadas y evidencia de difusión.
 */
export const preventionCampaigns = pgTable("prevention_campaigns", {
  id:                  text("id").primaryKey(),
  worksiteId:          text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  code:                text("code").notNull().unique(),
  title:               text("title").notNull(),
  description:         text("description"),
  status:              text("status").notNull().default("draft"),
  pdtpActivityNumbers: jsonb("pdtp_activity_numbers").$type<number[]>().notNull().default([85]),
  startedAt:           timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt:         timestamp("completed_at", { withTimezone: true, mode: "string" }),
  evidenceUrl:         text("evidence_url"),
  createdByUserId:     text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_campaign_worksite_idx").on(table.worksiteId, table.status),
  check("prevention_campaign_status_check", sql`${table.status} IN ('draft', 'active', 'completed', 'cancelled')`),
])

export const preventionCampaignAttendance = pgTable("prevention_campaign_attendance", {
  id:          text("id").primaryKey(),
  campaignId:  text("campaign_id").notNull().references(() => preventionCampaigns.id, { onDelete: "cascade" }),
  workerId:    text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  attendedAt:  timestamp("attended_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  evidenceRef: text("evidence_ref"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_campaign_attendance_unique").on(table.campaignId, table.workerId),
  index("prevention_campaign_attendance_campaign_idx").on(table.campaignId),
])

export const preventionCampaignsRelations = relations(preventionCampaigns, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionCampaigns.worksiteId], references: [worksites.id] }),
  createdByUser: one(users, { fields: [preventionCampaigns.createdByUserId], references: [users.id] }),
  attendance: many(preventionCampaignAttendance),
}))

export const preventionCampaignAttendanceRelations = relations(preventionCampaignAttendance, ({ one }) => ({
  campaign: one(preventionCampaigns, { fields: [preventionCampaignAttendance.campaignId], references: [preventionCampaigns.id] }),
  worker: one(workers, { fields: [preventionCampaignAttendance.workerId], references: [workers.id] }),
}))
