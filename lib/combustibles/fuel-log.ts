/**
 * Lista unificada de «Cargas a equipos» (antes «bitácora»): une los registros en
 * terreno (formulario por QR, app, histórico de sellos), las facturas y la
 * planilla de cargas en una sola consulta paginada en servidor.
 *
 * No es un contrato de conciliación — cada fuente conserva su origen (`source`
 * y `origin`) y su vocabulario de estado propio. No sumar litros entre fuentes
 * sin el contrato aprobado en `docs/combustibles/CONTROL_COMBUSTIBLE_INTEGRADO.md`.
 * No se exponen montos: la lista no lleva dinero (el monto de una factura vive en
 * su ficha, con `view_costs`).
 */

import type { Session } from "next-auth"
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm"
import { unionAll } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentLoads,
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

import { FUEL_LOAD_ORIGIN_LABEL, FUEL_LOAD_STATE_LABEL, FUEL_LOAD_STATE_SLUGS, fuelLogBranchesFor, type FieldLoadAttention, type FuelLogSource, type FuelLogRow, type FuelLogFilters, type FuelLoadOriginSlug } from "./fuel-log-shared"
export type { FuelLogSource, FuelLogRow, FuelLogFilters, FieldLoadAttention }
export { FUEL_LOG_SOURCE_LABEL, fuelLogDetailHref } from "./fuel-log-shared"

/**
 * Datos personales (D-10, P-01): nombres de conductor y supervisor. Se decide
 * aquí, en el servidor, a partir de la sesión: sin `combustibles:view_personal`
 * la consulta devuelve NULL en esas columnas, ignora los filtros por nombre y
 * no busca por ellos (un filtro por nombre sería un oráculo para adivinar
 * quién cargó). No usa `can()` para no arrastrar `next/headers` a este módulo.
 */
export function canViewFuelPersonalData(session: Session | null): boolean {
  return session?.user?.permissions?.includes("combustibles:view_personal") ?? false
}

/**
 * La unidad de rendimiento del filtro (`km_per_liter`, `liters_per_hour`) es el
 * vocabulario de `fuel_vehicles.performance_unit`; el log operacional guarda
 * `tipo_rendimiento` con el suyo (`km_lt`, `lt_hr`). Compararlos en crudo
 * descartaba todo el log operacional al filtrar por unidad (D-11).
 */
const OPERATION_PERFORMANCE_UNIT: Record<string, string> = { km_per_liter: "km_lt", liters_per_hour: "lt_hr" }

export function operationPerformanceUnitCode(unit: string): string {
  return OPERATION_PERFORMANCE_UNIT[unit] ?? unit
}

/**
 * Instante real de una fila del log operacional: `fecha` (día) + `horaCarga`
 * (puede faltar) fundidos en un timestamp ordenable. Sin esto, dos cargas del
 * mismo día devuelven un ganador arbitrario al pedir "la última lectura" —
 * `fecha` sola no distingue entre ellas (sección CO-023).
 */
export function fuelOperationOccurredAtSql() {
  return sql<string>`(${fuelOperationRecords.fecha} || ' ' || coalesce(${fuelOperationRecords.horaCarga}, '00:00'))::timestamptz`
}

/** Subquery de conteo de anomalías, reutilizada por las 3 ramas con su propio `referenceEntityType`. */
function anomalyCountSql(referenceEntityType: string, idColumn: unknown) {
  return sql<number | null>`(select count(*)::int from fuel_anomaly_cases ac where ac.reference_entity_type = ${referenceEntityType} and ac.reference_entity_id = ${idColumn} and ac.status IN ('open', 'in_review', 'reopened'))`.as("anomalyCount")
}

/**
 * Subqueries del pedido de revisión («Pedir que la revisen»). Sólo cuenta el
 * pedido ABIERTO: uno resuelto o retirado queda en el historial de la carga pero
 * ya no marca la fila. Hay a lo sumo uno abierto por carga (índice único parcial).
 */
function reviewMarkSql(entityType: string, idColumn: unknown) {
  return sql<boolean | null>`(
    select true from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
      and rm.status = 'open'
  )`.as("reviewMark")
}

