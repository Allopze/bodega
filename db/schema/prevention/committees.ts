import { relations } from "drizzle-orm"
import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const committees = pgTable("committees", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  type:       text("type").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  status:     text("status").notNull().default("activo"),
}, (table) => [
  uniqueIndex("committees_ws_type_unique").on(table.worksiteId, table.type),
])

export const committeeMembers = pgTable("committee_members", {
  id:          text("id").primaryKey(),
  committeeId: text("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull().references(() => users.id),
  role:        text("role").notNull(),
  startDate:   text("start_date").notNull(),
  endDate:     text("end_date"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("committee_members_committee_user_unique").on(table.committeeId, table.userId),
])

export const committeeMeetings = pgTable("committee_meetings", {
  id:          text("id").primaryKey(),
  committeeId: text("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  heldAt:      timestamp("held_at", { withTimezone: true, mode: "string" }),
  attendees:   jsonb("attendees").notNull(),
  agenda:      text("agenda").notNull(),
  minutesUrl:  text("minutes_url"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("committee_meetings_committee_scheduled_idx").on(table.committeeId, table.scheduledAt),
])

export const committeeAgreements = pgTable("committee_agreements", {
  id:            text("id").primaryKey(),
  meetingId:     text("meeting_id").notNull().references(() => committeeMeetings.id, { onDelete: "cascade" }),
  description:   text("description").notNull(),
  responsibleId: text("responsible_id").notNull().references(() => users.id),
  dueDate:       text("due_date").notNull(),
  status:        text("status").notNull().default("pendiente"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("committee_agreements_meeting_status_idx").on(table.meetingId, table.status),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const committeesRelations = relations(committees, ({ one, many }) => ({
  worksite: one(worksites, { fields: [committees.worksiteId], references: [worksites.id] }),
  members:  many(committeeMembers),
  meetings: many(committeeMeetings),
}))

export const committeeMembersRelations = relations(committeeMembers, ({ one }) => ({
  committee: one(committees, { fields: [committeeMembers.committeeId], references: [committees.id] }),
  user:      one(users, { fields: [committeeMembers.userId], references: [users.id] }),
}))

export const committeeMeetingsRelations = relations(committeeMeetings, ({ one, many }) => ({
  committee:  one(committees, { fields: [committeeMeetings.committeeId], references: [committees.id] }),
  agreements: many(committeeAgreements),
}))

export const committeeAgreementsRelations = relations(committeeAgreements, ({ one }) => ({
  meeting:     one(committeeMeetings, { fields: [committeeAgreements.meetingId], references: [committeeMeetings.id] }),
  responsible: one(users, { fields: [committeeAgreements.responsibleId], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type Committee = typeof committees.$inferSelect
export type NewCommittee = typeof committees.$inferInsert
export type CommitteeMember = typeof committeeMembers.$inferSelect
export type NewCommitteeMember = typeof committeeMembers.$inferInsert
export type CommitteeMeeting = typeof committeeMeetings.$inferSelect
export type NewCommitteeMeeting = typeof committeeMeetings.$inferInsert
export type CommitteeAgreement = typeof committeeAgreements.$inferSelect
export type NewCommitteeAgreement = typeof committeeAgreements.$inferInsert
