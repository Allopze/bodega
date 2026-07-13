import type { Session } from "next-auth"
import { and, eq, gte, ilike, isNotNull, isNull, lte, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelTaeSubmissions, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface TaeCopecChannelRow {
  month: string
  worksiteId: string
  worksiteName: string
  vehicleId: string
  equipment: string
  plate: string
  taeLiters: number
  taeLoads: number
  tctDieselLiters: number
  tctBlueMaxLiters: number
  tctRecords: number
}

export interface TaeCopecReconciliationRow extends TaeCopecChannelRow {
  tctLiters: number
  totalLiters: number
  coverage: "both_channels" | "tae_only" | "tct_only"
}

export interface TaeCopecReconciliation {
  rows: TaeCopecReconciliationRow[]
  summary: {
    taeLiters: number
    tctDieselLiters: number
    tctBlueMaxLiters: number
    totalLiters: number
    bothChannels: number
    taeOnly: number
    tctOnly: number
    unmappedTaeLoads: number
    unmappedTaeLiters: number
    unmappedTctRecords: number
    unmappedTctLiters: number
  }
}

export interface TaeCopecFilters { from?: string; to?: string; worksiteId?: string }

function key(row: Pick<TaeCopecChannelRow, "month" | "worksiteId" | "vehicleId">) {
  return `${row.month}:${row.worksiteId}:${row.vehicleId}`
}

export function mergeTaeCopecChannels(taeRows: TaeCopecChannelRow[], tctRows: TaeCopecChannelRow[]): TaeCopecReconciliationRow[] {
  const merged = new Map<string, TaeCopecChannelRow>()
  for (const row of [...taeRows, ...tctRows]) {
    const rowKey = key(row)
    const current = merged.get(rowKey)
    if (!current) { merged.set(rowKey, { ...row }); continue }
    current.taeLiters += row.taeLiters
    current.taeLoads += row.taeLoads
    current.tctDieselLiters += row.tctDieselLiters
    current.tctBlueMaxLiters += row.tctBlueMaxLiters
    current.tctRecords += row.tctRecords
  }
  return [...merged.values()].map((row) => {
    const tctLiters = row.tctDieselLiters + row.tctBlueMaxLiters
    const coverage: TaeCopecReconciliationRow["coverage"] = row.taeLiters > 0 && tctLiters > 0
      ? "both_channels"
      : row.taeLiters > 0
        ? "tae_only"
        : "tct_only"
    return {
      ...row,
      tctLiters,
      totalLiters: row.taeLiters + tctLiters,
      coverage,
    }
  }).sort((a, b) => b.month.localeCompare(a.month) || a.worksiteName.localeCompare(b.worksiteName, "es-CL") || a.equipment.localeCompare(b.equipment, "es-CL"))
}

export async function getTaeCopecReconciliation(session: Session, filters: TaeCopecFilters = {}): Promise<TaeCopecReconciliation> {
  const taeWhere = and(
    ne(fuelTaeSubmissions.status, "voided"),
    isNotNull(fuelTaeSubmissions.vehicleId),
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    filters.from ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined,
    filters.to ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined,
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
  )
  const tctWhere = and(
    ilike(fuelConsumptionRecords.fuente, "Copec TCT%"),
    isNotNull(fuelConsumptionRecords.vehicleId),
    filters.worksiteId ? eq(fuelConsumptionRecords.worksiteId, filters.worksiteId) : undefined,
    filters.from ? gte(fuelConsumptionRecords.periodoHasta, filters.from) : undefined,
    filters.to ? lte(fuelConsumptionRecords.periodoDesde, filters.to) : undefined,
    worksiteScopeSql(session, fuelConsumptionRecords.worksiteId),
  )

  const [taeRaw, tctRaw, taeUnmapped, tctUnmapped] = await Promise.all([
    db.select({
      month: sql<string>`to_char(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago', 'YYYY-MM')`,
      worksiteId: fuelTaeSubmissions.worksiteId,
      worksiteName: worksites.name,
      vehicleId: fuelTaeSubmissions.vehicleId,
      equipment: sql<string>`coalesce(${fuelVehicles.code}, ${fuelTaeSubmissions.equipmentCodeSnapshot})`,
      plate: sql<string>`coalesce(${fuelVehicles.plate}, ${fuelTaeSubmissions.plateSnapshot}, '')`,
      liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
      loads: sql<number>`count(*)`,
    }).from(fuelTaeSubmissions)
      .innerJoin(worksites, eq(worksites.id, fuelTaeSubmissions.worksiteId))
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId))
      .where(taeWhere)
      .groupBy(sql`to_char(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago', 'YYYY-MM')`, fuelTaeSubmissions.worksiteId, worksites.name, fuelTaeSubmissions.vehicleId, fuelVehicles.code, fuelTaeSubmissions.equipmentCodeSnapshot, fuelVehicles.plate, fuelTaeSubmissions.plateSnapshot),
    db.select({
      month: sql<string>`substring(${fuelConsumptionRecords.periodoDesde}, 1, 7)`,
      worksiteId: fuelConsumptionRecords.worksiteId,
      worksiteName: worksites.name,
      vehicleId: fuelConsumptionRecords.vehicleId,
      equipment: sql<string>`coalesce(${fuelVehicles.code}, ${fuelConsumptionRecords.patente})`,
      plate: fuelConsumptionRecords.patente,
      fuente: fuelConsumptionRecords.fuente,
      liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
      records: sql<number>`count(*)`,
    }).from(fuelConsumptionRecords)
      .innerJoin(worksites, eq(worksites.id, fuelConsumptionRecords.worksiteId))
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelConsumptionRecords.vehicleId))
      .where(tctWhere)
      .groupBy(sql`substring(${fuelConsumptionRecords.periodoDesde}, 1, 7)`, fuelConsumptionRecords.worksiteId, worksites.name, fuelConsumptionRecords.vehicleId, fuelVehicles.code, fuelConsumptionRecords.patente, fuelConsumptionRecords.fuente),
    getUnmappedTae(session, filters),
    getUnmappedTct(session, filters),
  ])

  const taeRows: TaeCopecChannelRow[] = taeRaw.map((row) => ({ month: row.month, worksiteId: row.worksiteId, worksiteName: row.worksiteName, vehicleId: row.vehicleId!, equipment: row.equipment, plate: row.plate, taeLiters: Number(row.liters), taeLoads: Number(row.loads), tctDieselLiters: 0, tctBlueMaxLiters: 0, tctRecords: 0 }))
  const tctRows: TaeCopecChannelRow[] = tctRaw.map((row) => ({ month: row.month, worksiteId: row.worksiteId, worksiteName: row.worksiteName, vehicleId: row.vehicleId!, equipment: row.equipment, plate: row.plate, taeLiters: 0, taeLoads: 0, tctDieselLiters: row.fuente?.toLocaleLowerCase("es-CL").includes("bluemax") ? 0 : Number(row.liters), tctBlueMaxLiters: row.fuente?.toLocaleLowerCase("es-CL").includes("bluemax") ? Number(row.liters) : 0, tctRecords: Number(row.records) }))
  const rows = mergeTaeCopecChannels(taeRows, tctRows)
  const summary = rows.reduce((acc, row) => {
    acc.taeLiters += row.taeLiters
    acc.tctDieselLiters += row.tctDieselLiters
    acc.tctBlueMaxLiters += row.tctBlueMaxLiters
    acc.totalLiters += row.totalLiters
    if (row.coverage === "both_channels") acc.bothChannels++
    else if (row.coverage === "tae_only") acc.taeOnly++
    else acc.tctOnly++
    return acc
  }, { taeLiters: 0, tctDieselLiters: 0, tctBlueMaxLiters: 0, totalLiters: 0, bothChannels: 0, taeOnly: 0, tctOnly: 0, unmappedTaeLoads: Number(taeUnmapped.loads), unmappedTaeLiters: Number(taeUnmapped.liters), unmappedTctRecords: Number(tctUnmapped.records), unmappedTctLiters: Number(tctUnmapped.liters) })
  return { rows, summary }
}