function reviewMarkNotesSql(entityType: string, idColumn: unknown) {
  return sql<string | null>`(
    select rm.notes from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
      and rm.status = 'open'
  )`.as("reviewMarkNotes")
}

function reviewMarkIdSql(entityType: string, idColumn: unknown) {
  return sql<string | null>`(
    select rm.id from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
      and rm.status = 'open'
  )`.as("reviewMarkId")
}

/** Quién pidió la revisión abierta (para decidir si la sesión puede retirarla). */
function reviewMarkedBySql(entityType: string, idColumn: unknown) {
  return sql<string | null>`(
    select rm.marked_by from fuel_review_marks rm
    where rm.entity_type = ${entityType}
      and rm.entity_id = ${idColumn}
      and rm.status = 'open'
  )`.as("reviewMarkedBy")
}

/** `exists` de un pedido de revisión abierto sobre la carga. */
function openReviewMarkExistsSql(entityType: string, idColumn: unknown) {
  return sql`exists (select 1 from fuel_review_marks rm where rm.entity_type = ${entityType} and rm.entity_id = ${idColumn} and rm.status = 'open')`
}

/** Fuentes de `fuel_tae_submissions.source` que corresponden a los orígenes pedidos en `como`. */
function taeSourcesForOrigins(origins: readonly FuelLoadOriginSlug[]): string[] {
  const bySource: Record<string, FuelLoadOriginSlug> = { public_pwa: "qr", internal_app: "app", legacy_xlsx: "historico" }
  return Object.entries(bySource).filter(([, origin]) => origins.includes(origin)).map(([source]) => source)
}

/** Filtro EXISTS sobre `fuel_anomaly_cases`, reutilizado por las 3 ramas. `undefined` si no hay ningún filtro de anomalía activo. */
/** Un caso de anomalía abierto, en revisión o reabierto sobre la fila: cuenta como pendiente. */
function openCaseExistsSql(referenceEntityType: string, idColumn: unknown) {
  return sql`exists (select 1 from fuel_anomaly_cases ac where ac.reference_entity_type = ${referenceEntityType} and ac.reference_entity_id = ${idColumn} and ac.status IN ('open', 'in_review', 'reopened'))`
}

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

/**
 * «Sello incompleto» de un registro en terreno: el sello retirado o el instalado sin
 * informar (nulo o en blanco). Una sola definición para el filtro `sello=faltante` de la
 * lista y para la cifra de la tira de Cargas: si cada uno tuviera la suya, el número y las
 * filas que abre al hacer clic podrían dejar de coincidir sin que nada lo avisara.
 */
const TAE_SEAL_INCOMPLETE_SQL = sql`(${fuelTaeSubmissions.removedSealNumber} is null or btrim(${fuelTaeSubmissions.removedSealNumber}) = '' or ${fuelTaeSubmissions.installedSealNumber} is null or btrim(${fuelTaeSubmissions.installedSealNumber}) = '')`

/**
 * «Menos de 4 fotos» de un registro en terreno (menos de 4 tipos distintos de evidencia).
 * Una carga registrada después (fecha pasada, `loaded_at_source = 'backdated'`) tiene las
 * fotos opcionales: no cuenta como «le faltan fotos». Compartida por el filtro
 * `evidencia=faltante` y por la tira de Cargas, por la misma razón que el sello.
 */
const TAE_PHOTOS_INCOMPLETE_SQL = sql`(${fuelTaeSubmissions.loadedAtSource} <> 'backdated' and (select count(distinct e.kind) from fuel_tae_evidence e where e.submission_id = ${fuelTaeSubmissions.id}) < 4)`

/** `%texto%` de la búsqueda libre, recortada igual en la lista y en la tira de Cargas; `null` sin búsqueda. */
function searchPatternOf(filters: FuelLogFilters): string | null {
  const q = filters.q?.trim().slice(0, 120)
  return q ? `%${q}%` : null
}

