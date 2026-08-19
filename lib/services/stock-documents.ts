/**
 * Documentos manuales de bodega: ajustes, bajas, devoluciones y conteos físicos.
 *
 * Las tres tablas emiten folio (`AJU`, `DES`, `DEV`, `CON`) y ninguna pantalla
 * los listaba: el toast entregaba un código que después no se podía buscar en
 * ninguna parte. Son el mismo objeto — un papel con folio que movió stock — con
 * el mismo filtro (faena, fecha, autor), así que van en una sola lista y no en
 * tres pantallas con tres paginaciones para cuatro filas por semana.
 */
import { sql, type SQL } from "drizzle-orm"
import { db } from "@/db"

export type StockDocumentKindKey = "ajuste" | "desecho" | "devolucion" | "conteo"

/**
 * `db.execute` devuelve un `RowList` con postgres-js y un `{ rows }` con PGlite.
 * Normalizar acá evita que cada consulta cargue con el condicional.
 */
function toRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>
  const maybe = result as { rows?: unknown }
  return Array.isArray(maybe.rows) ? (maybe.rows as Array<Record<string, unknown>>) : []
}

export interface StockDocumentRow {
  id:           string
  folio:        string
  kind:         StockDocumentKindKey
  at:           string
  worksiteId:   string
  worksiteName: string
  productName:  string | null
  quantity:     number | null
  reason:       string | null
  authorName:   string | null
  /** Sólo los conteos tienen detalle rico; el resto es una línea. */
  itemCount:    number | null
}

export interface StockDocumentFilters {
  /** Ids de faena visibles, o "all" para un rol global. */
  worksiteIds: string[] | "all"
  faena?:      string
  kind?:       StockDocumentKindKey | ""
  q?:          string
  desde?:      string
  hasta?:      string
  limit?:      number
  offset?:     number
}

export interface StockCountDetailItem {
  productName:      string
  productSku:       string | null
  expectedQuantity: number
  countedQuantity:  number
  difference:       number
  notes:            string | null
}

/**
 * El alcance se combina ANTES que cualquier filtro del usuario: un `?faena=`
 * ajeno debe devolver vacío, nunca datos de otra faena ni un error.
 */
function scopeCondition(worksiteIds: string[] | "all"): SQL {
  if (worksiteIds === "all") return sql`true`
  if (worksiteIds.length === 0) return sql`false`
  return sql`d.worksite_id IN (${sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)})`
}

function filterCondition(filters: StockDocumentFilters): SQL {
  const clauses: SQL[] = [scopeCondition(filters.worksiteIds)]
  if (filters.faena) clauses.push(sql`d.worksite_id = ${filters.faena}`)
  if (filters.kind) clauses.push(sql`d.kind = ${filters.kind}`)
  const term = filters.q?.trim()
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    clauses.push(sql`(d.folio ILIKE ${pattern} OR coalesce(d.product_name, '') ILIKE ${pattern} OR coalesce(d.reason, '') ILIKE ${pattern})`)
  }
  if (filters.desde) clauses.push(sql`d.at >= ${filters.desde}`)
  // `hasta` inclusive: se traduce al día siguiente, igual que `periodSql`.
  if (filters.hasta) clauses.push(sql`d.at < (${filters.hasta}::date + interval '1 day')`)
  return sql.join(clauses, sql` AND `)
}

/**
 * Las cuatro ramas declaran las MISMAS columnas en el MISMO orden y con casts
 * explícitos: un `null` sin tipo en un `UNION ALL` revienta en Postgres real y
 * no en PGlite. El `ORDER BY`/`LIMIT` va fuera de la unión, no en cada rama.
 */
