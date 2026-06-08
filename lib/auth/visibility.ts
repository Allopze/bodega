/**
 * SQL-level worksite visibility helpers.
 *
 * The same scope rule is used everywhere (canAccessWorksite): a faena
 * requester is scoped to their explicit worksite assignments, while
 * operational leadership (admin, jefa_chome, secretaria, prevencionista)
 * sees every worksite. This module mirrors that rule at the SQL layer so
 * reports and dashboards don't have to load-then-filter in memory.
 */
import type { SQL, SQLWrapper } from "drizzle-orm"
import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"

/**
 * Returns either:
 *  - `undefined` when the session has global access (caller should NOT
 *    apply a worksite filter)
 *  - a Drizzle `inArray(...)` predicate restricting to the user's scope
 *  - an `inArray(["__none__"])` predicate that always returns empty rows
 *    for faena requesters with no worksites assigned
 */
export function worksiteScope(
  session: Session | null,
  column: SQLWrapper,
): SQL | undefined {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) {
    return inArray(column, ["__none__"] as never[])
  }
  return inArray(column, ids as never[])
}

/**
 * Returns the list of active worksites the session is allowed to see.
 * Use for breakdowns, filters and selects.
 */
export async function listVisibleWorksites(session: Session | null) {
  if (isGlobalRole(session)) {
    return db
      .select({ id: worksites.id, name: worksites.name, code: worksites.code })
      .from(worksites)
      .where(eq(worksites.isActive, true))
  }
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return []
  return db
    .select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), inArray(worksites.id, ids)))
}
