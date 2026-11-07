import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelEquipmentLoads, fuelProviderTransactions, fuelVehicles } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { accountableProviderTransactionsWhere } from "@/lib/combustibles/load-status"
import { idlePct } from "../calc/idle"
import { chileDateSql, countableLoadSql, parseControlFilters, statisticallyValidLoadSql } from "../filters"
import { dailyTelemetry } from "./idle"

/**
 * Agregado por activo para el Panel operacional. Una sola consulta por
 * dimensión (cargas, casos, costo facturado, última lectura e inactividad),
 * nunca una por fila.
 *
 * `fuelEquipmentLoads` es la serie operacional: litros, rendimiento y revisión.
 * `fuelProviderTransactions` es el libro del proveedor (tarjetas y estanques) y
 * aporta el monto, que puede no coincidir con los litros operacionales. No se
 * suman entre sí. El monto NO sale de `fuel_loads`: esa serie está vacía en
 * producción y dejaba el panel en $0 mientras Flota y el Tablero mostraban el
 * gasto real del proveedor.
 *
 * El alcance por faena se aplica en cada consulta; un vehículo fuera del
 * alcance no aporta filas, aunque su id venga en la lista.
 */
export interface AssetFuelSummary {
  vehicleId: string
  liters: number
  loadCount: number
  lastLoadAt: string | null
  /** Promedio de cargas válidas; mismo criterio que la ficha del equipo. */
  performanceValue: number | null
  flaggedLoads: number
  openCases: number
  criticalOpenCases: number
  /** Sólo con `combustibles:view_costs`; `null` sin ese permiso o si el proveedor no trae monto. */
  billedAmount: number | null
  lastMeterReading: number | null
  lastMeterType: "odometer" | "hour_meter" | null
  lastMeterAt: string | null
  operatingHours: number
  idleHours: number
  idlePct: number | null
  litersIdle: number | null
}

function emptySummary(vehicleId: string): AssetFuelSummary {
  return {
    vehicleId,
    liters: 0,
    loadCount: 0,
    lastLoadAt: null,
    performanceValue: null,
    flaggedLoads: 0,
    openCases: 0,
    criticalOpenCases: 0,
    billedAmount: null,
    lastMeterReading: null,
    lastMeterType: null,
    lastMeterAt: null,
    operatingHours: 0,
    idleHours: 0,
    idlePct: null,
    litersIdle: null,
  }
}

