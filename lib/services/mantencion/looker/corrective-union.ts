import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { unionAll } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantHistoricalRecords, mantRecordCorrectives, mantRecords,
  mantWorkOrders, worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import { nameKey } from "@/lib/mantencion/normalize"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "../access"
import { recordCountsOnItsOwnSql } from "../maintenance-work"
import { effectiveMeterSql } from "../unit-sql"
import { workOrderVisibility, workOrderVisibilitySql } from "../work-orders/access"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds, recordInEquipmentUnitSql } from "./resolve"
import type { CrossDimension, LookerFilters, ResolvedCrossFilters } from "./types"

/**
 * La unión de trabajos correctivos de la pestaña Correctivo: las tres fuentes del módulo en una sola relación, con
 * los filtros del tablero aplicados en SQL. Sobre ella se apoyan la tabla, la tira de cifras y los gráficos
 * (`corrective.ts`, `corrective-summary.ts`), así que ninguno puede contar distinto de otro.
 *
 * - `historial`: formularios importados antes del corte (`action_type = correctiva`).
 * - `ot`: órdenes no anuladas que ya entraron a taller (una OT sin ingreso todavía no es trabajo).
 * - `registro`: correctivas firmadas en la plataforma sin OT, desde el corte.
 *
 * Se filtra por la unidad EFECTIVA del equipo (la de su perfil de Mantención o, si no, la de su tipo): el
 * correctivo de máquinas no se duplica con el de camiones. Un registro nativo de otra unidad conserva el trabajo,
 * pero su lectura no sale en la unidad activa. El alcance por faena y la visibilidad de OT/registros se aplican en
 * cada rama; los filtros de la barra se aplican además sobre la unión.
 */

const HISTORICAL_DATE = sql<string>`CASE WHEN ${mantHistoricalRecords.entryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${mantHistoricalRecords.entryDate}, 10) ELSE left(${mantHistoricalRecords.submittedAt}, 10) END`
const OT_DATE = sql<string>`to_char(${mantWorkOrders.workshopEntryAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')`
const DRIVER_FIELD = sql<string | null>`(select f->>'value' from jsonb_array_elements(${mantHistoricalRecords.fields}) f where upper(f->>'header') like '%CONDUCTOR%' limit 1)`

export type UnionRow = {
  id: string
  source: string
  date: string
  vehicleId: string | null
  recordId: string | null
  code: string
  plate: string
  typeName: string | null
  unit: string | null
  reading: number | string | null
  readingText: string | null
  reference: string
  workPerformed: string
  worksiteId: string | null
  worksiteName: string | null
  hours: number | string | null
  photoId: string | null
  photoUrl: string | null
  driverText: string | null
}