function taeUnmappedWhere(session: Session, filters: TaeCopecFilters): SQL | undefined {
  return and(ne(fuelTaeSubmissions.status, "voided"), isNull(fuelTaeSubmissions.vehicleId), filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined, filters.from ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined, filters.to ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined, worksiteScopeSql(session, fuelTaeSubmissions.worksiteId))
}

async function getUnmappedTae(session: Session, filters: TaeCopecFilters) {
  const [row] = await db.select({ loads: sql<number>`count(*)`, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)` }).from(fuelTaeSubmissions).where(taeUnmappedWhere(session, filters))
  return row ?? { loads: 0, liters: 0 }
}

async function getUnmappedTct(session: Session, filters: TaeCopecFilters) {
  const where = and(ilike(fuelConsumptionRecords.fuente, "Copec TCT%"), isNull(fuelConsumptionRecords.vehicleId), filters.worksiteId ? eq(fuelConsumptionRecords.worksiteId, filters.worksiteId) : undefined, filters.from ? gte(fuelConsumptionRecords.periodoHasta, filters.from) : undefined, filters.to ? lte(fuelConsumptionRecords.periodoDesde, filters.to) : undefined, worksiteScopeSql(session, fuelConsumptionRecords.worksiteId))
  const [row] = await db.select({ records: sql<number>`count(*)`, liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)` }).from(fuelConsumptionRecords).where(where)
  return row ?? { records: 0, liters: 0 }
}
