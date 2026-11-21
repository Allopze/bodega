import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"

/**
 * Otros nombres con que llega una faena en planillas y formularios
 * (2026-11-21, Trinorma): «Horcones» es Arauco, «Mininco» es Pacífico,
 * «Cholguan» es «Cholguan - Arauco». Los importadores resuelven el texto de
 * origen con `resolveWorksiteId` (`lib/worksites/resolve-worksite.ts`), que
 * mira primero el nombre exacto y después esta tabla.
 *
 * `alias_key` es `nameKey(alias_text)` y es única: un alias apunta a una sola
 * faena. El alias de faena TAE de combustible (`TAE_WORKSITE_ALIASES`) es otra
 * cosa y no se toca.
 */
export const worksiteAliases = pgTable("worksite_aliases", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  aliasText:  text("alias_text").notNull(),
  aliasKey:   text("alias_key").notNull(),
  createdBy:  text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("worksite_aliases_key_unique").on(table.aliasKey),
  index("worksite_aliases_worksite_idx").on(table.worksiteId),
])
