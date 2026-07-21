import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core"

/* ── EPP Types ── Canonical EPP type classification ─────────────────────── */
export const eppTypes = pgTable("epp_types", {
  id:        text("id").primaryKey(),
  code:      text("code").notNull().unique(),
  label:     text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
