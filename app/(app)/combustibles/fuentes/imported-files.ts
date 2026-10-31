import "server-only"
import type { Session } from "next-auth"
import { and, count, desc, eq, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelControlImportBatches,
  fuelImportBatches,
  fuelOperationBatches,
  fuelTaeImportBatches,
  users,
  worksites,
} from "@/db/schema"
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { countTaeImportBatches, listTaeImportBatches } from "@/lib/combustibles/tae-import-ledger"
import { fuelBatchHref } from "@/lib/combustibles/routes"
import { IMPORTED_FILE_KINDS, type ImportedFileKind, type ImportedFileStatus } from "./imported-file-kinds"

/**
 * «Archivos importados»: los lotes de las cuatro tablas de importación en una
 * sola lista (reporte de tarjeta, planilla de cargas, histórico de sellos y las
 * importaciones del control: telemetría y despachos de surtidor).
 *
 * Cada tipo conserva el alcance con que ya se veía: la planilla es sólo de roles
 * globales; los reportes de tarjeta, por faena; los del control, de quien los
 * importó (todos para un rol global); y los de sellos, los lotes con cargas de
 * las faenas de la persona (`tae-import-ledger`).
 */
export interface ImportedFileRow {
  /** `tipo:id`, único entre los cuatro orígenes. */
  key: string
  kind: ImportedFileKind
  id: string
  fileName: string
  createdAt: string
  importedBy: string | null
  /** Faena del reporte de tarjeta, o `null`. */
  worksite: string | null
  /** Origen detallado («Copec TCT Diesel»), o `null`. */
  source: string | null
  /** `YYYY-MM-DD a YYYY-MM-DD` que cubre el archivo, o `null` (telemetría, surtidor, sellos). */
  period: { from: string; to: string } | null
  newRows: number | null
  updatedRows: number | null
  /** `null` cuando la cifra describe el archivo completo y la sesión es acotada. */
  rejectedRows: number | null
  status: ImportedFileStatus
  /** Ficha del archivo, o `null` si se muestra en línea (importaciones del control). */
  href: string | null
  canRevert: boolean
}

export interface ImportedFilesFilters {
  kind?: ImportedFileKind
  status?: ImportedFileStatus
  limit: number
  offset?: number
}

export interface ImportedFilesPage {
  rows: ImportedFileRow[]
  /** Archivos por tipo (con el filtro de estado aplicado), sólo de los tipos que la sesión puede ver. */
  counts: Partial<Record<ImportedFileKind, number>>
  total: number
  /** Tipos que esta sesión puede ver: los que ofrece el filtro. */
  visibleKinds: ImportedFileKind[]
}

/** Qué tipos de archivo puede ver una sesión, según el permiso de cada importador. */
export function visibleImportedFileKinds(session: Session): ImportedFileKind[] {
  const permissions = new Set<string>(session.user?.permissions ?? [])
  const canImport = permissions.has("combustibles:import")
  const kinds: ImportedFileKind[] = []
  // Los lotes de las sincronizaciones automáticas también son «reporte de tarjeta».
  if (canImport || permissions.has("combustibles:sync_integrations")) kinds.push("tarjeta")
  if (canImport && isGlobalRole(session)) kinds.push("planilla")
  if (canImport) kinds.push("telemetria", "surtidor")
  if (permissions.has("combustibles:tae_import")) kinds.push("sellos")
  return IMPORTED_FILE_KINDS.filter((kind) => kinds.includes(kind))
}

const DB_STATUS: Record<ImportedFileStatus, { spanish: string; english: string }> = {
  importado: { spanish: "importado", english: "imported" },
  revertido: { spanish: "revertido", english: "reverted" },
}

function normalizeStatus(value: string): ImportedFileStatus {
  return value === "revertido" || value === "reverted" ? "revertido" : "importado"
}

const who = (name: string | null, email: string | null) => name ?? email ?? null