/**
 * Las condiciones de la rama de registros en terreno, aparte de la consulta que las usa:
 * `buildTaeBranch` arma con ellas las filas de la lista y `getFieldLoadAttention` las cuenta,
 * así una cifra de la tira de Cargas es el número de filas de su filtro y no una aproximación
 * hecha por otro camino. Alcance por faena y datos personales se resuelven aquí, en el servidor.
 *
 * Referencia las tablas `fuel_equipment_loads`, `fuel_tae_loading_points`, `fuel_vehicles` y
 * `fuel_equipment_types`: quien la use debe unirlas, como hacen las dos consultas de arriba.
 */
function taeConditions(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[], forceEmpty = false): Array<SQL | undefined> {
  const personal = canViewFuelPersonalData(session)
  return [
    forceEmpty ? sql`false` : undefined,
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    filters.from ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined,
    filters.to ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined,
    searchPattern ? or(
      ilike(fuelTaeSubmissions.equipmentCodeSnapshot, searchPattern),
      ilike(fuelTaeSubmissions.plateSnapshot, searchPattern),
      personal ? ilike(fuelTaeSubmissions.driverNameSnapshot, searchPattern) : undefined,
      personal ? ilike(fuelTaeSubmissions.supervisorNameSnapshot, searchPattern) : undefined,
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
    personal && filters.driverName ? ilike(fuelTaeSubmissions.driverNameSnapshot, `%${filters.driverName}%`) : undefined,
    personal && filters.supervisorName ? ilike(fuelTaeSubmissions.supervisorNameSnapshot, `%${filters.supervisorName}%`) : undefined,
    filters.loadingPointId ? eq(fuelTaeLoadingPoints.id, filters.loadingPointId) : undefined,
    filters.performanceUnit ? eq(fuelVehicles.performanceUnit, filters.performanceUnit) : undefined,
    filters.operationalStatus ? eq(fuelVehicles.operationalStatus, filters.operationalStatus) : undefined,
    filters.sealRemoved ? ilike(fuelTaeSubmissions.removedSealNumber, `%${filters.sealRemoved}%`) : undefined,
    filters.sealInstalled ? ilike(fuelTaeSubmissions.installedSealNumber, `%${filters.sealInstalled}%`) : undefined,
    filters.evidenceKind ? sql`exists (select 1 from fuel_tae_evidence e where e.submission_id = ${fuelTaeSubmissions.id} and e.kind = ${filters.evidenceKind})` : undefined,
    anomalyFilterSql("fuel_tae_submission", fuelTaeSubmissions.id, filters),
    filters.hasReviewMark ? openReviewMarkExistsSql("fuel_tae_submission", fuelTaeSubmissions.id) : undefined,
    filters.origins?.length ? inArray(fuelTaeSubmissions.source, taeSourcesForOrigins(filters.origins)) : undefined,
    filters.stateSlug ? taeStateSql(filters.stateSlug) : undefined,
    filters.vehicleId ? eq(fuelTaeSubmissions.vehicleId, filters.vehicleId) : undefined,
    filters.registeredBy ? eq(fuelTaeSubmissions.registeredBy, filters.registeredBy) : undefined,
    filters.sealIncomplete ? TAE_SEAL_INCOMPLETE_SQL : undefined,
    filters.photosIncomplete ? TAE_PHOTOS_INCOMPLETE_SQL : undefined,
    filters.onlyPending ? sql`(${fuelEquipmentLoads.reviewStatus} = 'flagged' or ${fuelTaeSubmissions.status} = 'observed' or ${openReviewMarkExistsSql("fuel_tae_submission", fuelTaeSubmissions.id)} or ${openCaseExistsSql("fuel_tae_submission", fuelTaeSubmissions.id)})` : undefined,
  ]
}

function buildTaeBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[], forceEmpty = false) {
  const personal = canViewFuelPersonalData(session)
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
      driverName: (personal ? sql<string | null>`${fuelTaeSubmissions.driverNameSnapshot}` : sql<string | null>`NULL`).as("driverName"),
      supervisorName: (personal ? sql<string | null>`${fuelTaeSubmissions.supervisorNameSnapshot}` : sql<string | null>`NULL`).as("supervisorName"),
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
      reviewMarkedBy: reviewMarkedBySql("fuel_tae_submission", fuelTaeSubmissions.id),
      origin: sql<FuelLoadOriginSlug>`case ${fuelTaeSubmissions.source} when 'internal_app' then 'app' when 'legacy_xlsx' then 'historico' else 'qr' end`.as("origin"),
      worksiteId: sql<string | null>`${fuelTaeSubmissions.worksiteId}`.as("worksiteId"),
      vehicleId: sql<string | null>`${fuelTaeSubmissions.vehicleId}`.as("vehicleId"),
      equipmentLoadId: sql<string | null>`${fuelEquipmentLoads.id}`.as("equipmentLoadId"),
      reviewFlagged: sql<boolean | null>`(${fuelEquipmentLoads.reviewStatus} = 'flagged')`.as("reviewFlagged"),
      reviewFlagReason: sql<string | null>`(${fuelEquipmentLoads.flagReasons} ->> 0)`.as("reviewFlagReason"),
    })
    .from(fuelTaeSubmissions)
    // Una carga proyectada tiene a lo sumo una fila (índice único por `tae_submission_id`).
    .leftJoin(fuelEquipmentLoads, eq(fuelEquipmentLoads.taeSubmissionId, fuelTaeSubmissions.id))
    .leftJoin(worksites, eq(fuelTaeSubmissions.worksiteId, worksites.id))
    .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
    .leftJoin(fuelVehicles, eq(fuelTaeSubmissions.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .leftJoin(fuelProducts, eq(fuelTaeSubmissions.productId, fuelProducts.id))
    .leftJoin(users, eq(fuelTaeSubmissions.reviewedBy, users.id))
    .where(and(...taeConditions(session, filters, searchPattern, ids, forceEmpty)))
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
      reviewMarkedBy: reviewMarkedBySql("fuel_load", fuelLoads.id),
      origin: sql<FuelLoadOriginSlug>`'factura'`.as("origin"),
      worksiteId: sql<string | null>`${fuelLoads.worksiteId}`.as("worksiteId"),
      vehicleId: sql<string | null>`${fuelLoads.vehicleId}`.as("vehicleId"),
      // Una factura no pasa por la proyección de cargas a equipos: nada que decidir en la bandeja.
      equipmentLoadId: sql<string | null>`NULL::text`.as("equipmentLoadId"),
      reviewFlagged: sql<boolean | null>`NULL::boolean`.as("reviewFlagged"),
      reviewFlagReason: sql<string | null>`NULL::text`.as("reviewFlagReason"),
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
      filters.hasReviewMark ? openReviewMarkExistsSql("fuel_load", fuelLoads.id) : undefined,
      // `como=factura` es la única que lo acepta: `buildUnified` ya descarta la rama en las demás combinaciones.
      filters.stateSlug ? invoicedStateSql(filters.stateSlug) : undefined,
      filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined,
      // Una factura no es «de» nadie: con `mias=si` no aporta filas (`buildUnified` ya descarta la rama).
      filters.registeredBy ? sql`false` : undefined,
      // Sellos y fotos sólo existen en los registros en terreno.
      filters.sealIncomplete ? sql`false` : undefined,
      filters.photosIncomplete ? sql`false` : undefined,
      filters.onlyPending ? sql`(${openReviewMarkExistsSql("fuel_load", fuelLoads.id)} or ${openCaseExistsSql("fuel_load", fuelLoads.id)})` : undefined,
    ))
}

