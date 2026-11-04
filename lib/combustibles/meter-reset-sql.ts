import { sql } from "drizzle-orm"
import { fuelAnomalyCases, fuelMeterReadings } from "@/db/schema"
import { METER_RESET_RULE_CODES } from "@/lib/combustibles/anomaly-labels"

/**
 * ¿Esta lectura de `fuel_meter_readings` es un **reset de medidor aceptado**?
 *
 * Un caso de medidor regresivo sobre ESTA lectura, cerrado explícitamente como
 * `reset_medidor` y no como lectura corregida, parte la serie en esa lectura
 * (CO-023, ítem 7); lo demás sigue siendo «posible reset, verifica». Es la misma
 * marca que lee la bandeja de anomalías (`fuel_anomaly_cases.resolution_kind`): el
 * detector deja el caso sobre la lectura actual del par que retrocede, y
 * `referenceEntityType` distingue la fuente (`fuel_meter_reading`, no una carga
 * propia).
 *
 * Lo comparten Flota (recorrido de la ventana) y el rendimiento por mes de Consumo:
 * las dos alimentan `meterSeriesAdvance` / `meterSeriesSegments` y deben cortar la
 * serie en las mismas lecturas.
 */
export function acceptedMeterResetSql() {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${fuelAnomalyCases}
    WHERE ${fuelAnomalyCases.referenceEntityType} = 'fuel_meter_reading'
      AND ${fuelAnomalyCases.referenceEntityId} = ${fuelMeterReadings.id}
      AND ${fuelAnomalyCases.ruleCode} IN (${sql.join(METER_RESET_RULE_CODES.map((code) => sql`${code}`), sql`, `)})
      AND ${fuelAnomalyCases.status} IN ('resolved', 'dismissed')
      AND ${fuelAnomalyCases.resolutionKind} = 'reset_medidor'
  )`
}
