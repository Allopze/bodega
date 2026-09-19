import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelAnomalyCases,
  fuelLoads,
  fuelOperationRecords,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  maintenanceRecords,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, visibleWorksiteIds, worksiteScopeSql } from "@/lib/auth/scope"
import { can } from "@/lib/auth/can"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { fuelOperationOccurredAtSql } from "@/lib/combustibles/fuel-log"
import { fleetDocumentMetadataSchema, resolveExpiryCandidates } from "@/lib/validation/fleet-documents"
import { isCivilDate } from "@/lib/validation/dates"
import { filterFleetOverviewRows, type FleetOverviewFilters } from "@/lib/fleet-overview-filters"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"

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
 * Existía inlineada en ~8 sitios (`lib/services/maintenance.ts`,
 * `app/(app)/combustibles/…`, la ejecución de PDTP); acá queda extraída para
 * los nuevos. Migrar los demás se hace cuando se toquen, no ahora.
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

export async function getFleetOverview(session: Session, worksiteId?: string, vehicleIds?: readonly string[]) {
  if (vehicleIds?.length === 0) return []
  const canViewFuel = can(session, "combustibles:view")
  const canViewMaintenance = can(session, "mantenciones:view")
  const canViewCosts = can(session, "flota:view") && can(session, "combustibles:view_costs")
  const vehicleScope = and(
    worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId),
    vehicleIds ? inArray(fuelVehicles.id, [...vehicleIds]) : undefined,
  )

  const sinceDate = new Date()
  sinceDate.setMonth(sinceDate.getMonth() - FLEET_OVERVIEW_LOOKBACK_MONTHS)
  const since = sinceDate.toISOString()

  // Predicado común a las tres consultas de `fuelLoads` de abajo (agregado +
  // primera/última lectura): antes vivía inline y duplicado.
  const fuelLoadWhere = and(
    accountableFuelLoadsWhere(),
    sql`${fuelLoads.loadDate} >= ${since.slice(0, 10)}`,
    worksiteScopeSql(session, fuelLoads.worksiteId, worksiteId),
    vehicleIds ? inArray(fuelLoads.vehicleId, [...vehicleIds]) : undefined,
  )
  // Sólo un campo de lectura está poblado por vehículo en la práctica (según
  // `performanceUnit`, el consumidor sólo lee uno de los dos más abajo), así
  // que basta una fila "primera"/"última" por vehículo con cualquiera de los
  // dos no nulo — no hace falta resolverlos por separado.
  const hasReading = or(isNotNull(fuelLoads.odometerReading), isNotNull(fuelLoads.hourMeterReading))

  // Una carga con un reset de medidor ACEPTADO —caso regresivo cerrado
  // explícitamente como `reset_medidor`, no como lectura corregida— no es parte
  // de la misma serie
  // que las cargas posteriores al reset: sin este filtro, la "primera lectura"
  // seguía siendo la del medidor viejo y el recorrido calculado se inflaba
  // (o salía negativo) para siempre, incluso después de validar el reset
  // (CO-023, ítem 7). Sólo aplica a la PRIMERA lectura — la última siempre es
  // la más reciente exista o no un reset de por medio.
  // `reset_fl` es un alias de texto plano (no `alias()` de drizzle): interpolar
  // una tabla con alias de drizzle dentro de un fragmento `sql` no emite el
  // `AS` que la define, sólo la referencia — Postgres la ve como una tabla que
  // no existe. Con SQL de texto para el alias, sin ambigüedad de nombres.
  const noLaterAcceptedReset = sql`NOT EXISTS (
    SELECT 1 FROM fuel_loads reset_fl
    INNER JOIN ${fuelAnomalyCases} ON ${fuelAnomalyCases.referenceEntityId} = reset_fl.id
    WHERE reset_fl.vehicle_id = ${fuelLoads.vehicleId}
      AND reset_fl.load_date > ${fuelLoads.loadDate}
      AND ${fuelAnomalyCases.referenceEntityType} = 'fuel_load'
      AND ${fuelAnomalyCases.ruleCode} IN ('kilometraje_regresivo', 'horometro_regresivo')
      AND ${fuelAnomalyCases.status} IN ('resolved', 'dismissed')
      AND ${fuelAnomalyCases.resolutionKind} = 'reset_medidor'
  )`

  const [vehicles, fuelRows, firstReadingRows, lastReadingRows, maintenanceRows, documentExpiryRows] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
      orderBy: [fuelVehicles.plate],
    }),
    canViewFuel ? db
      .select({
        vehicleId: fuelLoads.vehicleId,
        totalFuelAmount: canViewCosts ? sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` : sql<null>`null`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
      })
      .from(fuelLoads)
      .where(fuelLoadWhere)
      .groupBy(fuelLoads.vehicleId) : Promise.resolve([]),
    // Primera y última lectura CRONOLÓGICA del período (no el máximo/mínimo
    // histórico): un medidor reemplazado dejaba el máximo antiguo pegado para
    // siempre, y un reset bajaba el mínimo a un valor que infla el recorrido
    // calculado (CO-023).
    canViewFuel ? db.selectDistinctOn([fuelLoads.vehicleId], {
        vehicleId: fuelLoads.vehicleId,
        odometerReading: fuelLoads.odometerReading,
        hourMeterReading: fuelLoads.hourMeterReading,
      })
      .from(fuelLoads)
      .where(and(fuelLoadWhere, hasReading, noLaterAcceptedReset))
      .orderBy(fuelLoads.vehicleId, asc(fuelLoads.loadDate), asc(fuelLoads.createdAt)) : Promise.resolve([]),
    canViewFuel ? db.selectDistinctOn([fuelLoads.vehicleId], {
        vehicleId: fuelLoads.vehicleId,
        odometerReading: fuelLoads.odometerReading,
        hourMeterReading: fuelLoads.hourMeterReading,
      })
      .from(fuelLoads)
      .where(and(fuelLoadWhere, hasReading))
      .orderBy(fuelLoads.vehicleId, desc(fuelLoads.loadDate), desc(fuelLoads.createdAt)) : Promise.resolve([]),
    canViewMaintenance ? db
      .select({
        vehicleId: maintenanceRecords.vehicleId,
        totalMaintenanceAmount: canViewCosts ? sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)` : sql<null>`null`,
        maintenanceCount: sql<number>`COUNT(*)`,
        lastMaintenanceDate: sql<string>`MAX(${maintenanceRecords.maintenanceDate})`,
      })
      .from(maintenanceRecords)
      .where(and(
        sql`${maintenanceRecords.maintenanceDate} >= ${since.slice(0, 10)}`,
        sql`${maintenanceRecords.status} <> 'cancelled'`,
        worksiteScopeSql(session, maintenanceRecords.worksiteId, worksiteId),
        vehicleIds ? inArray(maintenanceRecords.vehicleId, [...vehicleIds]) : undefined,
      ))
      .groupBy(maintenanceRecords.vehicleId) : Promise.resolve([]),
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
  ])

  const fuelByVehicle = new Map(fuelRows.map((row) => [row.vehicleId, row]))
  const firstReadingByVehicle = new Map(firstReadingRows.map((row) => [row.vehicleId, row]))
  const lastReadingByVehicle = new Map(lastReadingRows.map((row) => [row.vehicleId, row]))
  const maintenanceByVehicle = new Map(maintenanceRows.map((row) => [row.vehicleId, row]))
  const currentDocumentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const row of documentExpiryRows) {
    currentDocumentsByVehicle.set(row.vehicleId, [
      ...(currentDocumentsByVehicle.get(row.vehicleId) ?? []),
      { documentType: row.documentType, expiresAt: row.expiresAt },
    ])
  }

  return vehicles.map((vehicle) => {
    const fuel = fuelByVehicle.get(vehicle.id)
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const totalFuelAmount = canViewFuel && canViewCosts ? Number(fuel?.totalFuelAmount ?? 0) : null
    const totalMaintenanceAmount = canViewMaintenance && canViewCosts ? Number(maintenance?.totalMaintenanceAmount ?? 0) : null
    const totalOperationalCost = totalFuelAmount != null && totalMaintenanceAmount != null
      ? totalFuelAmount + totalMaintenanceAmount
      : null
    const firstReading = firstReadingByVehicle.get(vehicle.id)
    const lastReading = lastReadingByVehicle.get(vehicle.id)
    const firstOdometer = firstReading?.odometerReading == null ? null : Number(firstReading.odometerReading)
    const lastOdometer = lastReading?.odometerReading == null ? null : Number(lastReading.odometerReading)
    const firstHourMeter = firstReading?.hourMeterReading == null ? null : Number(firstReading.hourMeterReading)
    const lastHourMeter = lastReading?.hourMeterReading == null ? null : Number(lastReading.hourMeterReading)
    // Costo operacional (combustible + mantención) por unidad de uso, sólo con la unidad
    // canónica del equipo (sección 2) y al menos dos lecturas distintas en el período —
    // con una sola carga no hay recorrido/uso que dividir.
    const kmDriven = vehicle.performanceUnit === "km_per_liter" && firstOdometer != null && lastOdometer != null && lastOdometer > firstOdometer
      ? lastOdometer - firstOdometer : null
    const hoursRun = vehicle.performanceUnit === "liters_per_hour" && firstHourMeter != null && lastHourMeter != null && lastHourMeter > firstHourMeter
      ? lastHourMeter - firstHourMeter : null
    return {
      id: vehicle.id,
      plate: vehicle.plate,
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
      nextExpiryDate: getNextExpiryDate(resolveExpiryCandidates({
        soapExpiresAt: vehicle.soapExpiresAt,
        technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
        circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
        insuranceExpiresAt: vehicle.insuranceExpiresAt,
      }, currentDocumentsByVehicle.get(vehicle.id) ?? [])),
      totalFuelAmount,
      totalMaintenanceAmount,
      totalOperationalCost,
      totalLiters: canViewFuel ? Number(fuel?.totalLiters ?? 0) : null,
      loadCount: canViewFuel ? Number(fuel?.loadCount ?? 0) : null,
      maintenanceCount: canViewMaintenance ? Number(maintenance?.maintenanceCount ?? 0) : null,
      lastMaintenanceDate: canViewMaintenance ? maintenance?.lastMaintenanceDate ?? null : null,
      lastOdometerReading: canViewFuel ? lastOdometer : null,
      lastHourMeterReading: canViewFuel ? lastHourMeter : null,
      kmDriven,
      hoursRun,
      costPerKm: kmDriven && totalOperationalCost != null ? totalOperationalCost / kmDriven : null,
      costPerHour: hoursRun && totalOperationalCost != null ? totalOperationalCost / hoursRun : null,
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
  const canViewMaintenance = can(session, "mantenciones:view")
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
    brand: vehicle.brand,
    model: vehicle.model,
    type: vehicle.equipmentType?.name ?? vehicle.type,
    worksiteName: vehicle.worksite?.name ?? "Sin faena",
    operationalStatus: vehicle.operationalStatus,
    responsibleName: vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? null,
    isActive: vehicle.isActive,
    nextExpiryDate: getNextExpiryDate(resolveExpiryCandidates({
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }, currentDocumentsByVehicle.get(vehicle.id) ?? [])),
  }))
  const matching = filterFleetOverviewRows(index, filters, dates)
  const limit = Math.max(1, pagination.limit)
  const offset = Math.max(0, pagination.offset)
  const matchingIds = matching.map((vehicle) => vehicle.id)
  const pageIds = matching.slice(offset, offset + limit).map((vehicle) => vehicle.id)
  const sinceDate = new Date()
  sinceDate.setMonth(sinceDate.getMonth() - FLEET_OVERVIEW_LOOKBACK_MONTHS)
  const since = sinceDate.toISOString().slice(0, 10)
  const [rows, fuelSummaryRows, maintenanceSummaryRows] = await Promise.all([
    getFleetOverview(session, worksiteId, pageIds),
    canViewFuel && matchingIds.length > 0 ? db.select({
      totalAmount: canViewCosts ? sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` : sql<null>`null`,
      totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
    }).from(fuelLoads).where(and(
      accountableFuelLoadsWhere(),
      sql`${fuelLoads.loadDate} >= ${since}`,
      worksiteScopeSql(session, fuelLoads.worksiteId, worksiteId),
      inArray(fuelLoads.vehicleId, matchingIds),
    )) : Promise.resolve([]),
    canViewMaintenance && matchingIds.length > 0 ? db.select({
      totalAmount: canViewCosts ? sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)` : sql<null>`null`,
      count: sql<number>`COUNT(*)`,
    }).from(maintenanceRecords).where(and(
      sql`${maintenanceRecords.maintenanceDate} >= ${since}`,
      sql`${maintenanceRecords.status} <> 'cancelled'`,
      worksiteScopeSql(session, maintenanceRecords.worksiteId, worksiteId),
      inArray(maintenanceRecords.vehicleId, matchingIds),
    )) : Promise.resolve([]),
  ])
  const fuelSummary = fuelSummaryRows[0]
  const maintenanceSummary = maintenanceSummaryRows[0]
  const totalFuelAmount = canViewFuel && canViewCosts ? Number(fuelSummary?.totalAmount ?? 0) : null
  const totalMaintenanceAmount = canViewMaintenance && canViewCosts ? Number(maintenanceSummary?.totalAmount ?? 0) : null
  return {
    rows,
    total: matching.length,
    limit,
    offset,
    index,
    matching,
    summary: {
      active: matching.filter((vehicle) => vehicle.isActive).length,
      totalOperationalCost: totalFuelAmount != null && totalMaintenanceAmount != null
        ? totalFuelAmount + totalMaintenanceAmount
        : null,
      totalLiters: canViewFuel ? Number(fuelSummary?.totalLiters ?? 0) : null,
      maintenanceCount: canViewMaintenance ? Number(maintenanceSummary?.count ?? 0) : null,
    },
  }
}