function buildOperationBranch(session: Session, filters: FuelLogFilters, searchPattern: string | null, ids?: string[]) {
  const personal = canViewFuelPersonalData(session)
  return db
    .select({
      id: sql<string>`${fuelOperationRecords.id}`.as("id"),
      detailId: sql<string>`${fuelOperationRecords.id}`.as("detailId"), // cada fila de la planilla tiene su ficha (/combustibles/cargas/planilla/<id>)
      source: sql<FuelLogSource>`'operation_manual'`.as("source"),
      occurredAt: fuelOperationOccurredAtSql().as("occurredAt"),
      worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
      supplierId: sql<string | null>`${fuelSuppliers.id}`.as("supplierId"),
      supplierName: sql<string | null>`coalesce(${fuelSuppliers.name}, ${fuelOperationRecords.proveedorNombre})`.as("supplierName"),
      loadingPointName: sql<string | null>`NULL`.as("loadingPointName"),
      equipmentCode: sql<string | null>`${fuelOperationRecords.code}`.as("equipmentCode"),
      // plate es NOT NULL en esta tabla; nullable en las otras dos ramas.
      plate: sql<string | null>`${fuelOperationRecords.plate}`.as("plate"),
      equipmentTypeId: sql<string | null>`${fuelEquipmentTypes.id}`.as("equipmentTypeId"),
      equipmentTypeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("equipmentTypeName"),
      driverName: (personal ? sql<string | null>`${fuelOperationRecords.operador}` : sql<string | null>`NULL`).as("driverName"),
      supervisorName: (personal ? sql<string | null>`${fuelOperationRecords.supervisor}` : sql<string | null>`NULL`).as("supervisorName"),
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
      reviewMarkedBy: reviewMarkedBySql("fuel_operation_record", fuelOperationRecords.id),
      origin: sql<FuelLoadOriginSlug>`'planilla'`.as("origin"),
      worksiteId: sql<string | null>`${fuelOperationRecords.worksiteId}`.as("worksiteId"),
      vehicleId: sql<string | null>`${fuelOperationRecords.vehicleId}`.as("vehicleId"),
      equipmentLoadId: sql<string | null>`${fuelEquipmentLoads.id}`.as("equipmentLoadId"),
      reviewFlagged: sql<boolean | null>`(${fuelEquipmentLoads.reviewStatus} = 'flagged')`.as("reviewFlagged"),
      reviewFlagReason: sql<string | null>`(${fuelEquipmentLoads.flagReasons} ->> 0)`.as("reviewFlagReason"),
    })
    .from(fuelOperationRecords)
    .innerJoin(fuelOperationBatches, eq(fuelOperationRecords.batchId, fuelOperationBatches.id))
    .leftJoin(fuelEquipmentLoads, eq(fuelEquipmentLoads.operationRecordId, fuelOperationRecords.id))
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
        personal ? ilike(fuelOperationRecords.operador, searchPattern) : undefined,
        personal ? ilike(fuelOperationRecords.supervisor, searchPattern) : undefined,
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
      personal && filters.driverName ? ilike(fuelOperationRecords.operador, `%${filters.driverName}%`) : undefined,
      personal && filters.supervisorName ? ilike(fuelOperationRecords.supervisor, `%${filters.supervisorName}%`) : undefined,
      // Tampoco tiene lugar de carga ni observaciones.
      filters.loadingPointId ? sql`false` : undefined,
      filters.performanceUnit ? eq(fuelOperationRecords.tipoRendimiento, operationPerformanceUnitCode(filters.performanceUnit)) : undefined,
      filters.operationalStatus ? eq(fuelVehicles.operationalStatus, filters.operationalStatus) : undefined,
      filters.sealRemoved ? sql`false` : undefined,
      filters.sealInstalled ? sql`false` : undefined,
      filters.evidenceKind ? sql`false` : undefined,
      anomalyFilterSql("fuel_operation_record", fuelOperationRecords.id, filters),
      filters.hasReviewMark ? openReviewMarkExistsSql("fuel_operation_record", fuelOperationRecords.id) : undefined,
      // La planilla no tiene estado propio (sólo «importada»): con un estado pedido no aporta filas.
      filters.stateSlug ? sql`false` : undefined,
      filters.vehicleId ? eq(fuelOperationRecords.vehicleId, filters.vehicleId) : undefined,
      filters.registeredBy ? sql`false` : undefined,
      filters.sealIncomplete ? sql`false` : undefined,
      filters.photosIncomplete ? sql`false` : undefined,
      filters.onlyPending ? sql`(${fuelEquipmentLoads.reviewStatus} = 'flagged' or ${openReviewMarkExistsSql("fuel_operation_record", fuelOperationRecords.id)} or ${openCaseExistsSql("fuel_operation_record", fuelOperationRecords.id)})` : undefined,
    ))
}