export async function getAssetFuelSummary(
  session: Session,
  period: { from: string; to: string },
  vehicleIds: readonly string[],
): Promise<Map<string, AssetFuelSummary>> {
  const ids = [...new Set(vehicleIds)]
  const out = new Map(ids.map((id) => [id, emptySummary(id)]))
  if (ids.length === 0) return out

  const canViewCosts = can(session, "combustibles:view_costs")
  const telemetry = dailyTelemetry(session, parseControlFilters({ desde: period.from, hasta: period.to }))

  const [loadRows, caseRows, costRows, meterRows, idleRows] = await Promise.all([
    db.select({
      vehicleId: fuelEquipmentLoads.vehicleId,
      liters: sql<number>`COALESCE(SUM(${fuelEquipmentLoads.liters}) FILTER (WHERE ${countableLoadSql}), 0)::float8`,
      loadCount: sql<number>`(COUNT(*) FILTER (WHERE ${countableLoadSql}))::int`,
      lastLoadAt: sql<string | null>`(MAX(${fuelEquipmentLoads.occurredAt}) FILTER (WHERE ${countableLoadSql}))::text`,
      // Promedio de las cargas con rendimiento calculado y revisión resuelta.
      // Es el mismo criterio de `getEquipmentStats` y de la ficha del equipo:
      // cada carga válida pesa igual. La eficiencia ponderada del período es
      // otra métrica y no se mezcla con ésta.
      performanceValue: sql<number | null>`(AVG(${fuelEquipmentLoads.performanceValue}) FILTER (WHERE ${statisticallyValidLoadSql}))::float8`,
      flaggedLoads: sql<number>`(COUNT(*) FILTER (WHERE ${fuelEquipmentLoads.reviewStatus} = 'flagged' AND ${isNull(fuelEquipmentLoads.voidedAt)}))::int`,
    })
      .from(fuelEquipmentLoads)
      .where(and(
        inArray(fuelEquipmentLoads.vehicleId, ids),
        worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
        sql`${chileDateSql(fuelEquipmentLoads.occurredAt)} BETWEEN ${period.from}::date AND ${period.to}::date`,
      ))
      .groupBy(fuelEquipmentLoads.vehicleId),
    db.select({
      vehicleId: fuelAnomalyCases.vehicleId,
      openCases: sql<number>`COUNT(*)::int`,
      criticalOpenCases: sql<number>`(COUNT(*) FILTER (WHERE ${fuelAnomalyCases.severity} = 'critical'))::int`,
    })
      .from(fuelAnomalyCases)
      .where(and(
        inArray(fuelAnomalyCases.vehicleId, ids),
        inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]),
        worksiteScopeSql(session, fuelAnomalyCases.worksiteId),
      ))
      .groupBy(fuelAnomalyCases.vehicleId),
    canViewCosts
      ? db.select({
          vehicleId: fuelProviderTransactions.vehicleId,
          billedAmount: sql<number>`COALESCE(SUM(${fuelProviderTransactions.amount}), 0)::float8`,
        })
          .from(fuelProviderTransactions)
          // El costo sigue al equipo: la faena histórica de la transacción puede
          // ser otra (equipo trasladado) o venir nula, y no debe borrar el monto.
          .innerJoin(fuelVehicles, eq(fuelProviderTransactions.vehicleId, fuelVehicles.id))
          .where(and(
            inArray(fuelProviderTransactions.vehicleId, ids),
            isNotNull(fuelProviderTransactions.vehicleId),
            worksiteScopeSql(session, fuelVehicles.worksiteId),
            // `occurred_at` es texto y puede traer hora: se compara el día civil.
            sql`left(${fuelProviderTransactions.occurredAt}, 10) >= ${period.from}`,
            sql`left(${fuelProviderTransactions.occurredAt}, 10) <= ${period.to}`,
            accountableProviderTransactionsWhere(),
          ))
          .groupBy(fuelProviderTransactions.vehicleId)
      : Promise.resolve([] as Array<{ vehicleId: string; billedAmount: number }>),
    // Última lectura con medidor: es la que se contrasta con la telemetría.
    db.selectDistinctOn([fuelEquipmentLoads.vehicleId], {
      vehicleId: fuelEquipmentLoads.vehicleId,
      meterReading: fuelEquipmentLoads.meterReading,
      meterType: fuelEquipmentLoads.meterType,
      occurredAt: fuelEquipmentLoads.occurredAt,
    })
      .from(fuelEquipmentLoads)
      .where(and(
        inArray(fuelEquipmentLoads.vehicleId, ids),
        worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
        countableLoadSql,
        isNotNull(fuelEquipmentLoads.meterReading),
      ))
      .orderBy(fuelEquipmentLoads.vehicleId, desc(fuelEquipmentLoads.occurredAt), desc(fuelEquipmentLoads.id)),
    // Motor en vacío del período, agregado por equipo.
    db.select({
      vehicleId: telemetry.vehicleId,
      operatingHours: sql<number>`COALESCE(SUM(${telemetry.operating}), 0)::float8`,
      idleHours: sql<number>`COALESCE(SUM(${telemetry.idle}), 0)::float8`,
      litersIdle: sql<number | null>`SUM(${telemetry.litersIdle})::float8`,
    })
      .from(telemetry)
      .where(inArray(telemetry.vehicleId, ids))
      .groupBy(telemetry.vehicleId),
  ])

  for (const row of loadRows) {
    if (!row.vehicleId) continue
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.liters = Number(row.liters ?? 0)
    entry.loadCount = Number(row.loadCount ?? 0)
    entry.lastLoadAt = row.lastLoadAt
    entry.performanceValue = row.performanceValue == null ? null : Number(row.performanceValue)
    entry.flaggedLoads = Number(row.flaggedLoads ?? 0)
  }

  for (const row of caseRows) {
    if (!row.vehicleId) continue
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.openCases = Number(row.openCases ?? 0)
    entry.criticalOpenCases = Number(row.criticalOpenCases ?? 0)
  }

  for (const row of costRows) {
    if (!row.vehicleId) continue
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.billedAmount = Number(row.billedAmount ?? 0)
  }

  for (const row of meterRows) {
    if (!row.vehicleId) continue
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.lastMeterReading = row.meterReading == null ? null : Number(row.meterReading)
    entry.lastMeterType = row.meterType === "odometer" || row.meterType === "hour_meter" ? row.meterType : null
    entry.lastMeterAt = row.occurredAt
  }

  for (const row of idleRows) {
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.operatingHours = Number(row.operatingHours ?? 0)
    entry.idleHours = Number(row.idleHours ?? 0)
    entry.litersIdle = row.litersIdle == null ? null : Number(row.litersIdle)
    entry.idlePct = idlePct(entry.idleHours, entry.operatingHours)
  }

  return out
}