function documentsCte(): SQL {
  return sql`
    SELECT
      sa.id::text                AS id,
      sa.code::text              AS folio,
      sa.kind::text              AS kind,
      sa.created_at              AS at,
      sa.worksite_id::text       AS worksite_id,
      w.name::text               AS worksite_name,
      p.name::text               AS product_name,
      sa.quantity::real          AS quantity,
      sa.reason::text            AS reason,
      u.name::text               AS author_name,
      NULL::int                  AS item_count
    FROM stock_adjustments sa
    JOIN worksites w ON w.id = sa.worksite_id
    JOIN products  p ON p.id = sa.product_id
    LEFT JOIN users u ON u.id = sa.created_by

    UNION ALL

    SELECT
      sr.id::text, sr.code::text, 'devolucion'::text, sr.created_at,
      sr.worksite_id::text, w.name::text, p.name::text,
      sr.quantity::real, sr.reason::text, u.name::text, NULL::int
    FROM stock_returns sr
    JOIN worksites w ON w.id = sr.worksite_id
    JOIN products  p ON p.id = sr.product_id
    LEFT JOIN users u ON u.id = sr.created_by

    UNION ALL

    SELECT
      pic.id::text, pic.code::text, 'conteo'::text, coalesce(pic.closed_at, pic.created_at),
      pic.worksite_id::text, w.name::text, NULL::text,
      NULL::real, pic.notes::text, u.name::text,
      (SELECT count(*)::int FROM physical_inventory_count_items i WHERE i.count_id = pic.id)
    FROM physical_inventory_counts pic
    JOIN worksites w ON w.id = pic.worksite_id
    LEFT JOIN users u ON u.id = coalesce(pic.closed_by, pic.counted_by)
    WHERE pic.status <> 'cancelled'
  `
}

export async function countStockDocuments(filters: StockDocumentFilters): Promise<number> {
  const result = await db.execute(sql`
    WITH docs AS (${documentsCte()})
    SELECT count(*)::int AS total FROM docs d WHERE ${filterCondition(filters)}
  `)
  const row = toRows(result)[0] as { total: number | string } | undefined
  return Number(row?.total ?? 0)
}

export async function listStockDocuments(filters: StockDocumentFilters): Promise<StockDocumentRow[]> {
  const limit = filters.limit ?? 25
  const offset = filters.offset ?? 0
  const result = await db.execute(sql`
    WITH docs AS (${documentsCte()})
    SELECT d.* FROM docs d
    WHERE ${filterCondition(filters)}
    ORDER BY d.at DESC, d.folio DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  const rows = toRows(result)
  return rows.map((row) => ({
    id:           String(row.id),
    folio:        String(row.folio),
    kind:         String(row.kind) as StockDocumentKindKey,
    at:           String(row.at),
    worksiteId:   String(row.worksite_id),
    worksiteName: String(row.worksite_name),
    productName:  row.product_name === null || row.product_name === undefined ? null : String(row.product_name),
    quantity:     row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    reason:       row.reason === null || row.reason === undefined ? null : String(row.reason),
    authorName:   row.author_name === null || row.author_name === undefined ? null : String(row.author_name),
    itemCount:    row.item_count === null || row.item_count === undefined ? null : Number(row.item_count),
  }))
}

/** Detalle de un conteo físico: lo único con más de una línea. */
export async function getStockCountDetail(
  countId: string,
  worksiteIds: string[] | "all",
): Promise<StockCountDetailItem[]> {
  const scope = worksiteIds === "all"
    ? sql`true`
    : worksiteIds.length === 0
      ? sql`false`
      : sql`pic.worksite_id IN (${sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)})`

  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku AS product_sku,
           i.expected_quantity, i.counted_quantity, i.difference, i.notes
    FROM physical_inventory_count_items i
    JOIN physical_inventory_counts pic ON pic.id = i.count_id
    JOIN products p ON p.id = i.product_id
    WHERE i.count_id = ${countId} AND ${scope}
    ORDER BY p.name ASC
  `)
  const rows = toRows(result)
  return rows.map((row) => ({
    productName:      String(row.product_name),
    productSku:       row.product_sku === null || row.product_sku === undefined ? null : String(row.product_sku),
    expectedQuantity: Number(row.expected_quantity),
    countedQuantity:  Number(row.counted_quantity),
    difference:       Number(row.difference),
    notes:            row.notes === null || row.notes === undefined ? null : String(row.notes),
  }))
}