/** `estado=` de un registro en terreno → su `status`; `false` cuando ese estado sólo existe en facturas. */
function taeStateSql(slug: keyof typeof FUEL_LOAD_STATE_SLUGS): SQL {
  const states = FUEL_LOAD_STATE_SLUGS[slug] as { tae?: string }
  return states.tae ? sql`${fuelTaeSubmissions.status} = ${states.tae}` : sql`false`
}

/** `estado=` de una factura → su `status`; `false` cuando ese estado sólo existe en registros en terreno. */
function invoicedStateSql(slug: keyof typeof FUEL_LOAD_STATE_SLUGS): SQL {
  const states = FUEL_LOAD_STATE_SLUGS[slug] as { invoiced?: string }
  return states.invoiced ? sql`${fuelLoads.status} = ${states.invoiced}` : sql`false`
}

function buildUnified(session: Session, filters: FuelLogFilters) {
  const searchPattern = searchPatternOf(filters)
  const branches = fuelLogBranchesFor(filters)

  // Ninguna rama (p. ej. `como=planilla&estado=validada`): la rama de terreno con
  // un predicado imposible, que devuelve el mismo esquema y cero filas.
  if (!branches.tae && !branches.invoiced && !branches.operation) {
    return buildTaeBranch(session, { ...filters, origins: undefined, stateSlug: undefined }, searchPattern, undefined, true)
  }
  if (branches.tae && !branches.invoiced && !branches.operation) return buildTaeBranch(session, filters, searchPattern)
  if (!branches.tae && branches.invoiced && !branches.operation) return buildInvoicedBranch(session, filters, searchPattern)
  if (!branches.tae && !branches.invoiced && branches.operation) return buildOperationBranch(session, filters, searchPattern)
  if (branches.tae && branches.invoiced && !branches.operation) {
    return unionAll(buildTaeBranch(session, filters, searchPattern), buildInvoicedBranch(session, filters, searchPattern))
  }
  if (branches.tae && !branches.invoiced && branches.operation) {
    return unionAll(buildTaeBranch(session, filters, searchPattern), buildOperationBranch(session, filters, searchPattern))
  }
  if (!branches.tae && branches.invoiced && branches.operation) {
    return unionAll(buildInvoicedBranch(session, filters, searchPattern), buildOperationBranch(session, filters, searchPattern))
  }
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

/**
 * Las cuatro cifras de la tira de Cargas: cuántos registros en terreno están por validar,
 * con observación, con el sello incompleto y con menos de 4 fotos.
 *
 * Es UNA consulta agregada (`count(*) filter`) que usa las mismas condiciones y los mismos
 * predicados que la lista (`taeConditions`, `taeStateSql`, `TAE_SEAL_INCOMPLETE_SQL`,
 * `TAE_PHOTOS_INCOMPLETE_SQL`): cada cifra es, por construcción, el número de filas que
 * muestra su filtro, no una aproximación hecha por otro camino. El alcance por faena y los
 * datos personales se resuelven aquí, igual que en la lista.
 *
 * Los cuatro filtros de atención (`estado`, `sello`, `evidencia` y «sólo con algo pendiente»)
 * se ignoran al contar: si no, al activar uno las otras tres cifras caerían a cero y la tira
 * dejaría de servir justo para pasar de una a otra. Todo lo demás (período, faena, cómo llegó,
 * búsqueda, tipo de equipo, «las que registré yo»…) se respeta.
 *
 * `null` cuando la combinación de filtros no puede traer registros en terreno (por ejemplo,
 * sólo facturas): no hay nada que contar y la tira no se pinta.
 */
export async function getFieldLoadAttention(session: Session, filters: FuelLogFilters): Promise<FieldLoadAttention | null> {
  const neutral: FuelLogFilters = { ...filters, stateSlug: undefined, sealIncomplete: undefined, photosIncomplete: undefined, onlyPending: undefined }
  if (!fuelLogBranchesFor(neutral).tae) return null

  const [row] = await db
    .select({
      toValidate: sql<number>`(count(*) filter (where ${taeStateSql("por-validar")}))::int`,
      observed: sql<number>`(count(*) filter (where ${taeStateSql("con-observacion")}))::int`,
      sealIncomplete: sql<number>`(count(*) filter (where ${TAE_SEAL_INCOMPLETE_SQL}))::int`,
      photosIncomplete: sql<number>`(count(*) filter (where ${TAE_PHOTOS_INCOMPLETE_SQL}))::int`,
    })
    .from(fuelTaeSubmissions)
    // Las tablas que `taeConditions` puede referenciar, unidas como en la rama de la lista.
    .leftJoin(fuelEquipmentLoads, eq(fuelEquipmentLoads.taeSubmissionId, fuelTaeSubmissions.id))
    .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
    .leftJoin(fuelVehicles, eq(fuelTaeSubmissions.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(and(...taeConditions(session, neutral, searchPatternOf(neutral))))

  return {
    toValidate: row?.toValidate ?? 0,
    observed: row?.observed ?? 0,
    sealIncomplete: row?.sealIncomplete ?? 0,
    photosIncomplete: row?.photosIncomplete ?? 0,
  }
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

/**
 * Los filtros de una exportación en palabras, para la hoja de metadatos: el
 * archivo lo lee una persona, y «faena: 8f3k2…» no le dice nada. Sólo trae los
 * filtros activos; los nombres salen de las tablas de origen.
 */
export async function describeFuelLogFilters(filters: FuelLogFilters): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (filters.q) out["Búsqueda"] = filters.q
  if (filters.worksiteId) {
    const row = await db.query.worksites.findFirst({ where: eq(worksites.id, filters.worksiteId), columns: { name: true } })
    out["Faena"] = row?.name ?? "(faena no encontrada)"
  }
  if (filters.origins?.length) out["Cómo llegó"] = filters.origins.map((slug) => FUEL_LOAD_ORIGIN_LABEL[slug]).join(", ")
  if (filters.stateSlug) out["Estado"] = FUEL_LOAD_STATE_LABEL[filters.stateSlug]
  if (filters.onlyPending) out["Sólo con algo pendiente"] = "Sí"
  if (filters.registeredBy) out["Registradas por"] = "Quien exporta"
  if (filters.vehicleId) {
    const row = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, filters.vehicleId), columns: { code: true, plate: true } })
    out["Equipo"] = row ? [row.code, row.plate].filter(Boolean).join(" · ") : "(equipo no encontrado)"
  }
  if (filters.supplierId) {
    const row = await db.query.fuelSuppliers.findFirst({ where: eq(fuelSuppliers.id, filters.supplierId), columns: { name: true } })
    out["Proveedor"] = row?.name ?? "(proveedor no encontrado)"
  }
  if (filters.productId) {
    const row = await db.query.fuelProducts.findFirst({ where: eq(fuelProducts.id, filters.productId), columns: { name: true } })
    out["Producto"] = row?.name ?? "(producto no encontrado)"
  }
  if (filters.equipmentTypeId) {
    const row = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, filters.equipmentTypeId), columns: { name: true } })
    out["Tipo de equipo"] = row?.name ?? "(tipo no encontrado)"
  }
  if (filters.loadingPointId) {
    const row = await db.query.fuelTaeLoadingPoints.findFirst({ where: eq(fuelTaeLoadingPoints.id, filters.loadingPointId), columns: { name: true } })
    out["Punto de carga"] = row?.name ?? "(punto no encontrado)"
  }
  if (filters.brand) out["Marca"] = filters.brand
  if (filters.model) out["Modelo"] = filters.model
  if (filters.driverName) out["Conductor"] = filters.driverName
  if (filters.supervisorName) out["Supervisor"] = filters.supervisorName
  if (filters.sealRemoved) out["Sello retirado"] = filters.sealRemoved
  if (filters.sealInstalled) out["Sello instalado"] = filters.sealInstalled
  if (filters.sealIncomplete) out["Sello incompleto"] = "Sí"
  if (filters.photosIncomplete) out["Menos de 4 fotos"] = "Sí"
  if (filters.hasNotes) out["Con observaciones"] = "Sí"
  if (filters.hasAnomaly) out["Con casos abiertos"] = "Sí"
  if (filters.hasReviewMark) out["Con pedido de revisión abierto"] = "Sí"
  return out
}