/** Archivos por tipo (con el filtro de estado aplicado) de los tipos que la sesión puede ver. */
export async function countImportedFiles(session: Session, filters: Pick<ImportedFilesFilters, "kind" | "status"> = {}): Promise<Pick<ImportedFilesPage, "counts" | "total" | "visibleKinds">> {
  const global = isGlobalRole(session)
  const visible = visibleImportedFileKinds(session)
  const status = filters.status
  const counts: Partial<Record<ImportedFileKind, number>> = {}

  const countFor = async (kind: ImportedFileKind): Promise<number> => {
    if (kind === "tarjeta") {
      const [row] = await db.select({ total: count() }).from(fuelImportBatches)
        .where(and(worksiteScopeSql(session, fuelImportBatches.worksiteId), status ? eq(fuelImportBatches.estado, DB_STATUS[status].spanish) : undefined))
      return row?.total ?? 0
    }
    if (kind === "planilla") {
      const [row] = await db.select({ total: count() }).from(fuelOperationBatches).where(status ? eq(fuelOperationBatches.estado, DB_STATUS[status].spanish) : undefined)
      return row?.total ?? 0
    }
    if (kind === "sellos") {
      if (global) {
        const [row] = await db.select({ total: count() }).from(fuelTaeImportBatches).where(status ? eq(fuelTaeImportBatches.status, DB_STATUS[status].english) : undefined)
        return row?.total ?? 0
      }
      // Un lote revertido no conserva cargas: no aparece para un rol acotado.
      return status === "revertido" ? 0 : countTaeImportBatches(session)
    }
    const [row] = await db.select({ total: count() }).from(fuelControlImportBatches).where(controlWhere(session, kind, status))
    return row?.total ?? 0
  }
  await Promise.all(visible.map(async (kind) => { counts[kind] = await countFor(kind) }))
  const total = (filters.kind ? visible.filter((kind) => kind === filters.kind) : visible).reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)
  return { counts, total, visibleKinds: visible }
}

