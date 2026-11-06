import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelAnomalyCases,
  fuelAnomalyRules,
  fuelMeterReadings,
  fuelOperationRecords,
  fuelVehicleOperationalIntervals,
  fuelProviderTransactions,
  fuelVehicles,
  mantWorkOrders,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, visibleWorksiteIds, worksiteScopeSql } from "@/lib/auth/scope"
import { can } from "@/lib/auth/can"
import { accountableProviderTransactionsWhere, providerLoadCountSql } from "@/lib/combustibles/load-status"
import { OPEN_ANOMALY_CASE_STATUSES } from "@/lib/combustibles/anomaly-labels"
import { acceptedMeterResetSql } from "@/lib/combustibles/meter-reset-sql"
import { getFuelProviderCoverageGaps } from "@/lib/combustibles/coverage-notice-data"
import { maxMeterRatePerDayOf, meterSeriesAdvance, type MeterSeriesPoint } from "@/lib/combustibles/meter-series"
import { fuelOperationOccurredAtSql } from "@/lib/combustibles/fuel-log"
import { expiringDocuments, fleetDocumentMetadataSchema, resolveNextExpiryDate } from "@/lib/validation/fleet-documents"
import { filterFleetOverviewRows, type FleetOverviewFilters } from "@/lib/fleet-overview-filters"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import { addMonths, todayInChile } from "@/lib/utils"
import {
  getVehicleWorkOrderMetrics,
  listRecentVehicleWorkOrders,
  workOrderMetricsScope,
} from "@/lib/services/mantencion/work-orders/metrics"

/**
 * Equipos de una faena, para poblar selectores.
 *
 * Recibe una faena **ya autorizada**: el alcance de rol lo resuelve el
 * llamador, porque los dos consumidores hablan monedas distintas —las
 * pantallas de flota traen `Session` y `worksiteScopeSql`, el motor de
 * inspecciones trae `InspectionAccess` y ya llamó a `requireAccess` con esta
 * misma faena antes de llegar aquí. Bridgear ambas cuesta más código que la
 * consulta misma.
 *
 * Existía inlineada en ~8 sitios (`app/(app)/combustibles/…`, Inspecciones y
 * ejecución del PDTP); acá queda extraída para los nuevos consumidores.
 */
export async function listWorksiteVehicles(args: { worksiteId: string; activeOnly?: boolean }) {
  const conditions = [eq(fuelVehicles.worksiteId, args.worksiteId)]
  if (args.activeOnly !== false) conditions.push(eq(fuelVehicles.isActive, true))
  return db.select({
    id: fuelVehicles.id,
    plate: fuelVehicles.plate,
    code: fuelVehicles.code,
    type: fuelVehicles.type,
    meterType: fuelVehicles.meterType,
    operationalStatus: fuelVehicles.operationalStatus,
  })
    .from(fuelVehicles)
    .where(and(...conditions))
    .orderBy(fuelVehicles.plate)
}

/**
 * Cambia el estado operacional de un equipo manteniendo coherente su historial
 * de intervalos: cierra el abierto y abre el nuevo.
 *
 * Extraída porque estaba inlineada tres veces en
 * `app/(app)/combustibles/actions-module/vehicles.ts` (alta, edición y baja), y
 * el índice único parcial `fuel_vehicle_operational_intervals` garantiza **un
 * solo intervalo abierto por vehículo**: olvidar el cierre en una cuarta copia
 * revienta con violación de unicidad, no con un dato raro.
 *
 * No valida permisos: la puerta la pone cada llamador.
 */
export { setVehicleOperationalStatus } from "@/lib/services/fleet-operational-status"

/** Etiqueta estable de un equipo para congelar como evidencia: "KA-122 · ABCD-12". */
export function vehicleLabel(vehicle: { plate: string; code: string | null }) {
  return vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate
}

// `worksiteId` es la faena elegida en el tablero: se intersecta con el alcance
// del rol (nunca lo reemplaza). Los llamadores sin selector de faena (/flota)
// lo omiten y conservan el alcance del rol tal cual.
/** Ventana del costo por km/hora en `getFleetOverview` — exportada para que
 *  la UI (fleet-section.tsx) rotule la ventana sin repetir el número a mano
 *  y arriesgar que diverja del servicio (CO-038). */
export const FLEET_OVERVIEW_LOOKBACK_MONTHS = 12

export interface FleetOverviewOptions {
  /**
   * Suma las OT abiertas de cada equipo (`openWorkOrders`, `inWorkshopNow`).
   * Opt-in: el tablero sólo cuenta vehículos y no debe pagar esta consulta. Sin
   * `mant:ot:view_*` la consulta no corre y los campos quedan en `null`.
   */
  workOrders?: boolean
}

