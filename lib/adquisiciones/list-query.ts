/**
 * Shared helpers for the Adquisiciones list screens (Solicitudes, Compras,
 * Recepción).
 *
 * These power the URL-synced, server-side search & filters that replace the
 * old in-memory `DataTable` filtering — which only filtered the current
 * server-paginated page and caused the "no results" trap when a matching
 * record lived on a later page.
 *
 * Filters live in the URL search params and are applied to the Drizzle
 * WHERE clause *before* counting and paginating, so search always finds a
 * record regardless of the page it would land on.
 */

import { and, eq, ilike, inArray, or, type AnyColumn, type SQL } from "drizzle-orm"

export interface ListParams {
  /** Free-text query (matched against code and other text columns). */
  q:         string
  /** Selected status values (empty = all). Supports comma-separated multi. */
  estados:   string[]
  /** Selected worksite id (empty = all visible). */
  faena:     string
  /** Selected supplier id (empty = all). */
  proveedor: string
  /** Selected urgency value (empty = all). Used by Aprobaciones. */
  urgencia:  string
  /** "pendiente" = sólo OC que ya deberían tener factura y no la tienen. Compras. */
  factura:   string
}

function firstStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

/** Parse the relevant list filter params from a Next.js searchParams object. */
export function parseListParams(
  sp: Record<string, string | string[] | undefined>,
): ListParams {
  const q = firstStr(sp.q).trim()
  const estadoRaw = firstStr(sp.estado).trim()
  const estados = estadoRaw
    ? estadoRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : []
  const faena = firstStr(sp.faena).trim()
  const proveedor = firstStr(sp.proveedor).trim()
  const urgencia = firstStr(sp.urgencia).trim()
  const factura = firstStr(sp.factura).trim()
  return { q, estados, faena, proveedor, urgencia, factura }
}

/** Escape LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * Case-insensitive partial match of `q` against any of the given columns.
 * Returns undefined when `q` is empty so it can be dropped from `and(...)`.
 */
export function textSearchSql(q: string, columns: AnyColumn[]): SQL | undefined {
  const trimmed = q.trim()
  if (!trimmed || columns.length === 0) return undefined
  const pattern = `%${escapeLike(trimmed)}%`
  const conditions = columns.map((col) => ilike(col, pattern))
  return conditions.length === 1 ? conditions[0] : or(...conditions)
}

/** Restrict `column` to the selected status values. Undefined when none. */
export function statusSql(column: AnyColumn, estados: string[]): SQL | undefined {
  if (estados.length === 0) return undefined
  return inArray(column, estados)
}

/** Restrict `column` to a single value. Undefined when not set. */
export function eqFilter(column: AnyColumn, value: string): SQL | undefined {
  return value ? eq(column, value) : undefined
}

/** Restrict `column` to a single worksite id. Undefined when not set. */
export function worksiteEqSql(column: AnyColumn, faena: string): SQL | undefined {
  return eqFilter(column, faena)
}

/**
 * Combine an existing scope condition with the parsed list filters.
 * `textColumns` are the columns the free-text query is matched against;
 * `statusColumn` is optional (Recepción has no status filter).
 */
export function buildListWhere(params: {
  base?:           SQL | undefined
  textColumns:     AnyColumn[]
  query:           string
  statusColumn?:   AnyColumn
  estados:         string[]
  worksiteColumn:  AnyColumn
  faena:           string
  supplierColumn?: AnyColumn
  proveedor?:      string
}): SQL | undefined {
  return and(
    params.base,
    textSearchSql(params.query, params.textColumns),
    params.statusColumn ? statusSql(params.statusColumn, params.estados) : undefined,
    worksiteEqSql(params.worksiteColumn, params.faena),
    params.supplierColumn ? eqFilter(params.supplierColumn, params.proveedor ?? "") : undefined,
  )
}
