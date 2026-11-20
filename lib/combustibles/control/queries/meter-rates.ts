import type { Session } from "next-auth"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyRules, fuelEquipmentTypes, fuelMeterReadings, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { monthsWithoutProviderData } from "@/lib/combustibles/copec-coverage"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { acceptedMeterResetSql } from "@/lib/combustibles/meter-reset-sql"
import { buildMeterRateSeries, chileMonthOf, isPartialMonth, type MeterRateSeries, type RateReading, type RateVehicle } from "@/lib/combustibles/meter-rate-series"
import { maxMeterRatePerDayOf, meterSeriesSegments, segmentTouchesExcludedDay } from "@/lib/combustibles/meter-series"
import { isPersonalUseDay } from "@/lib/fleet/personal-use"
import { loadPersonalUseIndex } from "@/lib/services/fleet-personal-use"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { loadPerformanceControlContext } from "@/lib/combustibles/control/settings"
import { mandanteWorksitesSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { isoTextDaySql, isoTextMonthSql, stayWorksiteOnIsoTextDaySql } from "./field-filters"
import { todayInChile } from "@/lib/utils"

/**
 * CHART-016: rendimiento por mes (km/L y L/h) de las lecturas de medidor que trae
 * el detalle de Copec (`fuel_meter_readings`, fuente `copec_tct`).
 *
 * La lectura no lleva faena propia: el alcance y los filtros de faena y mandante son
 * los de la faena del equipo el día de la lectura (`stayWorksiteOnDaySql`), no la actual, y se aplican DESPUÉS de
 * emparejar: un par cuenta en la faena de su lectura final. El método y sus límites
 * están en `lib/combustibles/meter-rate-series.ts`; acá sólo se leen las series, se
 * marcan los resets aceptados y los meses sin datos del proveedor, y se arma.
 *
 * `occurred_at` es texto UTC: el mes de cada lectura —para la ventana, para el
 * hueco y para la serie— se lee en hora de Chile (hallazgo 3.3). Con `left(…, 7)`
 * una lectura del 31-mar 22:10 de Chile (`2026-04-01T01:10Z`) se atribuía a abril
 * y `monthsWithReadings` declaraba abril con datos.
 */

/** Unidad en que rinde un equipo según su medidor: el odómetro da km/L y el horómetro, L/h. */
const UNIT_OF_METER: Record<string, PerformanceUnit | undefined> = { odometer: "km_per_liter", hour_meter: "liters_per_hour" }

const previousMonth = (monthKey: string) => {
  const [year = 1970, month = 1] = monthKey.split("-").map(Number)
  const index = year * 12 + (month - 1) - 1
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}

export interface MeterRateWindow {
  /** Primer día de lo que se dibuja («YYYY-MM-DD»); omitido = el 1 del primer mes. */
  from?: string
  /** Último día de lo que se dibuja («YYYY-MM-DD»): las lecturas posteriores no entran. */
  to: string
  /** Meses «YYYY-MM» de la ventana, en orden. */
  monthKeys: string[]
  /** Hoy, para saber si el último mes aún no termina. Sólo lo pasan las pruebas. */
  today?: string
}

export async function getMeterRateSeries(
  session: Session | null,
  filters: Pick<ControlFilters, "worksiteId" | "mandanteId">,
  window: MeterRateWindow,
): Promise<Record<PerformanceUnit, MeterRateSeries>> {
  const { monthKeys, to, from } = window
  const firstMonth = monthKeys[0]
  const lastMonth = monthKeys[monthKeys.length - 1]
  const empty = buildMeterRateSeries({ vehicles: [], monthKeys, gapMonths: new Set(), limits: { maxKmPerLiter: 0, maxLitersPerHour: 0 } })
  if (!firstMonth || !lastMonth) return empty

  // Un mes de más hacia atrás: su última lectura es la base del primer par de la ventana.
  const lookbackMonth = previousMonth(firstMonth)
  const readingMonth = isoTextMonthSql(fuelMeterReadings.occurredAt)
  // Faena en que estaba el equipo el día de la lectura, no la actual: tras un traslado cada lectura cuenta donde se tomó.
  const readingWorksite = stayWorksiteOnIsoTextDaySql(fuelMeterReadings.vehicleId, fuelMeterReadings.occurredAt)
  // Alcance y filtros se evalúan sobre la faena de cada lectura pero NO recortan la serie: el par se arma con la
  // lectura anterior del equipo aunque haya sido en otra faena, y cada par cuenta en la faena de su lectura final.
  // Filtrar antes de emparejar unía las dos últimas lecturas de A de un equipo que pasó por B (A→B→A).
  const scopeCondition = and(
    worksiteScopeSql(session, readingWorksite, filters.worksiteId),
    filters.mandanteId ? sql`${readingWorksite} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
  )
  // Sin alcance ni filtros (`and` de nada = undefined) todo cuenta.
  const readingInScope = scopeCondition ? sql<boolean>`coalesce(${scopeCondition}, false)` : sql<boolean>`true`

  const [rows, jumpRules, control] = await Promise.all([
    db.select({
      vehicleId: fuelMeterReadings.vehicleId,
      meterType: fuelMeterReadings.meterType,
      occurredAt: fuelMeterReadings.occurredAt,
      value: fuelMeterReadings.value,
      liters: fuelMeterReadings.liters,
      acceptedReset: acceptedMeterResetSql(),
      inScope: readingInScope,
      performanceUnit: fuelVehicles.performanceUnit,
      equipmentTypeSlug: fuelEquipmentTypes.slug,
    })
      .from(fuelMeterReadings)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelMeterReadings.vehicleId))
      .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .where(and(
        eq(fuelMeterReadings.source, "copec_tct"),
        sql`${readingMonth} >= ${lookbackMonth}`,
        sql`${isoTextDaySql(fuelMeterReadings.occurredAt)} <= ${to}::date`,
      ))
      .orderBy(fuelMeterReadings.vehicleId, fuelMeterReadings.meterType, fuelMeterReadings.occurredAt, fuelMeterReadings.id),
    db.select({ config: fuelAnomalyRules.config }).from(fuelAnomalyRules).where(eq(fuelAnomalyRules.code, "salto_medidor_implausible")).limit(1),
    loadPerformanceControlContext(),
  ])
  const jumpRule = { config: jumpRules[0]?.config ?? null }

  // Una serie por equipo: el odómetro de un equipo de km/L y el horómetro de uno de L/h. La otra serie del mismo
  // equipo no se mira (Flota hace igual): nadie la ve en su fila.
  const personalUse = await loadPersonalUseIndex(rows.flatMap((row) => row.vehicleId ? [row.vehicleId] : []))
  const series = new Map<string, RateVehicle>()
  for (const row of rows) {
    if (!row.vehicleId) continue
    const unit = UNIT_OF_METER[row.meterType]
    if (!unit || row.performanceUnit !== unit) continue
    const key = `${row.vehicleId}:${row.meterType}`
    let vehicle = series.get(key)
    if (!vehicle) {
      vehicle = {
        vehicleId: row.vehicleId,
        unit,
        maxPerDay: maxMeterRatePerDayOf(jumpRule, unit === "km_per_liter" ? "km" : "hora", row.equipmentTypeSlug ?? undefined),
        readings: [],
      }
      series.set(key, vehicle)
    }
    const reading: RateReading = {
      value: Number(row.value),
      occurredAt: row.occurredAt,
      acceptedReset: row.acceptedReset,
      liters: row.liters === null ? null : Number(row.liters),
      inScope: row.inScope,
    }
    vehicle.readings.push(reading)
  }
  // Uso personal: el par que recorre algún día del dueño no entra al rendimiento (ni sus km ni sus litros).
  // Las lecturas se conservan —quitarlas haría que el par que salta el hueco sumara los km del uso personal— y
  // el par se descarta marcando su lectura final fuera de alcance, que es como `buildMeterRateSeries` omite
  // sin contar un par ajeno a lo que se mira.
  for (const vehicle of series.values()) markPersonalUseSegments(vehicle, (day) => isPersonalUseDay(personalUse, vehicle.vehicleId, day))

  // Un mes del que la integración no trajo nada no puede decir «no se recorrió»: es un hueco (C-4). Las lecturas
  // salen del mismo informe de Copec, así que un mes con lecturas ya tiene respaldo aunque la cobertura no lo diga.
  // Se mira también el mes previo: un par que lo cruza no se puede usar.
  const coverage = await listCopecPeriodCoverage(`${lookbackMonth}-01`, to)
  // El mes de una lectura es el de Chile, no el del texto UTC: si no, la del 31 de marzo por la noche «respalda» abril.
  const monthsWithReadings = new Set(rows.filter((row) => row.inScope).map((row) => chileMonthOf(row.occurredAt)))
  const gapMonths = monthsWithoutProviderData([lookbackMonth, ...monthKeys], coverage, monthsWithReadings)

  const today = window.today ?? todayInChile()
  return buildMeterRateSeries({
    vehicles: [...series.values()],
    monthKeys,
    ...(from ? { fromDate: from } : {}),
    gapMonths,
    partialMonth: isPartialMonth(lastMonth, to, today) ? lastMonth : null,
    limits: { maxKmPerLiter: control.settings.maxKmPerLiter, maxLitersPerHour: control.settings.maxLitersPerHour },
  })
}

/**
 * Deja `inScope: false` en la lectura final de cada par contado que recorre un día de uso personal del equipo
 * (`segmentTouchesExcludedDay`, la regla de `meterSeriesAdvance`). Sólo pares que `meterSeriesSegments` cuenta:
 * un par objetado o un reset siguen su camino y no cambian.
 */
function markPersonalUseSegments(vehicle: RateVehicle, isExcludedDay: (day: string) => boolean): void {
  const touched = new Set<RateReading>()
  for (const segment of meterSeriesSegments(vehicle.readings, vehicle.maxPerDay)) {
    if (segment.status === "counted" && segmentTouchesExcludedDay(segment, isExcludedDay)) touched.add(segment.to as RateReading)
  }
  for (const reading of touched) reading.inScope = false
}