/**
 * Primer día (`YYYY-MM-DD`, civil chileno) de la ventana de `FLEET_OVERVIEW_LOOKBACK_MONTHS`.
 * Una sola definición para los litros y costos, las lecturas de medidor y el aviso de meses
 * sin datos: si cada uno la calculara por su lado, el aviso describiría otra ventana que la
 * de las cifras que advierte. `addMonths` recorta al último día del mes (29-feb no salta a marzo).
 */
function fleetOverviewSince(): string {
  return addMonths(todayInChile(), -FLEET_OVERVIEW_LOOKBACK_MONTHS)
}

export async function getFleetOverview(
  session: Session,
  worksiteId?: string,
  vehicleIds?: readonly string[],
  options: FleetOverviewOptions = {},
) {
  if (vehicleIds?.length === 0) return []
  const workOrderScope = options.workOrders ? workOrderMetricsScope(session) : null
  const canViewFuel = can(session, "combustibles:view")
  const canViewCosts = can(session, "flota:view") && can(session, "combustibles:view_costs")
  const vehicleScope = and(
    worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId),
    vehicleIds ? inArray(fuelVehicles.id, [...vehicleIds]) : undefined,
  )

  const since = fleetOverviewSince()

  // Litros, costo y cargas por vehículo salen del libro del proveedor (Copec) con la regla
  // canónica compartida con Analítica y la conciliación (C-9): `fuel_loads` —la serie
  // facturada— tiene 0 filas en producción. El alcance es el de siempre, sobre la faena de la
  // transacción.
  const providerWhere = and(
    accountableProviderTransactionsWhere(),
    sql`left(${fuelProviderTransactions.occurredAt}, 10) >= ${since}`,
    worksiteScopeSql(session, fuelProviderTransactions.worksiteId, worksiteId),
    vehicleIds ? inArray(fuelProviderTransactions.vehicleId, [...vehicleIds]) : undefined,
  )

  // Un reset de medidor ACEPTADO parte la serie en esa lectura (CO-023, ítem 7); la marca la comparte
  // con el rendimiento por mes de Consumo (`acceptedMeterResetSql`).
  const acceptedResetSql = acceptedMeterResetSql()

  const [vehicles, fuelRows, meterRows, objectionRows, jumpRules, documentExpiryRows, workOrderMetrics] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
      orderBy: [fuelVehicles.plate],
    }),
    canViewFuel ? db
      .select({
        vehicleId: fuelProviderTransactions.vehicleId,
        totalFuelAmount: canViewCosts ? sql<number>`COALESCE(SUM(${fuelProviderTransactions.amount}), 0)` : sql<null>`null`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelProviderTransactions.quantity}), 0)`,
        // Un agregado mensual TCT vale las cargas de su `detalle`, no una.
        loadCount: sql<number>`COALESCE(SUM(${providerLoadCountSql()}), 0)`,
      })
      .from(fuelProviderTransactions)
      .where(and(providerWhere, isNotNull(fuelProviderTransactions.vehicleId)))
      .groupBy(fuelProviderTransactions.vehicleId) : Promise.resolve([]),
    // Lecturas de medidor de la ventana, de la fuente canónica: el detalle por transacción de
    // Copec en `fuel_meter_readings`, la misma que lee Analítica. `fuel_loads` tiene 0 filas en
    // producción, así que la columna «Km/Hr» no existía y el recorrido valía `null` para todo
    // equipo. Una serie por equipo y tipo de medidor, en orden cronológico: la primera y la
    // última lectura ya no bastan —un retroceso sin reset las vuelve inservibles—, así que el
    // recorrido se calcula con `meterSeriesAdvance`. El alcance es el del equipo (la lectura no
    // lleva faena propia): la tabla ya lista sólo los equipos de la faena visible.
    canViewFuel ? db
      .select({
        id: fuelMeterReadings.id,
        vehicleId: fuelMeterReadings.vehicleId,
        meterType: fuelMeterReadings.meterType,
        occurredAt: fuelMeterReadings.occurredAt,
        value: fuelMeterReadings.value,
        acceptedReset: acceptedResetSql,
      })
      .from(fuelMeterReadings)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelMeterReadings.vehicleId))
      .where(and(
        eq(fuelMeterReadings.source, "copec_tct"),
        sql`left(${fuelMeterReadings.occurredAt}, 10) >= ${since}`,
        vehicleScope,
      ))
      .orderBy(fuelMeterReadings.vehicleId, fuelMeterReadings.meterType, fuelMeterReadings.occurredAt, fuelMeterReadings.id) : Promise.resolve([]),
    // Casos del detector que siguen ABIERTOS (`open`, `in_review`, `reopened`: los mismos que lista «Por
    // revisar») sobre lecturas de esa misma ventana. Un caso cerrado, sea resuelto o descartado y con la
    // resolución que sea, ya no pide a nadie que mire la lectura y no entra. Mismo alcance que la lectura
    // (el equipo) y, además, el del propio caso —con la faena del tablero, como las transacciones del
    // proveedor de arriba—: es el que aplica la bandeja al abrirlo, y un enlace que ésta rechazaría sería
    // peor que no avisar. Orden fijo —el más antiguo primero— para que una lectura con dos
    // casos abiertos (regresiva y salto) muestre siempre el mismo.
    canViewFuel ? db
      .select({
        readingId: fuelAnomalyCases.referenceEntityId,
        caseId: fuelAnomalyCases.id,
        ruleLabel: fuelAnomalyRules.name,
      })
      .from(fuelAnomalyCases)
      .innerJoin(fuelAnomalyRules, eq(fuelAnomalyRules.id, fuelAnomalyCases.ruleId))
      .innerJoin(fuelMeterReadings, eq(fuelMeterReadings.id, fuelAnomalyCases.referenceEntityId))
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelMeterReadings.vehicleId))
      .where(and(
        eq(fuelAnomalyCases.referenceEntityType, "fuel_meter_reading"),
        inArray(fuelAnomalyCases.status, [...OPEN_ANOMALY_CASE_STATUSES]),
        eq(fuelMeterReadings.source, "copec_tct"),
        sql`left(${fuelMeterReadings.occurredAt}, 10) >= ${since}`,
        vehicleScope,
        worksiteScopeSql(session, fuelAnomalyCases.worksiteId, worksiteId),
      ))
      .orderBy(fuelAnomalyCases.detectedAt, fuelAnomalyCases.id) : Promise.resolve([]),
    // Cota de avance diario de la regla `salto_medidor_implausible` (con su override por tipo de
    // equipo): el recorrido no suma lo que esa regla marca como imposible.
    canViewFuel ? db
      .select({ config: fuelAnomalyRules.config })
      .from(fuelAnomalyRules)
      .where(eq(fuelAnomalyRules.code, "salto_medidor_implausible"))
      .limit(1) : Promise.resolve([]),
    // El detalle del vehículo incluye los documentos subidos en su "próximo
    // vencimiento" (ver `getFleetVehicleDetail`); el listado los ignoraba, así
    // que un seguro cargado como documento no aparecía ni en la columna ni en
    // el banner de vencidos de /flota.
    db
      .select({
        vehicleId: fleetVehicleDocuments.vehicleId,
        documentType: fleetVehicleDocuments.documentType,
        expiresAt: fleetVehicleDocuments.expiresAt,
      })
      .from(fleetVehicleDocuments)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetVehicleDocuments.vehicleId))
      .where(and(
        isNotNull(fleetVehicleDocuments.expiresAt),
        // Sólo la versión vigente de cada tipo: el MIN anterior tomaba también
        // las reemplazadas, así que subir la póliza nueva no sacaba al equipo
        // del atraso — seguía midiéndose contra la del año pasado.
        eq(fleetVehicleDocuments.status, "current"),
        vehicleScope,
      )),
    // OT abiertas por equipo, con el alcance de OT de la sesión (no el de flota:
    // son capacidades distintas). Se acota a los equipos pedidos para no contar
    // OT de equipos que la página ni lista.
    workOrderScope
      ? getVehicleWorkOrderMetrics(workOrderScope, { worksiteId, vehicleIds })
      : Promise.resolve(null),
  ])

  const fuelByVehicle = new Map(fuelRows.map((row) => [row.vehicleId, row]))
  // Series de lecturas por equipo y tipo de medidor (la consulta ya las trae ordenadas).
  const meterSeriesByVehicle = new Map<string, { odometer: MeterSeriesPoint[]; hour_meter: MeterSeriesPoint[] }>()
  // Id de la última lectura de cada serie (la consulta ya las trae en orden): es la que Flota muestra y
  // sobre la que se busca un caso abierto.
  const lastReadingIdBySeries = new Map<string, string>()
  for (const row of meterRows) {
    if (!row.vehicleId) continue
    const series = meterSeriesByVehicle.get(row.vehicleId) ?? { odometer: [], hour_meter: [] }
    const target = row.meterType === "hour_meter" ? series.hour_meter : series.odometer
    target.push({ value: Number(row.value), occurredAt: row.occurredAt, acceptedReset: row.acceptedReset })
    meterSeriesByVehicle.set(row.vehicleId, series)
    lastReadingIdBySeries.set(`${row.vehicleId}:${row.meterType === "hour_meter" ? "hour_meter" : "odometer"}`, row.id)
  }
  // Primer caso abierto de cada lectura (la consulta viene ordenada: gana el más antiguo).
  const openObjectionByReading = new Map<string, { caseId: string; ruleLabel: string }>()
  for (const row of objectionRows) {
    if (row.readingId && !openObjectionByReading.has(row.readingId)) {
      openObjectionByReading.set(row.readingId, { caseId: row.caseId, ruleLabel: row.ruleLabel })
    }
  }
  const jumpRule = { config: jumpRules[0]?.config ?? null }

  const currentDocumentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const row of documentExpiryRows) {
    currentDocumentsByVehicle.set(row.vehicleId, [
      ...(currentDocumentsByVehicle.get(row.vehicleId) ?? []),
      { documentType: row.documentType, expiresAt: row.expiresAt },
    ])
  }

  return vehicles.map((vehicle) => {
    const fuel = fuelByVehicle.get(vehicle.id)
    const totalFuelAmount = canViewFuel && canViewCosts ? Number(fuel?.totalFuelAmount ?? 0) : null
    const series = meterSeriesByVehicle.get(vehicle.id)
    const lastOdometerPoint = series?.odometer.at(-1)
    const lastHourMeterPoint = series?.hour_meter.at(-1)
    const lastOdometer = lastOdometerPoint?.value ?? null
    const lastHourMeter = lastHourMeterPoint?.value ?? null
    // La marca va sobre la lectura que la columna «Km/Hr» muestra (odómetro y, a falta de éste, horómetro:
    // `app/(app)/flota/fleet-table.tsx`), no sobre la otra serie del equipo, que nadie ve en esa fila.
    const shownReadingId = lastOdometer != null
      ? lastReadingIdBySeries.get(`${vehicle.id}:odometer`)
      : lastHourMeter != null ? lastReadingIdBySeries.get(`${vehicle.id}:hour_meter`) : undefined
    const shownReadingAt = lastOdometer != null
      ? lastOdometerPoint?.occurredAt
      : lastHourMeter != null ? lastHourMeterPoint?.occurredAt : undefined
    // El recorrido se informa en la unidad de rendimiento del equipo (km/L → km; L/h → horas) y
    // sólo con pares que el detector de anomalías no objetaría: un retroceso sin reset aceptado
    // no se suma, así que nunca sale negativo ni absurdo. `meterSeriesIncomplete` avisa que hubo
    // pares descartados y la cifra es una cota inferior.
    const km = vehicle.performanceUnit === "km_per_liter"
      ? meterSeriesAdvance(series?.odometer ?? [], maxMeterRatePerDayOf(jumpRule, "km", vehicle.equipmentType?.slug))
      : null
    const hours = vehicle.performanceUnit === "liters_per_hour"
      ? meterSeriesAdvance(series?.hour_meter ?? [], maxMeterRatePerDayOf(jumpRule, "hora", vehicle.equipmentType?.slug))
      : null
    const declaredExpiries = {
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }
    const currentDocuments = currentDocumentsByVehicle.get(vehicle.id) ?? []
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      /** Código interno: los equipos de carro y batea no lo tienen, y entonces los identifica la patente. */
      code: vehicle.code,
      type: vehicle.equipmentType?.name ?? vehicle.type,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      isActive: vehicle.isActive,
      operationalStatus: vehicle.operationalStatus,
      worksiteName: vehicle.worksite?.name ?? "Sin faena",
      responsibleName: vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? null,
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insurancePolicyNumber: vehicle.insurancePolicyNumber,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
      nextExpiryDate: resolveNextExpiryDate(declaredExpiries, currentDocuments),
      /**
       * Tipo documental al que pertenece `nextExpiryDate` («Revisión técnica»), con la misma
       * precedencia que ella: la lista dice «Rev. técnica · vence en 9 días», no solo la fecha.
       * `null` si el equipo no tiene ninguna fecha.
       */
      nextExpiryDocumentType: expiringDocuments(declaredExpiries, currentDocuments)[0]?.documentType ?? null,
      totalFuelAmount,
      totalLiters: canViewFuel ? Number(fuel?.totalLiters ?? 0) : null,
      loadCount: canViewFuel ? Number(fuel?.loadCount ?? 0) : null,
      lastOdometerReading: canViewFuel ? lastOdometer : null,
      lastHourMeterReading: canViewFuel ? lastHourMeter : null,
      /**
       * Instante (ISO) de la lectura que la columna «Km/Hr» muestra: la del odómetro y, a falta de éste,
       * la del horómetro —la misma sobre la que va `lastReadingObjection`—. `null` sin lectura o sin
       * `combustibles:view`. La exportación a Excel lo lleva como «fecha de la última lectura».
       */
      lastReadingAt: canViewFuel ? (shownReadingAt ?? null) : null,
      /** Caso del detector aún abierto sobre la lectura que se muestra; `null` si no hay (o sin `combustibles:view`). */
      lastReadingObjection: canViewFuel && shownReadingId ? (openObjectionByReading.get(shownReadingId) ?? null) : null,
      kmDriven: km?.advance ?? null,
      hoursRun: hours?.advance ?? null,
      meterSeriesIncomplete: canViewFuel ? (km?.discardedPairs ?? 0) + (hours?.discardedPairs ?? 0) > 0 : null,
      openWorkOrders: workOrderMetrics ? (workOrderMetrics.get(vehicle.id)?.openCount ?? 0) : null,
      inWorkshopNow: workOrderMetrics ? (workOrderMetrics.get(vehicle.id)?.inWorkshopNow ?? false) : null,
    }
  })
}

export async function getFleetOverviewPage(
  session: Session,
  filters: FleetOverviewFilters,
  dates: { today: string; warningWindowEnd: string },
  pagination: { offset: number; limit: number },
  worksiteId?: string,
) {
  const canViewFuel = can(session, "combustibles:view")
  const canViewCosts = can(session, "flota:view") && can(session, "combustibles:view_costs")
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId)
  const [vehicles, documentExpiryRows] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true, responsibleUser: true, equipmentType: true },
      orderBy: [fuelVehicles.plate],
    }),
    db.select({
      vehicleId: fleetVehicleDocuments.vehicleId,
      documentType: fleetVehicleDocuments.documentType,
      expiresAt: fleetVehicleDocuments.expiresAt,
    }).from(fleetVehicleDocuments)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetVehicleDocuments.vehicleId))
      .where(and(
        isNotNull(fleetVehicleDocuments.expiresAt),
        eq(fleetVehicleDocuments.status, "current"),
        vehicleScope,
      )),
  ])
  const currentDocumentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const row of documentExpiryRows) {
    currentDocumentsByVehicle.set(row.vehicleId, [
      ...(currentDocumentsByVehicle.get(row.vehicleId) ?? []),
      { documentType: row.documentType, expiresAt: row.expiresAt },
    ])
  }
  const index = vehicles.map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    code: vehicle.code,
    brand: vehicle.brand,
    model: vehicle.model,
    type: vehicle.equipmentType?.name ?? vehicle.type,
    worksiteName: vehicle.worksite?.name ?? "Sin faena",
    operationalStatus: vehicle.operationalStatus,
    responsibleName: vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? null,
    isActive: vehicle.isActive,
    nextExpiryDate: resolveNextExpiryDate({
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }, currentDocumentsByVehicle.get(vehicle.id) ?? []),
  }))
  const matching = filterFleetOverviewRows(index, filters, dates)
  const limit = Math.max(1, pagination.limit)
  const offset = Math.max(0, pagination.offset)
  const matchingIds = matching.map((vehicle) => vehicle.id)
  const pageIds = matching.slice(offset, offset + limit).map((vehicle) => vehicle.id)
  const since = fleetOverviewSince()
  const [rows, fuelSummaryRows, providerGapMonths] = await Promise.all([
    getFleetOverview(session, worksiteId, pageIds, { workOrders: true }),
    // Mismo origen y misma regla que el detalle por vehículo de arriba (libro del proveedor, C-9).
    canViewFuel && matchingIds.length > 0 ? db.select({
      totalAmount: canViewCosts ? sql<number>`COALESCE(SUM(${fuelProviderTransactions.amount}), 0)` : sql<null>`null`,
      totalLiters: sql<number>`COALESCE(SUM(${fuelProviderTransactions.quantity}), 0)`,
    }).from(fuelProviderTransactions).where(and(
      accountableProviderTransactionsWhere(),
      sql`left(${fuelProviderTransactions.occurredAt}, 10) >= ${since}`,
      worksiteScopeSql(session, fuelProviderTransactions.worksiteId, worksiteId),
      inArray(fuelProviderTransactions.vehicleId, matchingIds),
    )) : Promise.resolve([]),
    getFleetProviderGapMonths(session, worksiteId),
  ])
  const fuelSummary = fuelSummaryRows[0]
  const totalFuelAmount = canViewFuel && canViewCosts ? Number(fuelSummary?.totalAmount ?? 0) : null
  return {
    rows,
    total: matching.length,
    limit,
    offset,
    index,
    matching,
    summary: {
      active: matching.filter((vehicle) => vehicle.isActive).length,
      totalFuelAmount,
      totalLiters: canViewFuel ? Number(fuelSummary?.totalLiters ?? 0) : null,
      /** Meses (`YYYY-MM`) de la ventana de 12 meses sin datos del proveedor: los totales de arriba no los incluyen. */
      providerGapMonths,
    },
  }
}

/**
 * Meses (`YYYY-MM`, en orden) de la ventana de 12 meses de Flota sobre los que el libro del
 * proveedor no puede decir «no se cargó combustible» (C-4): sin transacciones aceptadas ni una
 * cobertura que los cierre. Es la misma vara con que Analítica y el tablero dibujan un hueco
 * (`monthsWithoutProviderData`), aplicada a la ventana de las cifras de Flota; así «Costo
 * combustible (12 meses)», los litros y las columnas por equipo se leen con su salvedad.
 *
 * Los meses con filas son los del alcance de faena de la sesión, no los de los equipos
 * filtrados: la brecha es del proveedor, no de un equipo. Sin `combustibles:view` no hay
 * totales que advertir y devuelve `[]`.
 */
export async function getFleetProviderGapMonths(session: Session, worksiteId?: string): Promise<string[]> {
  if (!can(session, "combustibles:view")) return []
  const since = fleetOverviewSince()
  const lastMonth = todayInChile().slice(0, 7)
  const months: string[] = []
  for (let month = since.slice(0, 7); month <= lastMonth; month = addMonths(`${month}-01`, 1).slice(0, 7)) months.push(month)
  // La consulta y la vara viven en `getFuelProviderCoverageGaps`, la misma que usan los avisos de cobertura de
  // los gráficos de combustible: Flota no puede discrepar de ellos. `fromDate` conserva el día de corte de la ventana.
  const { gapMonths } = await getFuelProviderCoverageGaps(session, months, { worksiteId, fromDate: since })
  return gapMonths
}

/** Ventana (días) del antes/después del rendimiento alrededor de la salida de taller. */
export const WORK_ORDER_IMPACT_WINDOW_DAYS = 30

export async function getFleetVehicleDetail(session: Session, id: string) {
  const canViewFuel = can(session, "combustibles:view")
  const workOrderScope = workOrderMetricsScope(session)
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, id),
    with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
  })
  if (!vehicle) return null
  if (scopedWorksites !== null && !scopedWorksites.includes(vehicle.worksiteId)) {
    return null
  }

  const [documents, recentOperations, operatorCounts, operationalIntervals, recentWorkOrders] = await Promise.all([
    db.query.fleetVehicleDocuments.findMany({
      // FLO-003: la ficha muestra el historial de versiones, no las anuladas.
      // Una anulación es un error corregido, no una versión del documento.
      where: and(
        eq(fleetVehicleDocuments.vehicleId, id),
        ne(fleetVehicleDocuments.status, "voided"),
      ),
      // Vigentes primero y, dentro de cada grupo, por vencimiento: el historial
      // se conserva visible pero no se confunde con lo que rige hoy.
      // `status` es texto, así que el orden alfabético pone `current` antes que
      // `replaced`; con `desc` los reemplazados encabezaban la lista, al revés
      // de lo que este comentario promete.
      orderBy: [asc(fleetVehicleDocuments.status), fleetVehicleDocuments.expiresAt],
    }),
    // Log operacional de combustible: fecha real por carga (a diferencia de
    // fuelLoads, que solo trae odómetro/horómetro cuando se digitó a mano).
    // Orden por instante real (fecha+hora), no sólo `fecha`: dos cargas del
    // mismo día devolvían un ganador arbitrario como "última lectura" (CO-023).
    // Sólo filas con medidor: el log admite cargas sin lectura digitada y, sin
    // este filtro, la más reciente sin horómetro dejaba la ficha en "—"
    // ocultando lecturas anteriores que sí existen.
    canViewFuel ? db.query.fuelOperationRecords.findMany({
      where: and(eq(fuelOperationRecords.vehicleId, id), isNotNull(fuelOperationRecords.horometro)),
      columns: {
        id: true,
        fecha: true,
        horometro: true,
        medidoPor: true,
        operador: true,
      },
      orderBy: [desc(fuelOperationOccurredAtSql()), desc(fuelOperationRecords.createdAt)],
      limit: 20,
    }) : Promise.resolve([]),
    canViewFuel ? db
      .select({ operador: fuelOperationRecords.operador, count: sql<number>`COUNT(*)` })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.vehicleId, id), isNotNull(fuelOperationRecords.operador)))
      .groupBy(fuelOperationRecords.operador)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(5) : Promise.resolve([]),
    db.query.fuelVehicleOperationalIntervals.findMany({
      where: eq(fuelVehicleOperationalIntervals.vehicleId, id),
      with: { changedByUser: { columns: { name: true, email: true } } },
      orderBy: [desc(fuelVehicleOperationalIntervals.startedAt)],
      limit: 25,
    }),
    // Últimas 10 OT del equipo; `null` (no `[]`) sin la capacidad, para que la
    // ficha no pinte «sin órdenes de trabajo» a quien no puede verlas.
    workOrderScope ? listRecentVehicleWorkOrders(workOrderScope, id, 10) : Promise.resolve(null),
  ])

  // Rendimiento promedio del log operacional ±30 días alrededor de la salida de
  // taller de cada OT cerrada de la lista. Una sola agregación para todas (sin
  // una consulta por fila, CO-042). La fecha de salida se lee en hora de Chile:
  // `fecha` del log es un día civil chileno.
  const closedWithExit = (recentWorkOrders ?? []).filter((workOrder) => workOrder.status === "cerrada" && workOrder.workshopExitAt)
  const exitDate = sql`(${mantWorkOrders.workshopExitAt} AT TIME ZONE 'America/Santiago')::date`
  const workOrderConsumptionImpact = canViewFuel && closedWithExit.length > 0
    ? (await db.select({
        workOrderId: mantWorkOrders.id,
        avgBefore: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} < to_char(${exitDate}, 'YYYY-MM-DD'))`,
        avgAfter: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} > to_char(${exitDate}, 'YYYY-MM-DD'))`,
      }).from(mantWorkOrders).leftJoin(fuelOperationRecords, and(
        eq(fuelOperationRecords.vehicleId, mantWorkOrders.vehicleId),
        isNotNull(fuelOperationRecords.rendimiento),
        // `fecha` es texto «YYYY-MM-DD»: se compara contra `to_char`, que
        // devuelve el mismo formato, para que ambos extremos queden inclusivos.
        sql`${fuelOperationRecords.fecha} >= to_char(${exitDate} - (${WORK_ORDER_IMPACT_WINDOW_DAYS} * INTERVAL '1 day'), 'YYYY-MM-DD')`,
        sql`${fuelOperationRecords.fecha} <= to_char(${exitDate} + (${WORK_ORDER_IMPACT_WINDOW_DAYS} * INTERVAL '1 day'), 'YYYY-MM-DD')`,
      )).where(inArray(mantWorkOrders.id, closedWithExit.map((workOrder) => workOrder.id)))
      .groupBy(mantWorkOrders.id))
      .map((row) => ({ ...row, avgBefore: row.avgBefore == null ? null : Number(row.avgBefore), avgAfter: row.avgAfter == null ? null : Number(row.avgAfter) }))
    : []

  return {
    vehicle,
    documents,
    recentWorkOrders,
    workOrderConsumptionImpact,
    // Última lectura de horómetro/odómetro con fecha real, y los operadores
    // más frecuentes — derivados del log operacional de combustible.
    currentReading: recentOperations[0] ?? null,
    recentOperations,
    topOperators: operatorCounts.map((o) => ({ operador: o.operador!, count: Number(o.count) })),
    operationalIntervals,
    nextExpiryDate: resolveNextExpiryDate({
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }, documents.filter((document) => document.status === "current")),
  }
}

/* ── Document management ────────────────────────────────────────────────────── */

export interface UploadFleetDocumentInput {
  vehicleId: string
  documentType: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  expiresAt?: string | null
}

export async function uploadFleetDocument(
  input: UploadFleetDocumentInput,
  session: Session,
  worksiteIds: string[] | "all",
): Promise<string> {
  if (!can(session, "flota:manage_documents")) throw new Error("Sin permisos para administrar documentos de flota")
  if (!input.fileName || !input.filePath) throw new Error("Archivo requerido")
  // El servicio es el punto compartido: repite la taxonomía y la fecha civil en
  // vez de confiar en que su llamador validó.
  const metadata = fleetDocumentMetadataSchema.parse({
    vehicleId: input.vehicleId,
    documentType: input.documentType,
    expiresAt: input.expiresAt ?? null,
  })

  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, input.vehicleId),
    columns: { id: true, worksiteId: true },
  })
  if (!vehicle) throw new Error("Vehículo no encontrado")
  if (worksiteIds !== "all" && !worksiteIds.includes(vehicle.worksiteId)) {
    throw new Error("Sin acceso a la faena de este vehículo")
  }

  const docId = nanoid()
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    // La versión anterior del mismo tipo deja de ser vigente en la misma
    // transacción: si se insertara la nueva sin retirar la vieja, el índice
    // único la rechazaría y —antes de existir ese índice— el vencimiento del
    // equipo lo seguía decidiendo la póliza reemplazada.
    // En dos pasos y en este orden: retirar la vigente libera el índice único
    // parcial —si no, el INSERT choca con ella—, y el puntero `supersededBy`
    // sólo puede escribirse una vez que la fila nueva existe.
    const [superseded] = await tx.update(fleetVehicleDocuments)
      .set({ status: "replaced", supersededAt: now })
      .where(and(
        eq(fleetVehicleDocuments.vehicleId, input.vehicleId),
        eq(fleetVehicleDocuments.documentType, metadata.documentType),
        eq(fleetVehicleDocuments.status, "current"),
      ))
      .returning({ id: fleetVehicleDocuments.id })

    await tx.insert(fleetVehicleDocuments).values({
      id: docId,
      vehicleId: input.vehicleId,
      documentType: metadata.documentType,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      expiresAt: metadata.expiresAt ?? null,
      status: "current",
      uploadedBy: session.user.id,
    })

    if (superseded) {
      await tx.update(fleetVehicleDocuments)
        .set({ supersededBy: docId })
        .where(eq(fleetVehicleDocuments.id, superseded.id))
    }

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "fleet_document",
      entityId: docId,
      newState: {
        vehicleId: input.vehicleId,
        documentType: metadata.documentType,
        fileName: input.fileName,
        supersedes: superseded?.id ?? null,
      },
    }, tx)
  })

  return docId
}

/**
 * `FLO-003` (auditoría 2026-09-14), patrón P5: esto borraba la fila y el
 * archivo. Ahora **anula**: la fila queda con motivo, responsable y fecha, y el
 * documento sigue en disco. Conserva el nombre `deleteFleetDocument` porque es
 * lo que la pantalla llama «eliminar» y renombrar la acción no cambiaría nada
 * de lo que importa; lo que cambió es lo que hace.
 */
export async function deleteFleetDocument(
  documentId: string,
  session: Session,
  worksiteIds: string[] | "all",
  reason?: string,
): Promise<void> {
  if (!can(session, "flota:manage_documents")) throw new Error("Sin permisos para administrar documentos de flota")
  const document = await db.query.fleetVehicleDocuments.findFirst({
    where: eq(fleetVehicleDocuments.id, documentId),
  })
  if (!document) throw new Error("Documento no encontrado")

  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, document.vehicleId),
    columns: { id: true, worksiteId: true },
  })
  if (!vehicle) throw new Error("Vehículo no encontrado")
  if (worksiteIds !== "all" && !worksiteIds.includes(vehicle.worksiteId)) {
    throw new Error("Sin acceso a la faena de este vehículo")
  }

  const trimmedReason = (reason ?? "").trim()
  if (!isValidReason(trimmedReason)) throw new Error(reasonRequiredMessage("por qué se anula el documento"))
  if (document.status === "voided") throw new Error("El documento ya está anulado")

  let promotedId: string | null = null
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.update(fleetVehicleDocuments).set({
      status: "voided",
      voidedAt: now,
      voidedBy: session.user.id,
      voidReason: trimmedReason,
    }).where(eq(fleetVehicleDocuments.id, documentId))

    // Si el anulado era el vigente, la versión inmediatamente anterior vuelve a
    // serlo: dejar el tipo sin vigente apaga su alerta de vencimiento en vez de
    // devolverla al último dato conocido.
    if (document.status === "current") {
      const [previous] = await tx.select({ id: fleetVehicleDocuments.id })
        .from(fleetVehicleDocuments)
        .where(and(
          eq(fleetVehicleDocuments.vehicleId, document.vehicleId),
          eq(fleetVehicleDocuments.documentType, document.documentType),
          eq(fleetVehicleDocuments.status, "replaced"),
        ))
        .orderBy(desc(fleetVehicleDocuments.createdAt))
        .limit(1)
      if (previous) {
        await tx.update(fleetVehicleDocuments)
          .set({ status: "current", supersededAt: null, supersededBy: null })
          .where(eq(fleetVehicleDocuments.id, previous.id))
        promotedId = previous.id
      }
    }

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fleet_document",
      entityId: documentId,
      oldState: { vehicleId: document.vehicleId, documentType: document.documentType, fileName: document.fileName, status: document.status },
      newState: { status: "voided", promotedToCurrent: promotedId },
      reason: trimmedReason,
    }, tx)
  })

  // El archivo **no** se borra: es el respaldo que puede pedirse en una
  // fiscalización, y la fila anulada lo sigue apuntando.
}
