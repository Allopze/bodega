/**
 * Piezas del importador del log operacional que no son acciones de servidor:
 * totales, llaves de fila, deduplicación y lectura/validación del archivo.
 * `actions-operaciones.ts` las orquesta.
 */
import { and, eq, gte, lte, ne } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelOperationBatches, fuelOperationRecords } from "@/db/schema"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { plateMatchKey, type parseFuelOperationsExcel } from "./operations-import"

export const MAX_OPERATIONS_FILE_BYTES = 10 * 1024 * 1024

/**
 * Este log operacional abarca varias faenas por archivo (a diferencia del
 * import de consumos, que declara una sola faena por lote) — se restringe a
 * roles con visibilidad global para no importar/revertir datos de faenas que
 * el usuario no puede ver.
 */
export async function requireGlobalImportSession(permission: "combustibles:import" | "combustibles:revert") {
  const session = await requirePermission(permission)
  if (!isGlobalRole(session)) {
    throw new Error("Esta importación abarca múltiples faenas; requiere acceso global")
  }
  return session
}

export function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "importacion.xlsx"
}

export async function readImportFile(formData: FormData): Promise<
  | { ok: true; buffer: Buffer; fileName: string }
  | { ok: false; message: string }
> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona un archivo Excel" }
  }
  if (!file.name.toLocaleLowerCase("es-CL").endsWith(".xlsx")) {
    return { ok: false, message: "El archivo debe estar en formato .xlsx" }
  }
  if (file.size > MAX_OPERATIONS_FILE_BYTES) {
    return { ok: false, message: "El archivo no puede superar 10 MB" }
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.SPREADSHEET)
  if (validation.error) return { ok: false, message: validation.error }
  return { ok: true, buffer, fileName: file.name }
}

export type ParsedOperationRows = Awaited<ReturnType<typeof parseFuelOperationsExcel>>["rows"]

export interface Totales {
  totalFilas: number
  totalEquipos: number
  totalLitros: number
  totalMonto: number
  periodoDesde: string
  periodoHasta: string
}

export function computeTotales(rows: ParsedOperationRows): Totales {
  const fechas = rows.map((r) => r.fecha).sort()
  return {
    totalFilas: rows.length,
    totalEquipos: new Set(rows.map((r) => r.plate)).size,
    totalLitros: Math.round(rows.reduce((s, r) => s + r.liters, 0) * 10000) / 10000,
    totalMonto: Math.round(rows.reduce((s, r) => s + (r.monto ?? 0), 0) * 100) / 100,
    periodoDesde: fechas[0] ?? "",
    periodoHasta: fechas[fechas.length - 1] ?? "",
  }
}

export async function lookupMatchedPlateKeys(plates: string[]): Promise<Set<string>> {
  const uniquePlates = [...new Set(plates)]
  if (uniquePlates.length === 0) return new Set()
  const vehicles = await db.query.fuelVehicles.findMany({ columns: { plate: true } })
  const vehicleKeys = new Set(vehicles.map((v) => plateMatchKey(v.plate)))
  return new Set(uniquePlates.map(plateMatchKey).filter((k) => vehicleKeys.has(k)))
}

/** Identidad natural de una carga del log operacional: la combinación que
 *  distingue dos eventos reales. `undefined`/`null` se normalizan a cadena
 *  vacía para que el mismo campo ausente en ambos lados siga comparando igual. */
export function operationRowKey(row: { plate: string; fecha: string; horaCarga: string | null; liters: number; horometro: number | null }): string {
  return [plateMatchKey(row.plate), row.fecha, row.horaCarga ?? "", row.liters, row.horometro ?? ""].join("|")
}

/**
 * Filas del archivo que YA existen como carga real (de un lote no revertido).
 * Antes la deduplicación era sólo por hash del ARCHIVO completo: un
 * consolidado reimportado con filas nuevas AÑADIDAS al final tiene un hash
 * distinto, así que pasaba el guard e insertaba de nuevo TODO lo ya cargado.
 * Acotado por rango de fecha del archivo — `fecha` está indexada — para no
 * escanear la tabla completa en cada confirmación.
 */
