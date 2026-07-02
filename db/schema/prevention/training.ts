import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites, workers } from "../worksites"

export const trainingCourses = pgTable("training_courses", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  validityMonths:   integer("validity_months"),
  requiredForCargo: jsonb("required_for_cargo").notNull(),
  isActive:         boolean("is_active").notNull().default(true),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const workerTrainingAssignments = pgTable("worker_training_assignments", {
  id:          text("id").primaryKey(),
  courseId:    text("course_id").notNull().references(() => trainingCourses.id),
  workerId:    text("worker_id").notNull().references(() => workers.id),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  completedAt: text("completed_at").notNull(),
  expiresAt:   text("expires_at"),
  score:       integer("score"),
  evidenceUrl: text("evidence_url"),
  createdBy:   text("created_by").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("worker_training_assignments_worker_idx").on(table.workerId),
  index("worker_training_assignments_worksite_expires_idx").on(table.worksiteId, table.expiresAt),
  uniqueIndex("worker_training_assignments_worker_course_unique").on(table.workerId, table.courseId),
])

export const trainingCoursesRelations = relations(trainingCourses, ({ many }) => ({
  assignments: many(workerTrainingAssignments),
}))

export const workerTrainingAssignmentsRelations = relations(workerTrainingAssignments, ({ one }) => ({
  course:    one(trainingCourses, { fields: [workerTrainingAssignments.courseId], references: [trainingCourses.id] }),
  worksite:  one(worksites,        { fields: [workerTrainingAssignments.worksiteId], references: [worksites.id] }),
  worker:    one(workers,          { fields: [workerTrainingAssignments.workerId], references: [workers.id] }),
  createdByUser: one(users,       { fields: [workerTrainingAssignments.createdBy], references: [users.id] }),
}))

export type TrainingCourse         = typeof trainingCourses.$inferSelect
export type NewTrainingCourse      = typeof trainingCourses.$inferInsert
export type WorkerTrainingAssignment = typeof workerTrainingAssignments.$inferSelect
export type NewWorkerTrainingAssignment = typeof workerTrainingAssignments.$inferInsert
