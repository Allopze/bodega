import { Certificate, Gauge, Truck, Wrench } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getExpiringFleetDocuments } from "@/lib/services/dashboard-domains-data"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getFleetOverview } from "@/lib/services/fleet"
import { getUsageMaintenanceAlerts } from "@/lib/services/maintenance"
import { operationalControlCapabilities } from "@/lib/operational-control/capabilities"
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
 * fueron a Finanzas. Se queda `FuelConsumptionChart`: siempre grafica litros y
 * agrega el eje de costo sólo cuando el actor posee la capacidad monetaria.
 */
export async function FleetSection({ session, scope }: DomainSectionsProps) {
  const worksiteId = scopedWorksiteId(scope)
  const today = todayInChile()
  const permissions = session.user.permissions
  const {
    canViewFuel,
    canViewTae,
    canViewFleet,
    canViewMaintenance,
    canViewCosts: canSeeCosts,
  } = operationalControlCapabilities(session)

  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  // El tile de NC es de Compras: sin `purchasing:view` no se consulta ni se
  // pinta, y su destino (/compras/dte) responde 403 a quien no lo tiene.
  // La lectura de configuración va con catch como la consulta: un keyring mal
  // pegado no puede tumbar el tablero operacional de flota.
  const dteCodEmp = canViewFuel && canSeeCosts && permissions.includes("purchasing:view")
    ? await readDtePortalConfig().then((config) => config.credentials.codEmp || null).catch(() => null)
    : null
  const [fuelControl, fuelTrend, maintenanceTrend, docs, fleet, usageAlerts, pendingFuelCreditNotes] = await Promise.all([
    canViewFuel ? getFuelControlOverview(session, {
      includeTae: canViewTae,
      filters: { fromDate: bounds.currentStart.slice(0, 10), toDate: bounds.currentEnd.slice(0, 10), ...(worksiteId ? { worksiteId } : {}) },
    }).catch(() => null) : Promise.resolve(null),
    canViewFuel ? getFuelMonthlyTrend(session, 6, worksiteId) : Promise.resolve([]),
    canViewMaintenance ? getMaintenanceMonthlyTrend(session, 6, worksiteId) : Promise.resolve([]),
    canViewFleet ? getExpiringFleetDocuments(session, today, plusDays(today, 30), worksiteId) : Promise.resolve({ within30: 0, expired: 0 }),
    canViewFleet ? getFleetOverview(session, worksiteId).catch(() => []) : Promise.resolve([]),
    canViewMaintenance ? getUsageMaintenanceAlerts(session, worksiteId).catch(() => []) : Promise.resolve([]),
    // Notas de crédito de combustible sin aplicar (rutEmisor de fuelSuppliers,
    // por empresa/período tributario — no por faena, igual que la deuda arriba).
    dteCodEmp ? countPendingFuelCreditNotes(today.slice(0, 7), dteCodEmp).catch(() => null) : Promise.resolve(null),
  ])

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  /*
   * `costPerKm`/`costPerHour` los calcula `getFleetOverview` desde hace tiempo y
   * nadie los leía. Sólo existen con la unidad canónica del equipo y con dos
   * lecturas distintas en el período — con una sola carga no hay recorrido que
   * dividir—, así que la lista se filtra en vez de inventar ceros.
   */
  const costPerUse = canSeeCosts ? fleet
    .filter((vehicle) => vehicle.costPerKm !== null || vehicle.costPerHour !== null)
    .map((vehicle) => ({
      name: vehicle.plate ?? vehicle.id,
      value: Math.round(vehicle.costPerKm ?? vehicle.costPerHour ?? 0),
      detail: vehicle.costPerKm !== null ? "$ por km" : "$ por hora",
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8) : []

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.flota}
      links={[
        ...(canViewFuel ? [{ label: "Combustibles", href: "/combustibles" }] : []),
        ...(canViewFleet ? [{ label: "Flota", href: "/flota" }] : []),
        ...(canViewMaintenance ? [{ label: "Mantenciones", href: "/mantenciones" }] : []),
        ...(canViewFuel && canSeeCosts ? [{ label: "Finanzas", href: "/dashboard?vista=finanzas" }] : []),
      ]}
      kpis={
        <>
          {canViewFleet && <KpiCard icon={<Truck size={16} />} label="Vehículos activos" value={String(fleet.filter((vehicle) => vehicle.isActive).length)}
            detail="En catálogo operativo · ahora" href="/flota" />}
          {canViewFuel && <KpiCard icon={<Gauge size={16} />} label="Litros del período"
            value={`${Math.round(fuelTrend.reduce((sum, point) => sum + point.liters, 0)).toLocaleString("es-CL")} L`}
            detail="Cargas registradas · últimos 6 meses" href="/combustibles" />}
          {canViewFleet && <KpiCard icon={<Certificate size={16} />} label="Documentos por vencer" value={String(docs.within30)}
            detail={docs.expired > 0 ? `${docs.expired} ya vencido(s) · próximos 30 días` : "Próximos 30 días"}
            tone={docs.within30 + docs.expired > 0 ? "signal" : "neutral"} href="/flota" />}
          {canViewMaintenance && <KpiCard icon={<Wrench size={16} />} label="Mantención vencida por uso" value={String(usageAlerts.length)}
            detail={usageAlerts.length > 0 ? `${usageAlerts[0]!.plate} lleva ${Math.round(usageAlerts[0]!.usageSinceLastMaintenance)} ${usageAlerts[0]!.medidoPor} · ahora` : "Ninguna pasada de intervalo"}
            tone={usageAlerts.length > 0 ? "signal" : "neutral"} href="/mantenciones" />}
        </>
      }
      summary={<SummaryBar stats={[
        ...(canViewFuel && canViewTae ? [{
          key: "tae-billed-gap",
          label: "Brecha TAE vs. facturado",
          value: fuelControl?.tae ? `${Math.abs(Math.round(fuelControl.tae.liters - fuelControl.billed.liters)).toLocaleString("es-CL")} L` : "—",
          secondary: fuelControl?.tae ? `${fuelControl.tae.pendingReview} por revisar · ${periodo}` : "Sin control TAE",
          href: "/combustibles/tae/conciliacion",
        }] : []),
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
          {canViewFuel && <div className="xl:col-span-2"><FuelConsumptionChart data={fuelTrend} showCosts={canSeeCosts} /></div>}
          {canViewMaintenance && <div className="xl:col-span-2"><MaintenanceTrendChart data={maintenanceTrend} showCosts={canSeeCosts} /></div>}
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