export async function listImportedFiles(session: Session, filters: ImportedFilesFilters): Promise<ImportedFilesPage> {
  const permissions = new Set<string>(session.user?.permissions ?? [])
  const canRevertPermission = permissions.has("combustibles:revert")
  const visible = visibleImportedFileKinds(session)
  const wanted = filters.kind ? visible.filter((kind) => kind === filters.kind) : visible
  const window = filters.limit + (filters.offset ?? 0)
  const status = filters.status
  const rows: ImportedFileRow[] = []
  const { counts, total } = await countImportedFiles(session, { kind: filters.kind, status })

  await Promise.all(wanted.map(async (kind) => {
    if (kind === "tarjeta") {
      const found = await db.select({
        id: fuelImportBatches.id, fuente: fuelImportBatches.fuente, fileName: fuelImportBatches.archivoNombre,
        from: fuelImportBatches.periodoDesde, to: fuelImportBatches.periodoHasta, valid: fuelImportBatches.filasValidas,
        invalid: fuelImportBatches.filasInvalidas, estado: fuelImportBatches.estado, createdAt: fuelImportBatches.createdAt,
        worksite: worksites.name, importerName: users.name, importerEmail: users.email,
      })
        .from(fuelImportBatches)
        .leftJoin(worksites, eq(worksites.id, fuelImportBatches.worksiteId))
        .leftJoin(users, eq(users.id, fuelImportBatches.importadoPor))
        .where(and(worksiteScopeSql(session, fuelImportBatches.worksiteId), status ? eq(fuelImportBatches.estado, DB_STATUS[status].spanish) : undefined))
        .orderBy(desc(fuelImportBatches.createdAt), desc(fuelImportBatches.id))
        .limit(window)
      for (const row of found) {
        const rowStatus = normalizeStatus(row.estado)
        rows.push({
          key: `tarjeta:${row.id}`, kind, id: row.id, fileName: row.fileName, createdAt: row.createdAt, importedBy: who(row.importerName, row.importerEmail),
          worksite: row.worksite, source: row.fuente, period: { from: row.from, to: row.to }, newRows: row.valid, updatedRows: null, rejectedRows: row.invalid,
          status: rowStatus, href: fuelBatchHref("tarjeta", row.id), canRevert: canRevertPermission && rowStatus === "importado",
        })
      }
      return
    }
    if (kind === "planilla") {
      const found = await db.select({
        id: fuelOperationBatches.id, fileName: fuelOperationBatches.archivoNombre, from: fuelOperationBatches.periodoDesde, to: fuelOperationBatches.periodoHasta,
        valid: fuelOperationBatches.filasValidas, invalid: fuelOperationBatches.filasInvalidas, estado: fuelOperationBatches.estado,
        createdAt: fuelOperationBatches.createdAt, importerName: users.name, importerEmail: users.email,
      })
        .from(fuelOperationBatches)
        .leftJoin(users, eq(users.id, fuelOperationBatches.importadoPor))
        .where(status ? eq(fuelOperationBatches.estado, DB_STATUS[status].spanish) : undefined)
        .orderBy(desc(fuelOperationBatches.createdAt), desc(fuelOperationBatches.id))
        .limit(window)
      for (const row of found) {
        const rowStatus = normalizeStatus(row.estado)
        rows.push({
          key: `planilla:${row.id}`, kind, id: row.id, fileName: row.fileName, createdAt: row.createdAt, importedBy: who(row.importerName, row.importerEmail),
          worksite: null, source: null, period: { from: row.from, to: row.to }, newRows: row.valid, updatedRows: null, rejectedRows: row.invalid,
          status: rowStatus, href: fuelBatchHref("planilla", row.id), canRevert: canRevertPermission && rowStatus === "importado",
        })
      }
      return
    }
    if (kind === "sellos") {
      const found = await listTaeImportBatches(session, { limit: window })
      for (const row of found) {
        const rowStatus = normalizeStatus(row.status)
        if (status && rowStatus !== status) continue
        rows.push({
          key: `sellos:${row.id}`, kind, id: row.id, fileName: row.fileName, createdAt: row.createdAt, importedBy: row.importerLabel === "—" ? null : row.importerLabel,
          worksite: null, source: null, period: null, newRows: row.validRows + row.observedRows, updatedRows: null, rejectedRows: row.invalidRows,
          status: rowStatus, href: fuelBatchHref("sellos", row.id), canRevert: canRevertPermission && rowStatus === "importado",
        })
      }
      return
    }
    const found = await db.select({
      id: fuelControlImportBatches.id, fileName: fuelControlImportBatches.fileName, inserted: fuelControlImportBatches.insertedRows,
      updated: fuelControlImportBatches.updatedRows, rejected: fuelControlImportBatches.rejectedRows, status: fuelControlImportBatches.status,
      createdAt: fuelControlImportBatches.createdAt, importerName: users.name, importerEmail: users.email,
    })
      .from(fuelControlImportBatches)
      .leftJoin(users, eq(users.id, fuelControlImportBatches.importedBy))
      .where(controlWhere(session, kind, status))
      .orderBy(desc(fuelControlImportBatches.createdAt), desc(fuelControlImportBatches.id))
      .limit(window)
    for (const row of found) {
      const rowStatus = normalizeStatus(row.status)
      rows.push({
        key: `${kind}:${row.id}`, kind, id: row.id, fileName: row.fileName, createdAt: row.createdAt, importedBy: who(row.importerName, row.importerEmail),
        worksite: null, source: null, period: null, newRows: row.inserted, updatedRows: row.updated, rejectedRows: row.rejected,
        status: rowStatus, href: null, canRevert: canRevertPermission && rowStatus === "importado",
      })
    }
  }))

  rows.sort((left, right) => (left.createdAt === right.createdAt ? right.id.localeCompare(left.id) : right.createdAt.localeCompare(left.createdAt)))
  return { rows: rows.slice(filters.offset ?? 0, window), counts, total, visibleKinds: visible }
}

/** Las importaciones del control se distinguen por `kind` y, para quien no es global, por quien las importó. */
function controlWhere(session: Session, kind: ImportedFileKind, status: ImportedFileStatus | undefined): SQL | undefined {
  return and(
    eq(fuelControlImportBatches.kind, kind === "telemetria" ? "telemetry" : "supply_inputs"),
    isGlobalRole(session) ? undefined : eq(fuelControlImportBatches.importedBy, session.user.id),
    status ? eq(fuelControlImportBatches.status, DB_STATUS[status].english) : undefined,
  )
}