export async function existingOperationKeys(rows: ParsedOperationRows, client: Tx | typeof db = db): Promise<Set<string>> {
  if (rows.length === 0) return new Set()
  const fechas = rows.map((r) => r.fecha)
  const minFecha = fechas.reduce((a, b) => (a < b ? a : b))
  const maxFecha = fechas.reduce((a, b) => (a > b ? a : b))
  const existing = await client.select({
    plate: fuelOperationRecords.plate,
    fecha: fuelOperationRecords.fecha,
    horaCarga: fuelOperationRecords.horaCarga,
    liters: fuelOperationRecords.liters,
    horometro: fuelOperationRecords.horometro,
  })
    .from(fuelOperationRecords)
    .innerJoin(fuelOperationBatches, eq(fuelOperationRecords.batchId, fuelOperationBatches.id))
    .where(and(
      gte(fuelOperationRecords.fecha, minFecha),
      lte(fuelOperationRecords.fecha, maxFecha),
      ne(fuelOperationBatches.estado, "revertido"),
    ))
  return new Set(existing.map(operationRowKey))
}

/** Postgres rechaza más de 65.535 parámetros por sentencia — 25 columnas por
 *  fila dan un techo real de ~2.621 filas, muy por debajo de lo que cabe en
 *  el límite de 10 MB del archivo. Se inserta en lotes. */
const INSERT_CHUNK_SIZE = 2000

export async function insertInChunks<T>(tx: Tx, table: typeof fuelOperationRecords, rows: T[]) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    await tx.insert(table).values(rows.slice(i, i + INSERT_CHUNK_SIZE) as (typeof fuelOperationRecords.$inferInsert)[])
  }
}

/**
 * C8 / 2.3: inserta las cargas tolerando la colisión por identidad natural.
 *
 * `fuel_operation_records` no tenía clave: dos archivos que se solapan (el mes y
 * el consolidado trimestral) insertaban la misma carga dos veces, con litros y
 * acumulados dobles. El dedupe por lectura previa dentro del lock por período
 * cubre el caso normal; esto cubre el resto:
 * - `onConflictDoNothing` no falla ni duplica cuando el índice natural exista
 *   (lo aporta la migración del carril E): es la mitad "catch 23505" del
 *   arreglo, hecha en una sola sentencia para no abortar la transacción del lote.
 * Devuelve cuántas filas entraron y cuántas se omitieron por duplicado.
 */
export async function insertOperationRecordsIgnoringDuplicates(
  tx: Tx,
  rows: (typeof fuelOperationRecords.$inferInsert)[],
): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0
  let duplicates = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const part = rows.slice(i, i + INSERT_CHUNK_SIZE)
    const written = await tx.insert(fuelOperationRecords).values(part).onConflictDoNothing().returning({ id: fuelOperationRecords.id })
    inserted += written.length
    duplicates += part.length - written.length
  }
  return { inserted, duplicates }
}

/**
 * Meses que toca un archivo de cargas (`YYYY-MM`), para tomar el lock por
 * período y no por hash del archivo.
 *
 * Con el lock por hash, dos archivos distintos que se solapan (marzo y el
 * consolidado del primer trimestre) no se serializaban: cada uno calculaba
 * `existingOperationKeys` antes de que el otro commitease y ambos insertaban
 * las mismas filas. El lock por mes —tomado en orden— los pone en fila.
 */
export function operationMonthLocks(periodoDesde: string, periodoHasta: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodoDesde) || !/^\d{4}-\d{2}-\d{2}$/.test(periodoHasta)) return []
  const months: string[] = []
  let year = Number(periodoDesde.slice(0, 4))
  let month = Number(periodoDesde.slice(5, 7))
  const lastYear = Number(periodoHasta.slice(0, 4))
  const lastMonth = Number(periodoHasta.slice(5, 7))
  // Cota de seguridad: un archivo con una fecha corrupta no puede pedir miles de locks.
  for (let guard = 0; guard < 60; guard++) {
    months.push(`${year}-${String(month).padStart(2, "0")}`)
    if (year === lastYear && month === lastMonth) break
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}
