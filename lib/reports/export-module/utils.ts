import type { Session } from "next-auth"
import { and, inArray, sql, type SQLWrapper } from "drizzle-orm"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import type { ExportFilters } from "./types"

/**
 * Builds a Drizzle SQL fragment for a worksite column, matching the
 * same scope rule as canAccessWorksite(). Global roles get undefined
 * (no filter), faena requesters with no worksites get a no-rows
 * predicate, and everyone else gets an `inArray(...)` filter.
 */
export function buildWorksiteFilter(
  session: Session | null,
  column: SQLWrapper,
) {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return sql`false`
  return inArray(column, ids as never[])
}

export function buildDateFilter(filters: ExportFilters, column: SQLWrapper) {
  if (!filters.fromDate && !filters.toDate) return undefined
  const conditions = []
  if (filters.fromDate) conditions.push(sql`${column} >= ${filters.fromDate}`)
  if (filters.toDate) conditions.push(sql`${column} <= ${filters.toDate}T23:59:59`)
  return and(...conditions)
}
