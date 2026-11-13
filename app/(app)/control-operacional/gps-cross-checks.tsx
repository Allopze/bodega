import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { COPEC_CHANNEL_LABELS } from "@/lib/combustibles/source-labels"
import type { OperationalGpsCross } from "@/lib/services/operational-control"

/** Cobertura de los dos canales de Copec en el período; `null` sin `combustibles:tae_view` o si falló. */
export type ChannelCoverage = { bothChannels: number; taeOnly: number; tctOnly: number } | null

/**
 * Cruces de la telemetría con los otros subdominios. No son tiles: filas
 * compactas para que el panel no sume métricas al tope de A1. Cada fila enlaza
 * a la lista que usa el mismo predicado que su cifra. El valor va en la sans
 * del cuerpo: son frases («2 lecturas para revisar»), no cifras sueltas.
 */
export function GpsCrossChecks({
  data,
  period,
  canViewFuel,
  canViewMaintenance,
  canViewPurchaseCosts,
  canViewCosts,
  canViewWorkOrders,
  canViewCapa,
  canViewInspections,
  degradedSources,
  channelCoverage = null,
}: {
  data: OperationalGpsCross
  period: { from: string; to: string }
  canViewFuel: boolean
  canViewMaintenance: boolean
  canViewPurchaseCosts: boolean
  canViewCosts: boolean
  canViewWorkOrders: boolean
  canViewCapa: boolean
  canViewInspections: boolean
  degradedSources: string[]
  channelCoverage?: ChannelCoverage
}) {
  const degraded = (source: string) => degradedSources.includes(source)
  const telemetryDegraded = degraded("telemetría GPS")
  const fuelDegraded = telemetryDegraded || degraded("medidores GPS")
  const purchasesDegraded = degraded("medidores GPS")
  const rows: Array<{ key: string; label: string; value: string; detail: string; href: string; linkLabel: string }> = []

  if (canViewFuel) {
    rows.push({
      key: "fuel",
      label: "Combustible",
      value: fuelDegraded ? "Sin datos" : count(data.meterMismatches, "lectura para revisar", "lecturas para revisar"),
      detail: fuelDegraded
        ? "La consulta de medidores GPS falló; el resto del panel sigue disponible."
        : `${data.fuelPerformance.calculated} de ${data.totalVehicles} vehículos con rendimiento GPS calculable.`,
      href: `/control-operacional?revision=medidor-gps&desde=${period.from}&hasta=${period.to}`,
      linkLabel: "Revisar lecturas",
    })
  }

  if (canViewMaintenance) {
    rows.push({
      key: "maintenance",
      label: "Mantención (estimación GPS)",
      value: degraded("mantención GPS") ? "Sin datos" : count(data.maintenance.overdue, "vehículo vencido", "vehículos vencidos"),
      detail: degraded("mantención GPS")
        ? "La estimación GPS no se pudo calcular."
        : `${data.maintenance.upcoming} ${data.maintenance.upcoming === 1 ? "próximo" : "próximos"} · ${data.maintenance.estimated} con lectura GPS más nueva que la registrada.`,
      href: "/mantencion/equipos?estimacionGps=vencida",
      linkLabel: "Ver vehículos",
    })
  }

  // El costo por km u hora divide el costo total (combustible + compras + OT)
  // por el avance GPS. Sin las tres series no hay cifra honesta que publicar. La
  // fila lleva el nombre de la cifra (la columna de Vehículos), no el de una de
  // sus series: antes decía «Compras» y enlazaba a «Ver flota».
  if (canViewPurchaseCosts && canViewCosts && canViewWorkOrders) {
    rows.push({
      key: "cost-per-unit",
      label: "Costo por km u hora",
      value: purchasesDegraded || data.purchases.calculated === 0
        ? "Sin datos"
        : `${data.purchases.calculated} ${data.purchases.calculated === 1 ? "vehículo" : "vehículos"}`,
      detail: purchasesDegraded
        ? "La serie de medidores GPS no se pudo consultar."
        : `${data.purchases.insufficient} sin cobertura GPS suficiente para dividir el costo del período.`,
      href: "/flota",
      linkLabel: "Ver Vehículos",
    })
  }

  // Equipos con litros por un solo canal de Copec: la cobertura que antes era un tile de «Desempeño».
  if (channelCoverage) {
    const { bothChannels, taeOnly, tctOnly } = channelCoverage
    const single = taeOnly + tctOnly
    // Sin ningún vehículo con litros por Copec no hay nada que comparar: no es «0 con un solo canal».
    if (bothChannels + single > 0) {
      rows.push({
        key: "channels",
        label: "Combustible por canal",
        value: single === 0 ? "Ninguno" : `${single} ${single === 1 ? "vehículo" : "vehículos"} con un solo canal`,
        detail: `${taeOnly} solo en ${COPEC_CHANNEL_LABELS.TAE.toLowerCase()} · ${tctOnly} solo en ${COPEC_CHANNEL_LABELS.TCT.toLowerCase()} · ${bothChannels} en ambos.`,
        href: FUEL_PATHS.cuadraturaTarjetaTerreno,
        linkLabel: "Ver cuadratura",
      })
    }
  }

  // La cifra sale de inspecciones y CAPA; `canViewCapa` solo no alcanza.
  if (canViewCapa && canViewInspections) {
    rows.push({
      key: "prevention",
      label: "Prevención",
      value: countFem(data.prevention.overdueCapaTotal, "CAPA vencida", "CAPA vencidas"),
      detail: telemetryDegraded
        ? "No se pudo verificar el movimiento GPS de esos vehículos."
        : `${data.prevention.operatingWithOverdueCapa} de esos vehículos siguieron operando según la última posición.`,
      href: "/prevencion/capa?source=inspection&vista=overdue",
      linkLabel: "Ver CAPA",
    })
  }

  if (rows.length === 0) return null

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle as="h2">Cruces con otros sistemas</CardTitle>
        <p className="text-sm text-[var(--color-text-muted)]">
          Telemetría OnWay y Wialon cruzada con el resto de la plataforma.{" "}
          {telemetryDegraded
            ? "La cobertura GPS no se pudo calcular."
            : data.totalVehicles > 0
              ? `${data.reporting24h} de ${data.totalVehicles} vehículos reportaron en las últimas 24 h.`
              : "Sin vehículos activos en el alcance."}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">{row.label}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{row.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium tabular-nums text-[var(--color-text)]">{row.value}</span>
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                  <Link href={row.href}>
                    {row.linkLabel}
                    <ArrowRight size={12} className="ml-1" />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function count(value: number, singular: string, plural: string): string {
  if (value === 0) return "Ninguno"
  return `${value} ${value === 1 ? singular : plural}`
}

function countFem(value: number, singular: string, plural: string): string {
  if (value === 0) return "Ninguna"
  return `${value} ${value === 1 ? singular : plural}`
}
