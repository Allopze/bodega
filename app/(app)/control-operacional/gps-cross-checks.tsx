import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OperationalGpsCross } from "@/lib/services/operational-control"

/**
 * Cruces de la telemetría con los otros subdominios. No son tiles: cuatro
 * filas compactas para que el panel no sume una quinta métrica al tope de A1.
 * Cada fila enlaza a la lista que usa el mismo predicado que su cifra.
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
        : `${data.fuelPerformance.calculated} de ${data.totalVehicles} equipos con rendimiento GPS calculable.`,
      href: `/control-operacional?revision=medidor-gps&desde=${period.from}&hasta=${period.to}`,
      linkLabel: "Revisar lecturas",
    })
  }

  if (canViewMaintenance) {
    rows.push({
      key: "maintenance",
      label: "Mantención (estimación GPS)",
      value: degraded("mantención GPS") ? "Sin datos" : count(data.maintenance.overdue, "equipo vencido", "equipos vencidos"),
      detail: degraded("mantención GPS")
        ? "La estimación GPS no se pudo calcular."
        : `${data.maintenance.upcoming} ${data.maintenance.upcoming === 1 ? "próximo" : "próximos"} · ${data.maintenance.estimated} con lectura GPS más nueva que la registrada.`,
      href: "/mantencion/equipos?estimacionGps=vencida",
      linkLabel: "Ver equipos",
    })
  }

  // El costo por km/h divide el costo total (combustible + compras + OT) por
  // el avance GPS. Sin las tres series no hay cifra honesta que publicar.
  if (canViewPurchaseCosts && canViewCosts && canViewWorkOrders) {
    rows.push({
      key: "purchases",
      label: "Compras",
      value: purchasesDegraded
        ? "Sin datos"
        : data.purchases.calculated === 0
          ? "Sin datos"
          : `${data.purchases.calculated} ${data.purchases.calculated === 1 ? "equipo" : "equipos"}`,
      detail: purchasesDegraded
        ? "La serie de medidores GPS no se pudo consultar."
        : `${data.purchases.insufficient} sin cobertura GPS suficiente para dividir el costo del período.`,
      href: "/flota",
      linkLabel: "Ver flota",
    })
  }

  // La cifra sale de inspecciones y CAPA; `canViewCapa` solo no alcanza.
  if (canViewCapa && canViewInspections) {
    rows.push({
      key: "prevention",
      label: "Prevención",
      value: countFem(data.prevention.overdueCapaTotal, "CAPA vencida", "CAPA vencidas"),
      detail: telemetryDegraded
        ? "No se pudo verificar el movimiento GPS de esos equipos."
        : `${data.prevention.operatingWithOverdueCapa} de esos equipos siguieron operando según la última posición.`,
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
              ? `${data.reporting24h} de ${data.totalVehicles} equipos reportaron en las últimas 24 h.`
              : "Sin equipos activos en el alcance."}
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
                <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{row.value}</span>
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