export async function getFleetVehicleDetail(session: Session, id: string) {
  const canViewFuel = can(session, "combustibles:view")
  const canViewMaintenance = can(session, "mantenciones:view")
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, id),
    with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
  })
  if (!vehicle) return null
  if (scopedWorksites !== null && !scopedWorksites.includes(vehicle.worksiteId)) {
    return null
  }

  const [documents, recentMaintenance, recentOperations, operatorCounts, operationalIntervals] = await Promise.all([
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
    // De la más reciente a la más antigua: con `limit: 10` el orden ascendente
    // devolvía el tramo más viejo del historial y la última mantención del
    // vehículo quedaba fuera de la tarjeta. `maintenance_date` es sólo fecha,
    // así que se desempata por `createdAt` igual que el listado de mantenciones.
    canViewMaintenance ? db.query.maintenanceRecords.findMany({
      where: eq(maintenanceRecords.vehicleId, id),
      columns: {
        id: true,
        maintenanceDate: true,
        maintenanceType: true,
        status: true,
        createdAt: true,
      },
      orderBy: [desc(maintenanceRecords.maintenanceDate), desc(maintenanceRecords.createdAt)],
      limit: 10,
    }) : Promise.resolve([]),
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
  ])

  // Una sola agregación para todas las mantenciones visibles. El join limita
  // cada lectura a la ventana ±30 días de su OT; así se conserva la cobertura
  // histórica sin ejecutar una consulta adicional por fila (CO-042).
  const comparableMaintenance = recentMaintenance.filter((m) => m.status !== "cancelled" && isCivilDate(m.maintenanceDate))
  const maintenanceConsumptionImpact = canViewFuel && canViewMaintenance && comparableMaintenance.length > 0
    ? (await db.select({
        maintenanceId: maintenanceRecords.id,
        maintenanceDate: maintenanceRecords.maintenanceDate,
        maintenanceType: maintenanceRecords.maintenanceType,
        avgBefore: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} < ${maintenanceRecords.maintenanceDate})`,
        avgAfter: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} > ${maintenanceRecords.maintenanceDate})`,
      }).from(maintenanceRecords).leftJoin(fuelOperationRecords, and(
        eq(fuelOperationRecords.vehicleId, maintenanceRecords.vehicleId),
        isNotNull(fuelOperationRecords.rendimiento),
        // `fecha` es texto "YYYY-MM-DD": compararlo contra el resultado de
        // `::date ± interval` (que agrega hora, "YYYY-MM-DD 00:00:00") dejaba
        // fuera el día M-30 y sesgaba la ventana "antes" a 29 días. `to_char`
        // devuelve el mismo formato que la columna y mantiene ambos extremos
        // inclusivos.
        sql`${fuelOperationRecords.fecha} >= to_char(${maintenanceRecords.maintenanceDate}::date - interval '30 days', 'YYYY-MM-DD')`,
        sql`${fuelOperationRecords.fecha} <= to_char(${maintenanceRecords.maintenanceDate}::date + interval '30 days', 'YYYY-MM-DD')`,
      )).where(and(
        eq(maintenanceRecords.vehicleId, id),
        inArray(maintenanceRecords.id, comparableMaintenance.map((record) => record.id)),
      )).groupBy(maintenanceRecords.id, maintenanceRecords.maintenanceDate, maintenanceRecords.maintenanceType))
      .map((row) => ({ ...row, avgBefore: row.avgBefore == null ? null : Number(row.avgBefore), avgAfter: row.avgAfter == null ? null : Number(row.avgAfter) }))
    : []

  return {
    vehicle,
    documents,
    recentMaintenance,
    maintenanceConsumptionImpact,
    // Última lectura de horómetro/odómetro con fecha real, y los operadores
    // más frecuentes — derivados del log operacional de combustible.
    currentReading: recentOperations[0] ?? null,
    recentOperations,
    topOperators: operatorCounts.map((o) => ({ operador: o.operador!, count: Number(o.count) })),
    operationalIntervals,
    nextExpiryDate: getNextExpiryDate(resolveExpiryCandidates({
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }, documents.filter((document) => document.status === "current"))),
  }
}

function getNextExpiryDate(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))[0] ?? null
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
