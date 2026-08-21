import type { Session } from "next-auth"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches, fuelTaeSubmissions, users } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

/**
 * Visibilidad por faena del ledger de importaciones TAE.
 *
 * Un lote histórico es multi-faena por naturaleza: sus contadores, su volumen,
 * su hash y sus filas rechazadas describen el archivo completo, no una faena.
 * Mostrarlos tal cual a un rol acotado le entrega el tamaño y el resultado de
 * las operaciones de faenas que no puede ver, y las filas rechazadas conservan
 * `raw_row` con equipos y nombres de esas faenas. Para roles acotados, cada
 * cifra se recalcula desde SUS cargas y lo que no es atribuible viaja como
 * `null` — nunca como cero, que se leería como "el lote no tuvo rechazos".
 *
 * Efecto lateral aceptado: un lote revertido no conserva cargas, así que deja
 * de aparecer para roles acotados. Para ellos ya no queda nada suyo dentro.
 */
export interface TaeImportBatchSummary {
  id: string
  fileName: string
  status: string
  createdAt: string
  importerLabel: string
  validRows: number
  observedRows: number
  totalLiters: number
  /** `null` cuando la cifra pertenece al lote completo y la sesión es acotada. */
  totalRows: number | null
  invalidRows: number | null
  fileHash: string | null
}

const importerLabel = (name: string | null, email: string | null) => name ?? email ?? "—"

export function taeLedgerIsGlobal(session: Session) {
  return isGlobalRole(session)
}

export async function countTaeImportBatches(session: Session): Promise<number> {
  if (taeLedgerIsGlobal(session)) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(fuelTaeImportBatches)
    return row?.count ?? 0
  }
  const worksiteIds = visibleWorksiteIds(session)
  if (worksiteIds.length === 0) return 0
  const [row] = await db
    .select({ count: sql<number>`count(DISTINCT ${fuelTaeSubmissions.importBatchId})::int` })
    .from(fuelTaeSubmissions)
    .where(and(
      sql`${fuelTaeSubmissions.importBatchId} IS NOT NULL`,
      inArray(fuelTaeSubmissions.worksiteId, worksiteIds),
    ))
  return row?.count ?? 0
}

export async function listTaeImportBatches(
  session: Session,
  options: { limit: number; offset?: number } = { limit: 25 },
): Promise<TaeImportBatchSummary[]> {
  const { limit, offset = 0 } = options

  if (taeLedgerIsGlobal(session)) {
    const rows = await db.query.fuelTaeImportBatches.findMany({
      orderBy: [desc(fuelTaeImportBatches.createdAt)],
      limit,
      offset,
      with: { importer: { columns: { name: true, email: true } } },
    })
    return rows.map((batch) => ({
      id: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      createdAt: batch.createdAt,
      importerLabel: importerLabel(batch.importer?.name ?? null, batch.importer?.email ?? null),
      validRows: batch.validRows,
      observedRows: batch.observedRows,
      totalLiters: Number(batch.totalLiters),
      totalRows: batch.totalRows,
      invalidRows: batch.invalidRows,
      fileHash: batch.fileHash,
    }))
  }

  const worksiteIds = visibleWorksiteIds(session)
  if (worksiteIds.length === 0) return []
  const rows = await db
    .select({
      id: fuelTaeImportBatches.id,
      fileName: fuelTaeImportBatches.fileName,
      status: fuelTaeImportBatches.status,
      createdAt: fuelTaeImportBatches.createdAt,
      importerName: users.name,
      importerEmail: users.email,
      validRows: sql<number>`count(*) FILTER (WHERE ${fuelTaeSubmissions.status} <> 'observed')::int`,
      observedRows: sql<number>`count(*) FILTER (WHERE ${fuelTaeSubmissions.status} = 'observed')::int`,
      totalLiters: sql<number>`COALESCE(sum(${fuelTaeSubmissions.liters}), 0)::float8`,
    })
    .from(fuelTaeImportBatches)
    .innerJoin(fuelTaeSubmissions, and(
      eq(fuelTaeSubmissions.importBatchId, fuelTaeImportBatches.id),
      inArray(fuelTaeSubmissions.worksiteId, worksiteIds),
    ))
    .leftJoin(users, eq(users.id, fuelTaeImportBatches.importedBy))
    .groupBy(
      fuelTaeImportBatches.id,
      fuelTaeImportBatches.fileName,
      fuelTaeImportBatches.status,
      fuelTaeImportBatches.createdAt,
      users.name,
      users.email,
    )
    .orderBy(desc(fuelTaeImportBatches.createdAt))
    .limit(limit)
    .offset(offset)

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    createdAt: row.createdAt,
    importerLabel: importerLabel(row.importerName, row.importerEmail),
    validRows: row.validRows,
    observedRows: row.observedRows,
    totalLiters: Number(row.totalLiters),
    totalRows: null,
    invalidRows: null,
    fileHash: null,
  }))
}
