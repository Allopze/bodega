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

import type { FuelLogSource, FuelLogRow, FuelLogFilters } from "./fuel-log-shared"
export type { FuelLogSource, FuelLogRow, FuelLogFilters }
export { FUEL_LOG_SOURCE_LABEL } from "./fuel-log-shared"

/** Ruta de detalle en el sistema fuente de cada fila. */
export function fuelLogDetailHref(row: Pick<FuelLogRow, "source" | "detailId">): string {
  if (row.source === "tae_pwa") return `/combustibles/tae/${row.detailId}`
  if (row.source === "invoiced") return `/combustibles/${row.detailId}`
  return `/combustibles/importar/operaciones/${row.detailId}` // sin página propia por fila: abre el lote
}

/** Subquery de conteo de anomalías, reutilizada por las 3 ramas con su propio `referenceEntityType`. */
function anomalyCountSql(referenceEntityType: string, idColumn: unknown) {
  return sql<number | null>`(select count(*)::int from fuel_anomaly_cases ac where ac.reference_entity_type = ${referenceEntityType} and ac.reference_entity_id = ${idColumn} and ac.status IN ('open', 'in_review', 'reopened'))`.as("anomalyCount")
}

/** Subquery de marca de revisión, reutilizada por las 3 ramas con su propio `entityType`. */
function reviewMarkSql(entityType: string, idColumn: unknown) {
  return sql<boolean | null>`(
    select true from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
  )`.as("reviewMark")
}

function reviewMarkNotesSql(entityType: string, idColumn: unknown) {
  return sql<string | null>`(
    select rm.notes from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
  )`.as("reviewMarkNotes")
}

function reviewMarkIdSql(entityType: string, idColumn: unknown) {
  return sql<string | null>`(
    select rm.id from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
  )`.as("reviewMarkId")
}

/** Filtro EXISTS sobre `fuel_anomaly_cases`, reutilizado por las 3 ramas. `undefined` si no hay ningún filtro de anomalía activo. */
function anomalyFilterSql(referenceEntityType: string, idColumn: unknown, filters: FuelLogFilters) {
  if (!filters.hasAnomaly && !filters.anomalyRuleCode && !filters.anomalySeverity && !filters.anomalyAssigneeId) return undefined
  return sql`exists (
    select 1 from fuel_anomaly_cases ac
    where ac.reference_entity_type = ${referenceEntityType}
      and ac.reference_entity_id = ${idColumn}
      and ac.status IN ('open', 'in_review', 'reopened')
      ${filters.anomalyRuleCode ? sql`and ac.rule_code = ${filters.anomalyRuleCode}` : sql``}
      ${filters.anomalySeverity ? sql`and ac.severity = ${filters.anomalySeverity}` : sql``}
      ${filters.anomalyAssigneeId ? sql`and ac.assignee_id = ${filters.anomalyAssigneeId}` : sql``}
  )`
}

/** Entidad/id que audita cada fila, para "Consultar historial de cambios". */
/** Mapea `FuelLogSource` al nombre de la tabla para referencias polimórficas (auditoría, marcas de revisión, etc.). */
export function fuelLogEntityType(source: FuelLogSource): string {
  if (source === "tae_pwa") return "fuel_tae_submission"
  if (source === "invoiced") return "fuel_load"
  return "fuel_operation_record"
}

export function fuelLogAuditEntity(row: Pick<FuelLogRow, "source" | "id">): { entityType: string; entityId: string } | null {
  if (row.source === "tae_pwa") return { entityType: "fuel_tae_submission", entityId: row.id }
  if (row.source === "invoiced") return { entityType: "fuel_load", entityId: row.id }
  return null // el log operacional se audita a nivel de lote, no de fila individual
}

function buildTaeBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      // Toda columna de aquí en más lleva `.as()` explícito, aunque Drizzle a
      // veces alias solo con la key del objeto: dentro de un `unionAll(...).as()`
      // envuelto en otro `.select()`, las referencias de columna simples (sin
      // `sql` + `.as()`) pierden ese alias y terminan usando el nombre físico
      // de la columna de origen — con varias columnas de esta rama compartiendo
      // el mismo nombre físico ("id" en id/detailId, "name" en worksiteName/
      // loadingPointName/equipmentTypeName/productName/updatedByName), eso deja
      // al `unionAll` con columnas de salida duplicadas y CUALQUIER consulta que
      // no filtre por una sola fuente (el estado por defecto de la bitácora)
      // rompe con "column reference is ambiguous". No es un matiz de estilo.
      id: sql<string>`${fuelTaeSubmissions.id}`.as("id"),
      detailId: sql<string>`${fuelTaeSubmissions.id}`.as("detailId"),
      source: sql<FuelLogSource>`'tae_pwa'`.as("source"),
      occurredAt: sql<string>`${fuelTaeSubmissions.loadedAt}`.as("occurredAt"),
      worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
      supplierId: sql<string | null>`NULL`.as("supplierId"),
      supplierName: sql<string | null>`NULL`.as("supplierName"),
      loadingPointName: sql<string | null>`${fuelTaeLoadingPoints.name}`.as("loadingPointName"),
      // equipmentCodeSnapshot/driverNameSnapshot/supervisorNameSnapshot son NOT
      // NULL en esta tabla, pero las columnas equivalentes de las otras dos ramas
      // son nullable (join o texto libre): unionAll exige el mismo tipo en las
      // tres, así que se fuerza aquí con un cast explícito.
      equipmentCode: sql<string | null>`${fuelTaeSubmissions.equipmentCodeSnapshot}`.as("equipmentCode"),
      plate: sql<string | null>`${fuelTaeSubmissions.plateSnapshot}`.as("plate"),
      equipmentTypeId: sql<string | null>`${fuelEquipmentTypes.id}`.as("equipmentTypeId"),
      equipmentTypeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("equipmentTypeName"),
      driverName: sql<string | null>`${fuelTaeSubmissions.driverNameSnapshot}`.as("driverName"),
      supervisorName: sql<string | null>`${fuelTaeSubmissions.supervisorNameSnapshot}`.as("supervisorName"),
      // productId es NOT NULL en esta tabla; nullable en el log operacional (sin
      // concepto de producto). Mismo motivo que equipmentCode/driverName arriba.
      productId: sql<string | null>`${fuelTaeSubmissions.productId}`.as("productId"),
      productName: sql<string | null>`${fuelProducts.name}`.as("productName"),
      liters: sql<number>`${fuelTaeSubmissions.liters}`.as("liters"),
      meterReading: sql<number | null>`${fuelTaeSubmissions.meterReading}`.as("meterReading"),
      meterLabel: sql<string | null>`case ${fuelTaeSubmissions.meterType} when 'odometer' then 'Odómetro' when 'hour_meter' then 'Horómetro' else NULL end`.as("meterLabel"),
      performanceValue: sql<number | null>`NULL::numeric`.as("performanceValue"),
      performanceUnit: sql<string | null>`NULL`.as("performanceUnit"),
      sealRemoved: sql<string | null>`${fuelTaeSubmissions.removedSealNumber}`.as("sealRemoved"),
      sealInstalled: sql<string | null>`${fuelTaeSubmissions.installedSealNumber}`.as("sealInstalled"),
      evidenceCount: sql<number | null>`(select count(*)::int from fuel_tae_evidence where fuel_tae_evidence.submission_id = ${fuelTaeSubmissions.id})`.as("evidenceCount"),
      notes: sql<string | null>`${fuelTaeSubmissions.notes}`.as("notes"),
      statusLabel: sql<string>`${fuelTaeSubmissions.status}`.as("statusLabel"),
      createdByName: sql<string | null>`NULL`.as("createdByName"),
      updatedByName: sql<string | null>`${users.name}`.as("updatedByName"),
      createdAt: sql<string>`${fuelTaeSubmissions.createdAt}`.as("createdAt"),
      // Igual que arriba: NOT NULL aquí, pero el log operacional no tiene un
      // "modificado" por fila — se fuerza nullable para que coincida en las tres ramas.
      updatedAt: sql<string | null>`${fuelTaeSubmissions.updatedAt}`.as("updatedAt"),
      anomalyCount: anomalyCountSql("fuel_tae_submission", fuelTaeSubmissions.id),
      reviewMark: reviewMarkSql("fuel_tae_submission", fuelTaeSubmissions.id),
      reviewMarkNotes: reviewMarkNotesSql("fuel_tae_submission", fuelTaeSubmissions.id),
      reviewMarkId: reviewMarkIdSql("fuel_tae_submission", fuelTaeSubmissions.id),
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
      // Marca/modelo: TAE se asocia vía fuelVehicles.
      filters.brand ? ilike(fuelVehicles.brand, `%${filters.brand}%`) : undefined,
      filters.model ? ilike(fuelVehicles.model, `%${filters.model}%`) : undefined,
      filters.driverName ? ilike(fuelTaeSubmissions.driverNameSnapshot, `%${filters.driverName}%`) : undefined,
      filters.supervisorName ? ilike(fuelTaeSubmissions.supervisorNameSnapshot, `%${filters.supervisorName}%`) : undefined,
      filters.loadingPointId ? eq(fuelTaeLoadingPoints.id, filters.loadingPointId) : undefined,
      filters.performanceUnit ? eq(fuelVehicles.performanceUnit, filters.performanceUnit) : undefined,
      filters.operationalStatus ? eq(fuelVehicles.operationalStatus, filters.operationalStatus) : undefined,
      filters.sealRemoved ? ilike(fuelTaeSubmissions.removedSealNumber, `%${filters.sealRemoved}%`) : undefined,
      filters.sealInstalled ? ilike(fuelTaeSubmissions.installedSealNumber, `%${filters.sealInstalled}%`) : undefined,
      filters.evidenceKind ? sql`exists (select 1 from fuel_tae_evidence e where e.submission_id = ${fuelTaeSubmissions.id} and e.kind = ${filters.evidenceKind})` : undefined,
      anomalyFilterSql("fuel_tae_submission", fuelTaeSubmissions.id, filters),
      filters.hasReviewMark ? sql`exists (select 1 from fuel_review_marks rm where rm.entity_type = 'fuel_tae_submission' and rm.entity_id = ${fuelTaeSubmissions.id})` : undefined,
    ))
}

function buildInvoicedBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      id: sql<string>`${fuelLoads.id}`.as("id"),
      detailId: sql<string>`${fuelLoads.id}`.as("detailId"),
      source: sql<FuelLogSource>`'invoiced'`.as("source"),
      occurredAt: sql<string>`(${fuelLoads.loadDate})::timestamptz`.as("occurredAt"),
      worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
      supplierId: sql<string | null>`${fuelSuppliers.id}`.as("supplierId"),
      supplierName: sql<string | null>`${fuelSuppliers.name}`.as("supplierName"),
      loadingPointName: sql<string | null>`NULL`.as("loadingPointName"),
      equipmentCode: sql<string | null>`${fuelVehicles.code}`.as("equipmentCode"),
      plate: sql<string | null>`${fuelVehicles.plate}`.as("plate"),
      equipmentTypeId: sql<string | null>`${fuelEquipmentTypes.id}`.as("equipmentTypeId"),
      equipmentTypeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("equipmentTypeName"),
      driverName: sql<string | null>`NULL`.as("driverName"),
      supervisorName: sql<string | null>`NULL`.as("supervisorName"),
      // productId es NOT NULL aquí; nullable en el log operacional.
      productId: sql<string | null>`${fuelLoads.productId}`.as("productId"),
      productName: sql<string | null>`${fuelProducts.name}`.as("productName"),
      liters: sql<number>`${fuelLoads.liters}`.as("liters"),
      meterReading: sql<number | null>`coalesce(${fuelLoads.odometerReading}, ${fuelLoads.hourMeterReading})`.as("meterReading"),
      meterLabel: sql<string | null>`case when ${fuelLoads.odometerReading} is not null then 'Odómetro' when ${fuelLoads.hourMeterReading} is not null then 'Horómetro' else NULL end`.as("meterLabel"),
      performanceValue: sql<number | null>`NULL::numeric`.as("performanceValue"),
      performanceUnit: sql<string | null>`NULL`.as("performanceUnit"),
      sealRemoved: sql<string | null>`NULL`.as("sealRemoved"),
      sealInstalled: sql<string | null>`NULL`.as("sealInstalled"),
      evidenceCount: sql<number | null>`NULL::int`.as("evidenceCount"),
      notes: sql<string | null>`${fuelLoads.notes}`.as("notes"),
      statusLabel: sql<string>`${fuelLoads.status}`.as("statusLabel"),
      createdByName: sql<string | null>`${users.name}`.as("createdByName"),
      updatedByName: sql<string | null>`NULL`.as("updatedByName"),
      createdAt: sql<string>`${fuelLoads.createdAt}`.as("createdAt"),
      updatedAt: sql<string | null>`${fuelLoads.updatedAt}`.as("updatedAt"),
      anomalyCount: anomalyCountSql("fuel_load", fuelLoads.id),
      reviewMark: reviewMarkSql("fuel_load", fuelLoads.id),
      reviewMarkNotes: reviewMarkNotesSql("fuel_load", fuelLoads.id),
      reviewMarkId: reviewMarkIdSql("fuel_load", fuelLoads.id),
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
      filters.brand ? ilike(fuelVehicles.brand, `%${filters.brand}%`) : undefined,
      filters.model ? ilike(fuelVehicles.model, `%${filters.model}%`) : undefined,
      // Facturación no tiene conductor/supervisor ni lugar de carga.
      filters.driverName ? sql`false` : undefined,
      filters.supervisorName ? sql`false` : undefined,
      filters.loadingPointId ? sql`false` : undefined,
      filters.performanceUnit ? eq(fuelVehicles.performanceUnit, filters.performanceUnit) : undefined,
      filters.operationalStatus ? eq(fuelVehicles.operationalStatus, filters.operationalStatus) : undefined,
      // Sellos: sólo TAE los tiene.
      filters.sealRemoved ? sql`false` : undefined,
      filters.sealInstalled ? sql`false` : undefined,
      filters.evidenceKind ? sql`false` : undefined,
      anomalyFilterSql("fuel_load", fuelLoads.id, filters),
      filters.hasReviewMark ? sql`exists (select 1 from fuel_review_marks rm where rm.entity_type = 'fuel_load' and rm.entity_id = ${fuelLoads.id})` : undefined,
    ))
}

function buildOperationBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  return db
    .select({
      id: sql<string>`${fuelOperationRecords.id}`.as("id"),
      detailId: sql<string>`${fuelOperationRecords.batchId}`.as("detailId"), // sin página de detalle por fila: se abre el lote que la contiene
      source: sql<FuelLogSource>`'operation_manual'`.as("source"),
      occurredAt: sql<string>`(${fuelOperationRecords.fecha} || ' ' || coalesce(${fuelOperationRecords.horaCarga}, '00:00'))::timestamptz`.as("occurredAt"),
      worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
      supplierId: sql<string | null>`${fuelSuppliers.id}`.as("supplierId"),
      supplierName: sql<string | null>`coalesce(${fuelSuppliers.name}, ${fuelOperationRecords.proveedorNombre})`.as("supplierName"),
      loadingPointName: sql<string | null>`NULL`.as("loadingPointName"),
      equipmentCode: sql<string | null>`${fuelOperationRecords.code}`.as("equipmentCode"),
      // plate es NOT NULL en esta tabla; nullable en las otras dos ramas.
      plate: sql<string | null>`${fuelOperationRecords.plate}`.as("plate"),
      equipmentTypeId: sql<string | null>`${fuelEquipmentTypes.id}`.as("equipmentTypeId"),
      equipmentTypeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("equipmentTypeName"),
      driverName: sql<string | null>`${fuelOperationRecords.operador}`.as("driverName"),
      supervisorName: sql<string | null>`${fuelOperationRecords.supervisor}`.as("supervisorName"),
      productId: sql<string | null>`NULL`.as("productId"),
      productName: sql<string | null>`NULL`.as("productName"),
      liters: sql<number>`${fuelOperationRecords.liters}`.as("liters"),
      meterReading: sql<number | null>`${fuelOperationRecords.horometro}`.as("meterReading"),
      meterLabel: sql<string | null>`case when ${fuelOperationRecords.horometro} is not null then 'Medidor (' || coalesce(${fuelOperationRecords.medidoPor}, 'sin unidad') || ')' else NULL end`.as("meterLabel"),
      performanceValue: sql<number | null>`${fuelOperationRecords.rendimiento}`.as("performanceValue"),
      performanceUnit: sql<string | null>`${fuelOperationRecords.tipoRendimiento}`.as("performanceUnit"),
      sealRemoved: sql<string | null>`NULL`.as("sealRemoved"),
      sealInstalled: sql<string | null>`NULL`.as("sealInstalled"),
      evidenceCount: sql<number | null>`NULL::int`.as("evidenceCount"),
      notes: sql<string | null>`NULL`.as("notes"),
      statusLabel: sql<string>`${fuelOperationBatches.estado}`.as("statusLabel"),
      createdByName: sql<string | null>`${users.name}`.as("createdByName"),
      updatedByName: sql<string | null>`NULL`.as("updatedByName"),
      createdAt: sql<string>`${fuelOperationRecords.createdAt}`.as("createdAt"),
      updatedAt: sql<string | null>`NULL`.as("updatedAt"),
      anomalyCount: anomalyCountSql("fuel_operation_record", fuelOperationRecords.id),
      reviewMark: reviewMarkSql("fuel_operation_record", fuelOperationRecords.id),
      reviewMarkNotes: reviewMarkNotesSql("fuel_operation_record", fuelOperationRecords.id),
      reviewMarkId: reviewMarkIdSql("fuel_operation_record", fuelOperationRecords.id),
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
      filters.brand ? ilike(fuelOperationRecords.marca, `%${filters.brand}%`) : undefined,
      filters.model ? ilike(fuelOperationRecords.modelo, `%${filters.model}%`) : undefined,
      filters.driverName ? ilike(fuelOperationRecords.operador, `%${filters.driverName}%`) : undefined,
      filters.supervisorName ? ilike(fuelOperationRecords.supervisor, `%${filters.supervisorName}%`) : undefined,
      // Tampoco tiene lugar de carga ni observaciones.
      filters.loadingPointId ? sql`false` : undefined,
      filters.performanceUnit ? eq(fuelOperationRecords.tipoRendimiento, filters.performanceUnit) : undefined,
      filters.operationalStatus ? eq(fuelVehicles.operationalStatus, filters.operationalStatus) : undefined,
      filters.sealRemoved ? sql`false` : undefined,
      filters.sealInstalled ? sql`false` : undefined,
      filters.evidenceKind ? sql`false` : undefined,
      anomalyFilterSql("fuel_operation_record", fuelOperationRecords.id, filters),
      filters.hasReviewMark ? sql`exists (select 1 from fuel_review_marks rm where rm.entity_type = 'fuel_operation_record' and rm.entity_id = ${fuelOperationRecords.id})` : undefined,
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
  // Desempate por `id`: `occurredAt` se repite masivamente (todas las filas de
  // un mismo lote importado comparten instante) y sin criterio estable Postgres
  // puede ordenar los empates distinto en cada consulta — la misma fila salía
  // en dos páginas y otra no salía en ninguna.
  const rows = await db.select().from(rowsQuery)
    .orderBy(
      page.sort === "asc" ? asc(rowsQuery.occurredAt) : desc(rowsQuery.occurredAt),
      page.sort === "asc" ? asc(rowsQuery.id) : desc(rowsQuery.id),
    )
    .limit(page.limit).offset(page.offset)
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
