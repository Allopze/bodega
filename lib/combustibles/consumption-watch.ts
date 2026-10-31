import type { ConsumptionAlert, PatenteRankingRow } from "./consumption-dashboard"
import { FUEL_PATHS, fuelEquipmentHref, fuelInboxHref } from "./routes"

/**
 * «Patentes para mirar»: las alertas de consumo (consumo alto, muchas
 * transacciones, rendimiento cero, patentes sin vincular, variación fuerte)
 * con el destino al que lleva cada una. Antes un clic filtraba toda la página
 * por la patente; ahora abre la ficha del equipo, que es donde se decide si hay
 * algo que hacer. Una patente que no es un equipo de la flota no tiene ficha:
 * se filtra el análisis de tarjetas por ella, y las patentes sin vincular van a
 * «Por revisar». Módulo puro: sólo arma rutas, no consulta.
 */
export interface WatchItem {
  key: string
  label: string
  reason: string
  action: string
  severity: ConsumptionAlert["severity"]
  /** Ruta sin el período ni la faena (la pantalla se los agrega); `null` si la alerta no lleva a ningún lado. */
  href: string | null
  /** Qué abre el enlace, para el texto visible. */
  hrefLabel: string | null
}

const PATENTE_QUERY = /^patente=(.*)$/

export function buildWatchItems(input: { alerts: readonly ConsumptionAlert[]; rankings: ReadonlyArray<readonly PatenteRankingRow[]>; limit?: number }): WatchItem[] {
  const byLabel = new Map<string, PatenteRankingRow>()
  for (const ranking of input.rankings) for (const row of ranking) if (!byLabel.has(row.patente)) byLabel.set(row.patente, row)

  const items = input.alerts.map((alert, index): WatchItem => {
    const base = { key: `${alert.type}:${alert.entityLabel}:${index}`, label: alert.entityLabel, reason: alert.reason, action: alert.action, severity: alert.severity }
    if (alert.type === "sin_asociacion") {
      return { ...base, href: fuelInboxHref({ tipo: "patente" }), hrefLabel: "Vincular en «Por revisar»" }
    }
    const match = PATENTE_QUERY.exec(alert.linkQuery)
    if (!match) return { ...base, href: null, hrefLabel: null }
    const row = byLabel.get(alert.entityLabel)
    if (row?.vehicleId) return { ...base, href: fuelEquipmentHref(row.vehicleId), hrefLabel: "Abrir la ficha del equipo" }
    const plate = row?.filterPatente ?? decodeURIComponent(match[1] ?? "")
    return { ...base, href: `${FUEL_PATHS.consumoLitros}?seccion=tarjetas&patente=${encodeURIComponent(plate)}`, hrefLabel: "Ver sus tarjetas" }
  })
  return input.limit ? items.slice(0, input.limit) : items
}
