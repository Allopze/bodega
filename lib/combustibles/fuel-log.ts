/**
 * Bitácora general unificada: une TAE (PWA), facturación (TCT/TAE) y el log
 * operacional importado en una sola consulta paginada en servidor.
 *
 * No es un contrato de conciliación — cada fuente conserva su origen (`source`)
 * y su vocabulario de estado propio. No sumar litros entre fuentes sin el
 * contrato aprobado en `docs/combustibles/CONTROL_COMBUSTIBLE_INTEGRADO.md`.
 * No se exponen montos: no existe todavía el permiso "ver costos" (sección 14).
 */

import type { Session } from "next-auth"
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm"
import { unionAll } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes,
  fuelLoads,
  fuelOperationBatches,
  fuelOperationRecords,
  fuelProducts,
  fuelSuppliers,
  fuelTaeLoadingPoints,
  fuelTaeSubmissions,
  fuelVehicles,
  users,
  worksites,
} from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export type FuelLogSource = "tae_pwa" | "invoiced" | "operation_manual"

export const FUEL_LOG_SOURCE_LABEL: Record<FuelLogSource, string> = {
  tae_pwa: "TAE (PWA)",
  invoiced: "Facturación",
  operation_manual: "Log operacional",
}

export interface FuelLogFilters {
  worksiteId?: string
  source?: FuelLogSource
  q?: string
  from?: string // "YYYY-MM-DD"
  to?: string   // "YYYY-MM-DD"
  supplierId?: string
  productId?: string
  equipmentTypeId?: string
  hasNotes?: boolean
}

