import { sql } from "drizzle-orm"
import type { DB } from "@/db"
import { db } from "@/db"
import { generateCode, isContinuousCodePrefix } from "@/lib/id"

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

/** Normaliza: el driver postgres.js devuelve un array y el de PGlite `{ rows }`. */
function driverRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: T[] }).rows) ?? []
}

/** Mismo mapeo que `nextCodeTx`: SOL y GDI tienen una sola serie, sin año. */
function sequenceNameFor(prefix: string, year: number) {
  const sequenceYear = isContinuousCodePrefix(prefix) ? 0 : year
  return { sequenceYear, sequenceName: `code_seq_${prefix.toLowerCase()}_${sequenceYear}` }
}

/**
 * DB-01: Atomically reserves the next code value via the native Postgres
 * SEQUENCE created by migration 0014 (`next_document_code` function).
 *
 * Trade-off vs. the previous INSERT…ON CONFLICT approach (S-01):
 * - PRO: removes row-level contention — native sequences use an internal
 *   lock-free mechanism that scales to thousands of calls per second.
 * - CON: nextval() is non-transactional — if the surrounding DB transaction
 *   rolls back, the sequence value is consumed and creates a gap in the
 *   document series (e.g. OC-2026-005 → OC-2026-007). This is acceptable
 *   for internal OC/solicitud codes; Chilean tax documents (DTE) are issued
 *   by the SII and are not affected.
 *
 * The `code_sequences` table is a leftover of the pre-0014 generator: nothing
 * in the application reads or writes it any more (the admin screen below also
 * talks to the native sequences), so it can be dropped in its own migration.
 */
export async function nextCodeTx(tx: Tx, prefix: string, year = new Date().getFullYear()) {
  const sequenceYear = isContinuousCodePrefix(prefix) ? 0 : year
  const result = await tx.execute<{ next_document_code: number }>(
    sql`SELECT next_document_code(${prefix}, ${sequenceYear})`
  )
  // Normalize: drizzle PGlite adapter returns { rows: [...] } while
  // the postgres.js driver returns an array. Handle both.
  const rows = Array.isArray(result)
    ? result
    : (result as { rows: { next_document_code: number }[] }).rows
  const row = rows?.[0]

  if (!row) {
    throw new Error(`Failed to reserve next code for ${prefix}-${sequenceYear}`)
  }
  return generateCode(prefix, row.next_document_code, year)
}

/**
 * Admin: lista las secuencias nativas vigentes (ordenadas por prefijo y año).
 *
 * Lee `pg_sequences`, no la tabla legada `code_sequences`: es la única fuente
 * que el generador consulta, y la tabla está vacía desde el cutover — la
 * pantalla de folios salía siempre en blanco.
 *
 * `pg_sequences.last_value` es NULL mientras la secuencia no se haya usado, de
 * ahí el COALESCE: el próximo folio es 1.
 */
export async function listCodeSequences() {
  const result = await db.execute(sql`
    SELECT upper(parts[1])                  AS prefix,
           parts[2]::int                    AS year,
           COALESCE(last_value + 1, 1)      AS next_value
      FROM pg_sequences,
           LATERAL regexp_match(sequencename, '^code_seq_(.+)_(-?\\d+)$') AS parts
     WHERE schemaname = current_schema()
       AND sequencename LIKE 'code\\_seq\\_%'
     ORDER BY 1, 2
  `)
  return driverRows<{ prefix: string; year: number | string; next_value: number | string }>(result).map((row) => ({
    prefix: row.prefix,
    year: Number(row.year),
    nextValue: Number(row.next_value),
    // Una SEQUENCE nativa no registra cuándo se tocó; la lista lo pinta como "—".
    updatedAt: "",
  }))
}

/**
 * FOL-001 (auditoría 2026-09-14): tabla donde aterriza el folio de cada prefijo.
 *
 * La corrección administrativa de folios ejecutaba un `setval` sin más control
 * que `nextValue >= 1`: fijar la serie de OC 2026 en 5 cuando ya existía la
 * OC-2026-0017 era una operación aceptada. Como `code` tiene índice único en
 * todas estas tablas, el daño no era un duplicado sino un **fallo de emisión**
 * diferido —cada intento de crear una OC reventaba al pasar por un número ya
 * usado, lejos de su causa y en la cara del operador—.
 *
 * El registro existe porque el piso de la serie no se puede leer de la
 * secuencia (que es justo lo que se está corrigiendo) sino de los documentos ya
 * emitidos. Cada prefijo que pase por `nextCodeTx` debe aparecer aquí.
 */
