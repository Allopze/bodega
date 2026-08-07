import { Certificate, Gauge, Truck, Wrench } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getExpiringFleetDocuments } from "@/lib/services/dashboard-domains-data"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getFleetOverview } from "@/lib/services/fleet"
import { getUsageMaintenanceAlerts } from "@/lib/services/maintenance"
import { countPendingFuelCreditNotes } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import {
  FuelConsumptionChart,
  MaintenanceTrendChart,
  ThresholdRankingChart,
} from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { plusDays, todayInChile } from "./shared"

// ── Flota y combustible ──────────────────────────────────────────────────────

/**
 * Flota y combustible: el **consumo y el estado de los equipos**, no su costo
 * agregado.
 *
 * El costo de combustible del período y la deuda vencida de cuenta corriente se
 * fueron a Finanzas. Se queda `FuelConsumptionChart`, que grafica litros y costo
 * en eje doble: esa es una lectura operacional —cuánto se consume y a qué
 * precio— y no el agregado financiero que Finanzas compara con los ingresos.
 */
export async function FleetSection({ session, scope }: DomainSectionsProps) {
  const worksiteId = scopedWorksiteId(scope)
  const today = todayInChile()
  const permissions = session.user.permissions

  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  const dteCodEmp = (await readDtePortalConfig()).credentials.codEmp
  const [fuelControl, fuelTrend, maintenanceTrend, docs, fleet, usageAlerts, pendingFuelCreditNotes] = await Promise.all([
    getFuelControlOverview(session, {
      includeTae: true,
      filters: { fromDate: bounds.currentStart.slice(0, 10), toDate: bounds.currentEnd.slice(0, 10), ...(worksiteId ? { worksiteId } : {}) },
    }).catch(() => null),
    getFuelMonthlyTrend(session, 6, worksiteId),
    getMaintenanceMonthlyTrend(session, 6, worksiteId),
    getExpiringFleetDocuments(session, today, plusDays(today, 30), worksiteId),
    getFleetOverview(session, worksiteId).catch(() => []),
    getUsageMaintenanceAlerts(session, worksiteId).catch(() => []),
    // Notas de crédito de combustible sin aplicar (rutEmisor de fuelSuppliers,
    // por empresa/período tributario — no por faena, igual que la deuda arriba).
    countPendingFuelCreditNotes(today.slice(0, 7), dteCodEmp).catch(() => null),
  ])

  const canSeeCosts = permissions.includes("combustibles:view_costs")
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  /*
   * `costPerKm`/`costPerHour` los calcula `getFleetOverview` desde hace tiempo y
   * nadie los leía. Sólo existen con la unidad canónica del equipo y con dos
   * lecturas distintas en el período — con una sola carga no hay recorrido que
   * dividir—, así que la lista se filtra en vez de inventar ceros.
   */
  const costPerUse = fleet
    .filter((vehicle) => vehicle.costPerKm !== null || vehicle.costPerHour !== null)
    .map((vehicle) => ({
      name: vehicle.plate ?? vehicle.id,
      value: Math.round(vehicle.costPerKm ?? vehicle.costPerHour ?? 0),
      detail: vehicle.costPerKm !== null ? "$ por km" : "$ por hora",
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8)

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.flota}
      links={[
        { label: "Combustibles", href: "/combustibles" },
        { label: "Flota", href: "/flota" },
        { label: "Mantenciones", href: "/mantenciones" },
        ...(canSeeCosts ? [{ label: "Finanzas", href: "/dashboard?vista=finanzas" }] : []),
      ]}
      kpis={
        <>
          <KpiCard icon={<Truck size={16} />} label="Vehículos activos" value={String(fleet.filter((vehicle) => vehicle.isActive).length)}
            detail="En catálogo operativo · ahora" href="/flota" />
          <KpiCard icon={<Gauge size={16} />} label="Litros del período"
            value={`${Math.round(fuelTrend.reduce((sum, point) => sum + point.liters, 0)).toLocaleString("es-CL")} L`}
            detail="Cargas registradas · últimos 6 meses" href="/combustibles" />
          <KpiCard icon={<Certificate size={16} />} label="Documentos por vencer" value={String(docs.within30)}
            detail={docs.expired > 0 ? `${docs.expired} ya vencido(s) · próximos 30 días` : "Próximos 30 días"}
            tone={docs.within30 + docs.expired > 0 ? "signal" : "neutral"} href="/flota" />
          <KpiCard icon={<Wrench size={16} />} label="Mantención vencida por uso" value={String(usageAlerts.length)}
            detail={usageAlerts.length > 0 ? `${usageAlerts[0]!.plate} lleva ${Math.round(usageAlerts[0]!.usageSinceLastMaintenance)} ${usageAlerts[0]!.medidoPor} · ahora` : "Ninguna pasada de intervalo"}
            tone={usageAlerts.length > 0 ? "signal" : "neutral"} href="/mantenciones" />
        </>
      }
      summary={<SummaryBar stats={[
        {
          key: "tae-billed-gap",
          label: "Brecha TAE vs. facturado",
          value: fuelControl?.tae ? `${Math.abs(Math.round(fuelControl.tae.liters - fuelControl.billed.liters)).toLocaleString("es-CL")} L` : "—",
          secondary: fuelControl?.tae ? `${fuelControl.tae.pendingReview} por revisar · ${periodo}` : "Sin control TAE",
          href: "/combustibles/tae/conciliacion",
        },
        ...(pendingFuelCreditNotes !== null ? [{
          key: "dte-nc-pendientes",
          label: "NC de combustible sin aplicar",
          value: pendingFuelCreditNotes,
          tone: (pendingFuelCreditNotes > 0 ? "signal" : undefined) as "signal" | undefined,
          href: "/compras/dte?tipo=61",
        }] : []),
      ]} />}
      charts={
        <>
          <div className="xl:col-span-2"><FuelConsumptionChart data={fuelTrend} /></div>
          <div className="xl:col-span-2"><MaintenanceTrendChart data={maintenanceTrend} /></div>
          {costPerUse.length > 0 && (
            <ThresholdRankingChart
              title="Costo operacional por unidad de uso"
              description="Combustible + mantención por km o por hora (últimos 12 meses)"
              unit="" format="clp" invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={costPerUse}
            />
          )}
        </>
      }
    />
  )
}