export interface FuelLogRow {
  /** Identidad real de la fila — única incluso cuando varias filas comparten `detailId` (log operacional). */
  id: string
  /** Adónde navega "Abrir detalle": el registro mismo (TAE/facturación) o el lote que lo contiene (log operacional, sin página propia por fila). */
  detailId: string
  source: FuelLogSource
  occurredAt: string
  worksiteName: string | null
  supplierId: string | null
  supplierName: string | null
  loadingPointName: string | null
  equipmentCode: string | null
  plate: string | null
  equipmentTypeId: string | null
  equipmentTypeName: string | null
  driverName: string | null
  supervisorName: string | null
  productId: string | null
  productName: string | null
  liters: number
  meterReading: number | null
  meterLabel: string | null
  performanceValue: number | null
  performanceUnit: string | null
  sealRemoved: string | null
  sealInstalled: string | null
  evidenceCount: number | null
  notes: string | null
  statusLabel: string | null
  createdByName: string | null
  updatedByName: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Ruta de detalle en el sistema fuente de cada fila. */
export function fuelLogDetailHref(row: Pick<FuelLogRow, "source" | "detailId">): string {
  if (row.source === "tae_pwa") return `/combustibles/tae/${row.detailId}`
  if (row.source === "invoiced") return `/combustibles/${row.detailId}`
  return `/combustibles/importar/operaciones/${row.detailId}` // sin página propia por fila: abre el lote
}

/** Entidad/id que audita cada fila, para "Consultar historial de cambios". */
export function fuelLogAuditEntity(row: Pick<FuelLogRow, "source" | "id">): { entityType: string; entityId: string } | null {
  if (row.source === "tae_pwa") return { entityType: "fuel_tae_submission", entityId: row.id }
  if (row.source === "invoiced") return { entityType: "fuel_load", entityId: row.id }
  return null // el log operacional se audita a nivel de lote, no de fila individual
}

function buildTaeBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      id: fuelTaeSubmissions.id,
      detailId: fuelTaeSubmissions.id,
      source: sql<FuelLogSource>`'tae_pwa'`.as("source"),
      occurredAt: fuelTaeSubmissions.loadedAt,
      worksiteName: worksites.name,
      supplierId: sql<string | null>`NULL`.as("supplierId"),
      supplierName: sql<string | null>`NULL`.as("supplierName"),
      loadingPointName: fuelTaeLoadingPoints.name,
      // equipmentCodeSnapshot/driverNameSnapshot/supervisorNameSnapshot son NOT
      // NULL en esta tabla, pero las columnas equivalentes de las otras dos ramas
      // son nullable (join o texto libre): unionAll exige el mismo tipo en las
      // tres, así que se fuerza aquí con un cast explícito.
      equipmentCode: sql<string | null>`${fuelTaeSubmissions.equipmentCodeSnapshot}`.as("equipmentCode"),
      plate: fuelTaeSubmissions.plateSnapshot,
      equipmentTypeId: fuelEquipmentTypes.id,
      equipmentTypeName: fuelEquipmentTypes.name,
      driverName: sql<string | null>`${fuelTaeSubmissions.driverNameSnapshot}`.as("driverName"),
      supervisorName: sql<string | null>`${fuelTaeSubmissions.supervisorNameSnapshot}`.as("supervisorName"),
      // productId es NOT NULL en esta tabla; nullable en el log operacional (sin
      // concepto de producto). Mismo motivo que equipmentCode/driverName arriba.
      productId: sql<string | null>`${fuelTaeSubmissions.productId}`.as("productId"),
      productName: fuelProducts.name,
      liters: fuelTaeSubmissions.liters,
      meterReading: fuelTaeSubmissions.meterReading,
      meterLabel: sql<string | null>`case ${fuelTaeSubmissions.meterType} when 'odometer' then 'Odómetro' when 'hour_meter' then 'Horómetro' else NULL end`.as("meterLabel"),
      performanceValue: sql<number | null>`NULL::numeric`.as("performanceValue"),
      performanceUnit: sql<string | null>`NULL`.as("performanceUnit"),
      sealRemoved: fuelTaeSubmissions.removedSealNumber,
      sealInstalled: fuelTaeSubmissions.installedSealNumber,
      evidenceCount: sql<number | null>`(select count(*)::int from fuel_tae_evidence where fuel_tae_evidence.submission_id = ${fuelTaeSubmissions.id})`.as("evidenceCount"),
      notes: fuelTaeSubmissions.notes,
      statusLabel: fuelTaeSubmissions.status,
      createdByName: sql<string | null>`NULL`.as("createdByName"),
      updatedByName: users.name,
      createdAt: fuelTaeSubmissions.createdAt,
      // Igual que arriba: NOT NULL aquí, pero el log operacional no tiene un
      // "modificado" por fila — se fuerza nullable para que coincida en las tres ramas.
      updatedAt: sql<string | null>`${fuelTaeSubmissions.updatedAt}`.as("updatedAt"),
    })
    .from(fuelTaeSubmissions)
    .leftJoin(worksites, eq(fuelTaeSubmissions.worksiteId, worksites.id))
    .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
    .leftJoin(fuelVehicles, eq(fuelTaeSubmissions.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .leftJoin(fuelProducts, eq(fuelTaeSubmissions.productId, fuelProducts.id))
    .leftJoin(users, eq(fuelTaeSubmissions.reviewedBy, users.id))
    .where(and(
      worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
      filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
      filters.from ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined,
      filters.to ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined,
      searchPattern ? or(
        ilike(fuelTaeSubmissions.equipmentCodeSnapshot, searchPattern),
        ilike(fuelTaeSubmissions.plateSnapshot, searchPattern),
        ilike(fuelTaeSubmissions.driverNameSnapshot, searchPattern),
        ilike(fuelTaeSubmissions.supervisorNameSnapshot, searchPattern),
      ) : undefined,
      ids ? inArray(fuelTaeSubmissions.id, ids) : undefined,
      // TAE no tiene proveedor: filtrar por proveedor excluye toda esta rama.
      filters.supplierId ? sql`false` : undefined,
      filters.productId ? eq(fuelTaeSubmissions.productId, filters.productId) : undefined,
      filters.equipmentTypeId ? eq(fuelEquipmentTypes.id, filters.equipmentTypeId) : undefined,
      filters.hasNotes ? sql`${fuelTaeSubmissions.notes} is not null and btrim(${fuelTaeSubmissions.notes}) <> ''` : undefined,
    ))
}

function buildInvoicedBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      id: fuelLoads.id,
      detailId: fuelLoads.id,
      source: sql<FuelLogSource>`'invoiced'`.as("source"),
      occurredAt: sql<string>`(${fuelLoads.loadDate})::timestamptz`.as("occurredAt"),
      worksiteName: worksites.name,
      supplierId: fuelSuppliers.id,
      supplierName: fuelSuppliers.name,
      loadingPointName: sql<string | null>`NULL`.as("loadingPointName"),
      equipmentCode: fuelVehicles.code,
      plate: fuelVehicles.plate,
      equipmentTypeId: fuelEquipmentTypes.id,
      equipmentTypeName: fuelEquipmentTypes.name,
      driverName: sql<string | null>`NULL`.as("driverName"),
      supervisorName: sql<string | null>`NULL`.as("supervisorName"),
      // productId es NOT NULL aquí; nullable en el log operacional.
      productId: sql<string | null>`${fuelLoads.productId}`.as("productId"),
      productName: fuelProducts.name,
      liters: fuelLoads.liters,
      meterReading: sql<number | null>`coalesce(${fuelLoads.odometerReading}, ${fuelLoads.hourMeterReading})`.as("meterReading"),
      meterLabel: sql<string | null>`case when ${fuelLoads.odometerReading} is not null then 'Odómetro' when ${fuelLoads.hourMeterReading} is not null then 'Horómetro' else NULL end`.as("meterLabel"),
      performanceValue: sql<number | null>`NULL::numeric`.as("performanceValue"),
      performanceUnit: sql<string | null>`NULL`.as("performanceUnit"),
      sealRemoved: sql<string | null>`NULL`.as("sealRemoved"),
      sealInstalled: sql<string | null>`NULL`.as("sealInstalled"),
      evidenceCount: sql<number | null>`NULL::int`.as("evidenceCount"),
      notes: fuelLoads.notes,
      statusLabel: fuelLoads.status,
      createdByName: users.name,
      updatedByName: sql<string | null>`NULL`.as("updatedByName"),
      createdAt: fuelLoads.createdAt,
      updatedAt: sql<string | null>`${fuelLoads.updatedAt}`.as("updatedAt"),
    })
    .from(fuelLoads)
    .leftJoin(worksites, eq(fuelLoads.worksiteId, worksites.id))
    .leftJoin(fuelSuppliers, eq(fuelLoads.fuelSupplierId, fuelSuppliers.id))
    .leftJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .leftJoin(fuelProducts, eq(fuelLoads.productId, fuelProducts.id))
    .leftJoin(users, eq(fuelLoads.createdBy, users.id))
    .where(and(
      worksiteScopeSql(session, fuelLoads.worksiteId),
      filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
      // load_date es texto "YYYY-MM-DD": el orden lexicográfico ISO coincide con el cronológico, sin necesidad de cast.
      filters.from ? gte(fuelLoads.loadDate, filters.from) : undefined,
      filters.to ? lte(fuelLoads.loadDate, filters.to) : undefined,
      searchPattern ? or(
        ilike(fuelVehicles.code, searchPattern),
        ilike(fuelVehicles.plate, searchPattern),
        ilike(fuelSuppliers.name, searchPattern),
      ) : undefined,
      ids ? inArray(fuelLoads.id, ids) : undefined,
      filters.supplierId ? eq(fuelLoads.fuelSupplierId, filters.supplierId) : undefined,
      filters.productId ? eq(fuelLoads.productId, filters.productId) : undefined,
      filters.equipmentTypeId ? eq(fuelEquipmentTypes.id, filters.equipmentTypeId) : undefined,
      filters.hasNotes ? sql`${fuelLoads.notes} is not null and btrim(${fuelLoads.notes}) <> ''` : undefined,
    ))
}

function buildOperationBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      id: fuelOperationRecords.id,
      detailId: fuelOperationRecords.batchId, // sin página de detalle por fila: se abre el lote que la contiene
      source: sql<FuelLogSource>`'operation_manual'`.as("source"),
      occurredAt: sql<string>`(${fuelOperationRecords.fecha} || ' ' || coalesce(${fuelOperationRecords.horaCarga}, '00:00'))::timestamptz`.as("occurredAt"),
      worksiteName: worksites.name,
      supplierId: fuelSuppliers.id,
      supplierName: sql<string | null>`coalesce(${fuelSuppliers.name}, ${fuelOperationRecords.proveedorNombre})`.as("supplierName"),
      loadingPointName: sql<string | null>`NULL`.as("loadingPointName"),
      equipmentCode: fuelOperationRecords.code,
      // plate es NOT NULL en esta tabla; nullable en las otras dos ramas.
      plate: sql<string | null>`${fuelOperationRecords.plate}`.as("plate"),
      equipmentTypeId: fuelEquipmentTypes.id,
      equipmentTypeName: fuelEquipmentTypes.name,
      driverName: fuelOperationRecords.operador,
      supervisorName: fuelOperationRecords.supervisor,
      productId: sql<string | null>`NULL`.as("productId"),
      productName: sql<string | null>`NULL`.as("productName"),
      liters: fuelOperationRecords.liters,
      meterReading: fuelOperationRecords.horometro,
      meterLabel: sql<string | null>`case when ${fuelOperationRecords.horometro} is not null then 'Medidor (' || coalesce(${fuelOperationRecords.medidoPor}, 'sin unidad') || ')' else NULL end`.as("meterLabel"),
      performanceValue: fuelOperationRecords.rendimiento,
      performanceUnit: fuelOperationRecords.tipoRendimiento,
      sealRemoved: sql<string | null>`NULL`.as("sealRemoved"),
      sealInstalled: sql<string | null>`NULL`.as("sealInstalled"),
      evidenceCount: sql<number | null>`NULL::int`.as("evidenceCount"),
      notes: sql<string | null>`NULL`.as("notes"),
      statusLabel: fuelOperationBatches.estado,
      createdByName: users.name,
      updatedByName: sql<string | null>`NULL`.as("updatedByName"),
      createdAt: fuelOperationRecords.createdAt,
      updatedAt: sql<string | null>`NULL`.as("updatedAt"),
    })
    .from(fuelOperationRecords)
    .innerJoin(fuelOperationBatches, eq(fuelOperationRecords.batchId, fuelOperationBatches.id))
    .leftJoin(worksites, eq(fuelOperationRecords.worksiteId, worksites.id))
    .leftJoin(fuelSuppliers, eq(fuelOperationRecords.fuelSupplierId, fuelSuppliers.id))
    .leftJoin(fuelVehicles, eq(fuelOperationRecords.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .leftJoin(users, eq(fuelOperationBatches.importadoPor, users.id))
    .where(and(
      worksiteScopeSql(session, fuelOperationRecords.worksiteId),
      filters.worksiteId ? eq(fuelOperationRecords.worksiteId, filters.worksiteId) : undefined,
      eq(fuelOperationBatches.estado, "importado"),
      filters.from ? gte(fuelOperationRecords.fecha, filters.from) : undefined,
      filters.to ? lte(fuelOperationRecords.fecha, filters.to) : undefined,
      searchPattern ? or(
        ilike(fuelOperationRecords.code, searchPattern),
        ilike(fuelOperationRecords.plate, searchPattern),
        ilike(fuelOperationRecords.operador, searchPattern),
        ilike(fuelOperationRecords.supervisor, searchPattern),
      ) : undefined,
      ids ? inArray(fuelOperationRecords.id, ids) : undefined,
      filters.supplierId ? eq(fuelOperationRecords.fuelSupplierId, filters.supplierId) : undefined,
      // El log operacional no clasifica producto por fila: filtrar por producto excluye toda esta rama.
      filters.productId ? sql`false` : undefined,
      filters.equipmentTypeId ? eq(fuelEquipmentTypes.id, filters.equipmentTypeId) : undefined,
      // Tampoco tiene observaciones por fila.
      filters.hasNotes ? sql`false` : undefined,
    ))
}

function buildUnified(session: Session, filters: FuelLogFilters) {
  const q = filters.q?.trim().slice(0, 120)
  const searchPattern = q ? `%${q}%` : null

  if (filters.source === "tae_pwa") return buildTaeBranch(session, filters, searchPattern)
  if (filters.source === "invoiced") return buildInvoicedBranch(session, filters, searchPattern)
  if (filters.source === "operation_manual") return buildOperationBranch(session, filters, searchPattern)

  return unionAll(
    buildTaeBranch(session, filters, searchPattern),
    buildInvoicedBranch(session, filters, searchPattern),
    buildOperationBranch(session, filters, searchPattern),
  )
}

export interface FuelLogPage {
  rows: FuelLogRow[]
  total: number
}

/** Conteo independiente, para resolver la paginación antes de conocer el `offset` de la página pedida. */
export async function getFuelLogTotal(session: Session, filters: FuelLogFilters): Promise<number> {
  const countQuery = buildUnified(session, filters).as("bitacora_total")
  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(countQuery)
  return countRow?.count ?? 0
}

/** Sólo las filas de la página pedida. Llama a `getFuelLogTotal` antes para resolver `offset`. */
export async function getFuelLogRows(session: Session, filters: FuelLogFilters, page: { limit: number; offset: number; sort: "asc" | "desc" }): Promise<FuelLogRow[]> {
  const rowsQuery = buildUnified(session, filters).as("bitacora_page")
  const rows = await db.select().from(rowsQuery).orderBy(page.sort === "asc" ? asc(rowsQuery.occurredAt) : desc(rowsQuery.occurredAt)).limit(page.limit).offset(page.offset)
  return rows as FuelLogRow[]
}

export async function getFuelLogPage(session: Session, filters: FuelLogFilters, page: { limit: number; offset: number; sort: "asc" | "desc" }): Promise<FuelLogPage> {
  const [rows, total] = await Promise.all([
    getFuelLogRows(session, filters, page),
    getFuelLogTotal(session, filters),
  ])
  return { rows, total }
}

export const FUEL_LOG_MAX_EXPORT_ROWS = 10_000

export async function getFuelLogExportRows(session: Session, filters: FuelLogFilters): Promise<{ rows: FuelLogRow[]; truncated: boolean }> {
  const total = await getFuelLogTotal(session, filters)
  const rows = await getFuelLogRows(session, filters, { limit: FUEL_LOG_MAX_EXPORT_ROWS, offset: 0, sort: "desc" })
  return { rows, truncated: total > FUEL_LOG_MAX_EXPORT_ROWS }
}

/**
 * Filas de una selección puntual (checkboxes de la tabla), para "exportar
 * seleccionadas". Siempre unimos las tres ramas con aridad fija — `inArray`
 * con un arreglo vacío compila a `false` (no trae filas), así que una fuente
 * sin selección simplemente no aporta filas, sin necesidad de un union dinámico.
 */
export async function getFuelLogRowsBySelection(session: Session, selections: Array<{ source: FuelLogSource; id: string }>): Promise<FuelLogRow[]> {
  if (!selections.length) return []
  const idsBySource: Record<FuelLogSource, string[]> = { tae_pwa: [], invoiced: [], operation_manual: [] }
  for (const item of selections) idsBySource[item.source].push(item.id)

  const unified = unionAll(
    buildTaeBranch(session, {}, null, idsBySource.tae_pwa),
    buildInvoicedBranch(session, {}, null, idsBySource.invoiced),
    buildOperationBranch(session, {}, null, idsBySource.operation_manual),
  )
  return (await unified) as FuelLogRow[]
}