function buildBranches(viewer: MantViewer, filters: LookerFilters, query: ReturnType<typeof queryFilters>) {
  const scope = effectiveWorksiteIds(viewer, query.worksiteIds)
  const vehicleIds = query.equipmentIds
  const unit = query.unit
  const meterType = unit === "km" ? "odometer" : unit === "h" ? "hour_meter" : null

  const historical = db.select({
    id: sql<string>`('h:' || ${mantHistoricalRecords.sourceKey})`.as("id"),
    source: sql<string>`'historial'`.as("source"),
    date: HISTORICAL_DATE.as("date"),
    vehicleId: sql<string | null>`${mantHistoricalRecords.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`NULL::text`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, ${mantHistoricalRecords.equipmentText}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: effectiveMeterSql.as("unit"),
    reading: sql<number | null>`NULL::numeric`.as("reading"),
    readingText: sql<string | null>`nullif(btrim(${mantHistoricalRecords.readingText}), '')`.as("readingText"),
    reference: sql<string>`coalesce(${mantHistoricalRecords.orderText}, '')`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantHistoricalRecords.description}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantHistoricalRecords.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    hours: sql<number | null>`${mantHistoricalRecords.laborHours}`.as("hours"),
    photoId: sql<string | null>`NULL::text`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: DRIVER_FIELD.as("driverText"),
  })
    .from(mantHistoricalRecords)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalRecords.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId))
    .where(and(
      eq(mantHistoricalRecords.isTest, false),
      eq(mantHistoricalRecords.actionType, "correctiva"),
      sql`${HISTORICAL_DATE} >= ${filters.from} AND ${HISTORICAL_DATE} <= ${filters.to}`,
      sql`${HISTORICAL_DATE} < ${FORMS_CUTOVER_DATE}`,
      worksiteScopeSqlFor(scope, mantHistoricalRecords.worksiteId),
      vehicleIds.length ? inArray(mantHistoricalRecords.vehicleId, vehicleIds) : undefined,
      meterType ? eq(effectiveMeterSql, meterType) : undefined,
    ))

  const orders = db.select({
    id: sql<string>`('ot:' || ${mantWorkOrders.id})`.as("id"),
    source: sql<string>`'ot'`.as("source"),
    date: OT_DATE.as("date"),
    vehicleId: sql<string | null>`${mantWorkOrders.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`(select r.id from mant_records r where r.work_order_id = ${mantWorkOrders.id} and r.status = 'vigente' order by r.work_date desc limit 1)`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: effectiveMeterSql.as("unit"),
    reading: sql<number | null>`case when ${effectiveMeterSql} = 'odometer' then ${mantWorkOrders.entryOdometer} else ${mantWorkOrders.entryHourmeter} end`.as("reading"),
    readingText: sql<string | null>`NULL::text`.as("readingText"),
    reference: sql<string>`${mantWorkOrders.folio}`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantWorkOrders.workPerformed}, ${mantWorkOrders.repairDescription}, ${mantWorkOrders.observations}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantWorkOrders.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    // La OT no siempre trae horas propias: si el registro correctivo enlazado las trae, se usan.
    hours: sql<number | null>`coalesce(${mantWorkOrders.laborHours}, (select c.hours from mant_record_correctives c join mant_records r on r.id = c.record_id where r.work_order_id = ${mantWorkOrders.id} and r.status = 'vigente' order by r.work_date desc limit 1))`.as("hours"),
    photoId: sql<string | null>`(select p.id from mant_record_photos p join mant_records r on r.id = p.record_id where r.work_order_id = ${mantWorkOrders.id} and p.kind = 'correctiva' order by p.sort_order limit 1)`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: sql<string | null>`(select string_agg(d.driver_name, ', ') from mant_record_drivers d join mant_records r on r.id = d.record_id where r.work_order_id = ${mantWorkOrders.id})`.as("driverText"),
  })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .where(and(
      ne(mantWorkOrders.status, "anulada"),
      isNotNull(mantWorkOrders.workshopEntryAt),
      or(eq(mantWorkOrders.actionType, "correctiva"), and(isNull(mantWorkOrders.actionType), eq(mantWorkOrders.repair, true))),
      sql`${OT_DATE} >= ${filters.from} AND ${OT_DATE} <= ${filters.to}`,
      workOrderVisibilitySql(workOrderVisibility(viewer)),
      worksiteScopeSqlFor(scope, mantWorkOrders.worksiteId),
      vehicleIds.length ? inArray(mantWorkOrders.vehicleId, vehicleIds) : undefined,
      meterType ? eq(effectiveMeterSql, meterType) : undefined,
    ))

  const records = db.select({
    id: sql<string>`('r:' || ${mantRecords.id})`.as("id"),
    source: sql<string>`'registro'`.as("source"),
    date: sql<string>`${mantRecords.workDate}`.as("date"),
    vehicleId: sql<string | null>`${mantRecords.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`${mantRecords.id}`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: effectiveMeterSql.as("unit"),
    // El trabajo cuenta aunque el registro sea de la unidad anterior; su lectura sólo sale si va en la activa.
    reading: sql<number | null>`case when ${recordInEquipmentUnitSql} then ${mantRecords.reading} end`.as("reading"),
    readingText: sql<string | null>`NULL::text`.as("readingText"),
    reference: sql<string>`coalesce(${mantRecords.folio}, '')`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantRecordCorrectives.description}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantRecords.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    hours: sql<number | null>`${mantRecordCorrectives.hours}`.as("hours"),
    photoId: sql<string | null>`(select p.id from mant_record_photos p where p.record_id = ${mantRecords.id} and p.kind = 'correctiva' order by p.sort_order limit 1)`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: sql<string | null>`(select string_agg(d.driver_name, ', ') from mant_record_drivers d where d.record_id = ${mantRecords.id})`.as("driverText"),
  })
    .from(mantRecords)
    .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .where(and(
      eq(mantRecords.kind, "C"),
      eq(mantRecords.status, "vigente"),
      // Sin una OT que cuente (sin OT, o con la OT anulada o sin ingreso a taller): la misma regla que el Historial (REG4-1).
      recordCountsOnItsOwnSql(),
      gte(mantRecords.workDate, FORMS_CUTOVER_DATE),
      gte(mantRecords.workDate, filters.from),
      lte(mantRecords.workDate, filters.to),
      recordVisibilitySql(recordVisibility(viewer)),
      worksiteScopeSqlFor(scope, mantRecords.worksiteId),
      vehicleIds.length ? inArray(mantRecords.vehicleId, vehicleIds) : undefined,
      meterType ? eq(effectiveMeterSql, meterType) : undefined,
    ))

  return { historical, orders, records, scope, meterType }
}

/** Los nombres de conductor de un texto libre («JUAN PÉREZ, PEDRO SOTO»): sin vacíos, sin «no aplica» y sin repetidos. */
export function parseDrivers(driverText: string | null): string[] {
  if (!driverText) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of driverText.split(/[,;/]/)) {
    const name = part.trim()
    if (name.length < 3) continue
    const key = nameKey(name)
    if (["NOAPLICA", "SINCONDUCTOR", "NOSEINFORMA", "NA"].includes(key.toUpperCase())) continue
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

type Query = ReturnType<typeof queryFilters>

/** Une las tres ramas y aplica los filtros que son iguales en todas. */
function buildUnion(viewer: MantViewer, filters: LookerFilters, query: Query) {
  const { historical, orders, records, scope, meterType } = buildBranches(viewer, filters, query)
  const union = unionAll(historical, orders, records).as("corrective_work")
  const conditions = [
    scope === "all" ? undefined : inArray(union.worksiteId, scope as string[]),
    query.equipmentIds.length ? inArray(union.vehicleId, query.equipmentIds) : undefined,
    meterType ? eq(union.unit, meterType) : undefined,
    query.workId ? eq(union.id, query.workId) : undefined,
    // Mes de la fecha del trabajo (`YYYY-MM-DD`): lo emite el gráfico de trabajos por mes.
    query.month ? sql`left(${union.date}, 7) = ${query.month}` : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined)
  return { union, where: and(...conditions), empty: scope !== "all" && scope.length === 0 }
}

/**
 * Ids de los trabajos donde aparece un conductor. El nombre sale de texto libre (el histórico) o de una tabla de
 * conductores (lo nativo) y se compara por `nameKey`, así que no se filtra en SQL: se leen los ids con su texto
 * bajo el alcance base (período, unidad, faena y equipo manuales) y los demás filtros se aplican después, sobre la
 * unión, junto a esta lista.
 */
async function conductorWorkIds(viewer: MantViewer, filters: LookerFilters, key: string): Promise<string[]> {
  const { union, where, empty } = buildUnion(viewer, filters, queryFilters(filters, {}, []))
  if (empty) return []
  const rows = await db.select({ id: union.id, driverText: union.driverText }).from(union)
    .where(and(where, isNotNull(union.driverText)))
  return rows
    .filter((row) => parseDrivers(row.driverText).some((name) => nameKey(name) === key))
    .map((row) => row.id)
}

/**
 * La unión con los filtros de la pestaña. `ignore` son las dimensiones que el bloque que consulta emite (no se
 * filtra a sí mismo). El conductor elegido acota por sus trabajos. `null` = no hay nada que consultar (sin faenas
 * en el alcance o sin trabajos del conductor): quien llama devuelve el resultado vacío sin tocar la base.
 */
export async function correctiveScope(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
) {
  const query = queryFilters(filters, cross, ignore)
  const { union, where, empty } = buildUnion(viewer, filters, query)
  if (empty) return null
  if (!query.conductorKey) return { union, where }
  const ids = await conductorWorkIds(viewer, filters, query.conductorKey)
  if (ids.length === 0) return null
  return { union, where: and(where, inArray(union.id, ids)) }
}
