import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

export const codeSequences = sqliteTable("code_sequences", {
  prefix:    text("prefix").notNull(),
  year:      integer("year").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.prefix, table.year] }),
])
