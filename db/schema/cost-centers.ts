import { relations } from "drizzle-orm"
import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core"
import { worksites } from "./worksites"

/* ── Cost Centers (Centros de costo transversales) ──────────────────────── */
export const costCenters = pgTable("cost_centers", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  name:        text("name").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("cost_centers_worksite_idx").on(table.worksiteId),
  index("cost_centers_active_idx").on(table.isActive),
])

export const costCentersRelations = relations(costCenters, ({ one }) => ({
  worksite: one(worksites, { fields: [costCenters.worksiteId], references: [worksites.id] }),
}))
