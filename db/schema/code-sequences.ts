import { integer, primaryKey, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const codeSequences = pgTable("code_sequences", {
  prefix:    text("prefix").notNull(),
  year:      integer("year").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.prefix, table.year] }),
])
