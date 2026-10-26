import { Certificate, Gauge, Truck, Wrench } from "@phosphor-icons/react/dist/ssr"
import { formatQty } from "@/lib/utils"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { SummaryBar } from "@/components/ui/summary-bar"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { logger } from "@/lib/logger"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getExpiringFleetDocuments } from "@/lib/services/dashboard-domains-data"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { FLEET_OVERVIEW_LOOKBACK_MONTHS, getFleetOverview } from "@/lib/services/fleet"
import { getUsageMaintenanceAlerts } from "@/lib/services/maintenance"
import { canViewOperationalControl, operationalControlCapabilities } from "@/lib/operational-control/capabilities"
import { countPendingFuelCreditNotes } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { ChartFrame } from "../charts/chart-frame"
import {
  FuelConsumptionChart,
  MaintenanceTrendChart,
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

  // De las 7 consultas de abajo, 4 tenían `.catch()` silencioso (sin log) y 3
  // no tenían NADA — si cualquiera de esas 3 revienta, el `Promise.all`
  // completo rechaza y tumba la sección entera vía Suspense/error boundary
  // (CO-037). `track()` unifica las 7: loguea server-side y marca la fuente
  // como degradada para que la UI no confunda "vacío real" con "falló".
  const degradedSources: string[] = []
  let trackedCount = 0
  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
    trackedCount++
    return promise.catch((error: unknown) => {
      logger.error(`[fleet-section] ${label} falló`, error)
      degradedSources.push(label)
      return fallback
    })
  }

  // 6 meses fijos para las dos tendencias — no depende de `scope.period`
  // (CO-038): ambos gráficos rotulan la ventana con este mismo número.
  const TREND_MONTHS = 6
  const [fuelControl, fuelTrend, maintenanceTrend, docs, fleet, usageAlerts, pendingFuelCreditNotes] = await Promise.all([
    canViewFuel ? track(getFuelControlOverview(session, {
      includeTae: canViewTae,
      filters: { fromDate: bounds.currentStart.slice(0, 10), toDate: bounds.currentEnd.slice(0, 10), ...(worksiteId ? { worksiteId } : {}) },
    }), null, "fuelControl") : Promise.resolve(null),
    canViewFuel ? track(getFuelMonthlyTrend(session, TREND_MONTHS, worksiteId), [], "fuelTrend") : Promise.resolve([]),
    canViewMaintenance ? track(getMaintenanceMonthlyTrend(session, TREND_MONTHS, worksiteId), [], "maintenanceTrend") : Promise.resolve([]),
    canViewFleet ? track(getExpiringFleetDocuments(session, today, plusDays(today, 30), worksiteId), { within30: 0, expired: 0 }, "expiringDocs") : Promise.resolve({ within30: 0, expired: 0 }),
    canViewFleet ? track(getFleetOverview(session, worksiteId), [], "fleetOverview") : Promise.resolve([]),
    canViewMaintenance ? track(getUsageMaintenanceAlerts(session, worksiteId), [], "usageAlerts") : Promise.resolve([]),
    // Notas de crédito de combustible sin aplicar (rutEmisor de fuelSuppliers,
    // por empresa/período tributario — no por faena, igual que la deuda arriba).
    // "Mes calendario actual", no `scope.period` — ver el rótulo en el summary.
    dteCodEmp ? track(countPendingFuelCreditNotes(today.slice(0, 7), dteCodEmp), null, "pendingCreditNotes") : Promise.resolve(null),
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
      key: vehicle.id,
      label: vehicle.plate ?? vehicle.id,
      value: Math.round(vehicle.costPerKm ?? vehicle.costPerHour ?? 0),
      detail: vehicle.costPerKm !== null ? "$ por km" : "$ por hora",
      href: `/flota/${vehicle.id}`,
    })) : []

  /*
   * Un "0" en estos dos tiles es un estado sin configurar, no una buena noticia
   * (a diferencia de "documentos por vencer"): dicen qué falta y a dónde ir. Si
   * la fuente falló, el cero no es un dato y el banner de degradación ya lo
   * avisa, así que ahí se conserva la cifra.
   */
  const activeVehicles = fleet.filter((vehicle) => vehicle.isActive).length
  const totalLiters = Math.round(fuelTrend.reduce((sum, point) => sum + point.liters, 0))
  const canRegisterVehicles = permissions.includes("admin:fleet_vehicles")

  // Los posibles resets de medidor no son "uso vencido" — son una lectura que
  // necesita verificación. Se excluyen de este KPI (siguen visibles en /mantenciones).
  const overdueUsageAlerts = usageAlerts.filter((a) => !a.possibleMeterReset)

  return (
    <>
      <DegradedDataBanner degraded={degradedSources} total={trackedCount} />
      <DomainSection
        domain={DASHBOARD_DOMAINS.flota}
        links={[
          // Mismos nombres que el menú del área (CO-IA, 2026-10-22).
          ...(canViewOperationalControl(session) ? [{ label: "Panel operacional", href: "/control-operacional" }] : []),
          ...(canViewFuel ? [{ label: "Consumo y rendimiento", href: "/combustibles" }] : []),
          ...(canViewFleet ? [{ label: "Vehículos", href: "/flota" }] : []),
          ...(canViewMaintenance ? [{ label: "Mantenciones", href: "/mantenciones" }] : []),
          ...(canViewFuel && canSeeCosts ? [{ label: "Finanzas", href: "/dashboard?vista=finanzas" }] : []),
        ]}
        kpis={
          <>
            {canViewFleet && <KpiCard {...DASHBOARD_KPI} icon={<Truck size={16} />} label="Vehículos activos" value={String(activeVehicles)}
              detail="En catálogo operativo · ahora" href="/flota"
              empty={activeVehicles === 0 && !degradedSources.includes("fleetOverview")
                ? { message: "Aún no hay vehículos activos", actionLabel: canRegisterVehicles ? "Registrar un vehículo" : "Ver vehículos" }
                : undefined} />}
            {/* Antes decía "Litros del período" con un valor que en realidad sale
                de 6 meses fijos, sin relación con `scope.period` — el rótulo
                contradecía directamente su propio valor (CO-038). */}
            {canViewFuel && <KpiCard {...DASHBOARD_KPI} icon={<Gauge size={16} />} label={`Litros (${TREND_MONTHS} meses)`}
              value={`${formatQty(totalLiters)} L`}
              detail="Cargas registradas · ahora" href="/combustibles"
              empty={totalLiters === 0 && !degradedSources.includes("fuelTrend")
                ? { message: `Sin cargas registradas en ${TREND_MONTHS} meses`, actionLabel: "Ir a combustibles" }
                : undefined} />}
            {canViewFleet && <KpiCard {...DASHBOARD_KPI} icon={<Certificate size={16} />} label="Documentos por vencer" value={String(docs.within30)}
              detail={docs.expired > 0 ? `${docs.expired} ya vencido(s) · próximos 30 días` : "Próximos 30 días"}
              tone={docs.within30 + docs.expired > 0 ? "signal" : "neutral"} href="/flota" />}
            {canViewMaintenance && <KpiCard {...DASHBOARD_KPI} icon={<Wrench size={16} />} label="Mantención vencida por uso" value={String(overdueUsageAlerts.length)}
              detail={overdueUsageAlerts.length > 0 ? `${overdueUsageAlerts[0]!.plate} lleva ${Math.round(overdueUsageAlerts[0]!.usageSinceLastMaintenance)} ${overdueUsageAlerts[0]!.medidoPor} · ahora` : "Ninguna pasada de intervalo"}
              tone={overdueUsageAlerts.length > 0 ? "signal" : "neutral"} href="/mantenciones" />}
          </>
        }
        summary={<SummaryBar numerals="sans" stats={[
          ...(canViewFuel && canViewTae ? [{
            key: "tae-billed-gap",
            // A6: sigla con su nombre en el rótulo (glosario en `dashboard-glossary.ts`).
            label: "Brecha tarjeta TAE vs. facturado",
            value: fuelControl?.tae ? `${formatQty(Math.abs(Math.round(fuelControl.tae.liters - fuelControl.billed.liters)))} L` : "—",
            secondary: fuelControl?.tae ? `${fuelControl.tae.pendingReview} por revisar · ${periodo}` : "Sin control de tarjeta TAE",
            href: "/combustibles/tae/conciliacion",
          }] : []),
          ...(pendingFuelCreditNotes !== null ? [{
            key: "dte-nc-pendientes",
            label: "Notas de crédito de combustible sin aplicar",
            value: pendingFuelCreditNotes,
            // Mes calendario ACTUAL, no `scope.period` (CO-038): las notas de
            // crédito tributan por período fiscal, no por el filtro del tablero.
            secondary: `Mes tributario actual (${today.slice(0, 7)})`,
            tone: (pendingFuelCreditNotes > 0 ? "signal" : undefined) as "signal" | undefined,
            href: "/compras/dte?tipo=61",
          }] : []),
        ]} />}
        /*
         * Bento de 3 columnas (2xl) y 2 (xl) sin huecos: el consumo comparte fila
         * con el ranking de costo (2 + 1) y la mantención cierra la suya completa.
         * Sin ranking —sin permiso de costos o sin tasas calculables— el consumo
         * toma la fila entera en vez de dejar una columna vacía a su lado. En xl
         * el ranking, solo en su fila, ocupa las dos columnas.
         */
        charts={
          <>
            {canViewFuel && <ChartSlot span={costPerUse.length > 0 ? "wide" : "full"}><FuelConsumptionChart data={fuelTrend} showCosts={canSeeCosts} periodLabel={`últimos ${TREND_MONTHS} meses`} /></ChartSlot>}
            {costPerUse.length > 0 && (
              <ChartSlot className="xl:col-span-2 2xl:col-span-1">
                <ChartFrame
                  title="Costo operacional por unidad de uso"
                  description={`Combustible + mantención por km o por hora (últimos ${FLEET_OVERVIEW_LOOKBACK_MONTHS} meses)`}
                >
                  {/* Sin % del total: las tasas son $/km para unos equipos y $/hora
                      para otros, y su suma no mide nada. Es una comparación de
                      tasas, no un reparto. */}
                  <RankedList
                    items={costPerUse} format="clp" mode="share" showShare={false} moreHref="/flota"
                    ariaLabel="Costo operacional por unidad de uso, por vehículo"
                  />
                </ChartFrame>
              </ChartSlot>
            )}
            {canViewMaintenance && <ChartSlot span="full"><MaintenanceTrendChart data={maintenanceTrend} showCosts={canSeeCosts} periodLabel={`últimos ${TREND_MONTHS} meses`} /></ChartSlot>}
          </>
        }
      />
    </>
  )
}