const CODE_SERIES_TABLES: Record<string, string> = {
  OC:  "purchase_orders",
  // SOL, REP y SER comparten tabla: los tres son solicitudes de compra.
  SOL: "purchase_requests",
  REP: "purchase_requests",
  SER: "purchase_requests",
  REC: "receipts",
  ENT: "deliveries",
  GDI: "dispatch_guides",
  // AJU y DES comparten cabecera (ver `stock_adjustments.kind`); el LIKE por
  // prefijo separa las dos series dentro de la misma tabla.
  AJU: "stock_adjustments",
  DES: "stock_adjustments",
  DEV: "stock_returns",
  CON: "physical_inventory_counts",
  OT:  "maintenance_records",
  PF:  "billing_proposals",
  ACT: "it_asset_assignments",
  INC: "it_tickets",
}

/**
 * FOL-001: mayor correlativo ya emitido para la serie (prefijo + año), leído de
 * los documentos y no de la secuencia.
 *
 * Devuelve 0 si la serie no ha emitido nada. Las series continuas (SOL, GDI) no
 * llevan año en el código, así que su patrón es sólo el prefijo.
 */
export async function highestEmittedCodeSeq(prefix: string, year: number): Promise<number> {
  const table = CODE_SERIES_TABLES[prefix]
  if (!table) {
    // Fail-closed deliberado: sin saber dónde aterriza la serie no se puede
    // garantizar que el nuevo folio no repita uno ya emitido, y el modo de
    // fallo que evitamos (emisión rota en producción) es peor que negar una
    // corrección. QUEDA POR DECIDIR (producto): si un administrador debe poder
    // forzar la corrección de una serie no registrada asumiendo el riesgo.
    throw new Error(
      `No hay una serie de documentos registrada para el prefijo ${prefix}: `
      + "no se puede verificar que el folio no retroceda por debajo de lo ya emitido",
    )
  }

  const pattern = isContinuousCodePrefix(prefix) ? `${prefix}-%` : `${prefix}-${year}-%`
  // `sql.raw` sobre `table` es seguro: el valor sale del registro de arriba,
  // nunca de la entrada del formulario.
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(substring(code from '[0-9]+$')::bigint), 0) AS max_seq
      FROM ${sql.raw(table)}
     WHERE code LIKE ${pattern}
  `)
  return Number(driverRows<{ max_seq: number | string }>(result)[0]?.max_seq ?? 0)
}

/**
 * Admin: fija el próximo folio de la secuencia nativa, devolviendo antes/después
 * para la auditoría.
 */
export async function setCodeSequenceNextValue(input: {
  prefix: string
  year: number
  nextValue: number
}): Promise<{ before: number; after: number }> {
  if (input.nextValue < 1) throw new Error("El siguiente folio debe ser mayor o igual a 1")

  /*
   * FOL-001: la serie no puede retroceder por debajo de lo ya emitido. El piso
   * se calcula sobre los documentos existentes, no sobre la secuencia, porque
   * la secuencia es precisamente lo que está desincronizado.
   */
  const highest = await highestEmittedCodeSeq(input.prefix, input.year)
  if (input.nextValue <= highest) {
    throw new Error(
      `La serie ${input.prefix}-${input.year} ya emitió el folio ${highest}: `
      + `el siguiente folio debe ser ${highest + 1} o mayor`,
    )
  }

  const { sequenceYear, sequenceName } = sequenceNameFor(input.prefix, input.year)

  // El "antes" se lee primero: `next_document_code` consume un valor.
  const existing = driverRows<{ next_value: number | string }>(
    await db.execute(sql`
      SELECT COALESCE(last_value + 1, 1) AS next_value
        FROM pg_sequences
       WHERE schemaname = current_schema() AND sequencename = ${sequenceName}::text
    `),
  )
  const before = Number(existing[0]?.next_value ?? 0)

  // Crea la secuencia si todavía no existe (una BD sembrada con códigos fijos
  // no tiene ninguna). El folio que consume acá lo fija el setval siguiente.
  await db.execute(sql`SELECT next_document_code(${input.prefix}, ${sequenceYear})`)

  // Para N >= 2 queda last_value = N-1 con is_called, así que el próximo nextval
  // devuelve N. Para N = 1 hay que usar is_called = false: setval(…, 0) violaría
  // el MINVALUE 1 de la secuencia.
  // Los `::text`/`::bigint` no son adorno: sin ellos Postgres no puede inferir
  // el tipo de los parámetros dentro de format() y falla con 42P18.
  await db.execute(
    input.nextValue > 1
      ? sql`SELECT setval(format('%I', ${sequenceName}::text)::regclass, ${input.nextValue - 1}::bigint, true)`
      : sql`SELECT setval(format('%I', ${sequenceName}::text)::regclass, 1, false)`,
  )

  return { before, after: input.nextValue }
}
