import { Certificate, Gauge, Truck, Wrench } from "@phosphor-icons/react/dist/ssr"
import { formatQty } from "@/lib/utils"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { logger } from "@/lib/logger"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getFuelMonthlyTrend } from "@/lib/services/dashboard-fuel"
import { getFleetDashboardSnapshot } from "@/lib/services/dashboard-domains-data"
import { getWorkOrderGlobalMetrics, workOrderMetricsScope } from "@/lib/services/mantencion/work-orders/metrics"
import { canViewOperationalControl, operationalControlCapabilities } from "@/lib/operational-control/capabilities"
import { countPendingFuelCreditNotes } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { FuelConsumptionChart } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { plusDays, todayInChile } from "./shared"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { fuelSourcesHref } from "@/lib/combustibles/coverage-notice"
import { CoverageNotice } from "@/components/charts/coverage-notice"

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
    canViewCosts: canSeeCosts,
  } = operationalControlCapabilities(session)

  // «OT abiertas» se ve con `mant:ot:view_*` (no con flota ni combustible) y con
  // el alcance de faena de las OT. Sin la capacidad no se consulta ni se pinta.
  const workOrderScope = workOrderMetricsScope(session)

  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  // El tile de NC es de Compras: sin `purchasing:view` no se consulta ni se
  // pinta, y su destino (/compras/dte) responde 403 a quien no lo tiene.
  // La lectura de configuración va con catch como la consulta: un keyring mal
  // pegado no puede tumbar el tablero operacional de flota.
  const dteCodEmp = canViewFuel && canSeeCosts && permissions.includes("purchasing:view")
    ? await readDtePortalConfig().then((config) => config.credentials.codEmp || null).catch(() => null)
    : null

  // De las 5 consultas de abajo, varias tenían `.catch()` silencioso (sin log)
  // y otras no tenían NADA — si cualquiera revienta, el `Promise.all` completo
  // rechaza y tumba la sección entera vía Suspense/error boundary (CO-037).
  // `track()` las unifica: loguea server-side y marca la fuente como degradada
  // para que la UI no confunda "vacío real" con "falló".
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
  // Snapshot liviano: activos + vencimientos por equipo. Antes se cargaba
  // `getFleetOverview` completo (transacciones, series de medidor, anomalías y
  // reglas) para terminar contando sólo `isActive`.
  const emptyFleetSnapshot = { activeVehicles: 0, within30: 0, expired: 0 }
  const [fuelControl, fuelTrend, fleetSnapshot, pendingFuelCreditNotes, workOrders] = await Promise.all([
    canViewFuel ? track(getFuelControlOverview(session, {
      includeTae: canViewTae,
      filters: { fromDate: bounds.currentStart.slice(0, 10), toDate: bounds.currentEnd.slice(0, 10), ...(worksiteId ? { worksiteId } : {}) },
    }), null, "fuelControl") : Promise.resolve(null),
    canViewFuel ? track(getFuelMonthlyTrend(session, TREND_MONTHS, worksiteId), [], "fuelTrend") : Promise.resolve([]),
    canViewFleet ? track(getFleetDashboardSnapshot(session, today, plusDays(today, 30), worksiteId), emptyFleetSnapshot, "fleetSnapshot") : Promise.resolve(emptyFleetSnapshot),
    // Notas de crédito de combustible sin aplicar (rutEmisor de fuelSuppliers,
    // por empresa/período tributario — no por faena, igual que la deuda arriba).
    // "Mes calendario actual", no `scope.period` — ver el rótulo en el summary.
    dteCodEmp ? track(countPendingFuelCreditNotes(today.slice(0, 7), dteCodEmp), null, "pendingCreditNotes") : Promise.resolve(null),
    workOrderScope ? track(getWorkOrderGlobalMetrics(workOrderScope, { worksiteId, today }), null, "workOrders") : Promise.resolve(null),
  ])

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  /*
   * Un "0" en estos dos tiles es un estado sin configurar, no una buena noticia
   * (a diferencia de "documentos por vencer"): dicen qué falta y a dónde ir. Si
   * la fuente falló, el cero no es un dato y el banner de degradación ya lo
   * avisa, así que ahí se conserva la cifra.
   */
  const activeVehicles = fleetSnapshot.activeVehicles
  // El servicio cuenta equipos (no filas de documento) con el mismo criterio
  // que Flota y el Panel: columna declarada + documento vigente del mismo tipo.
  const docs = { within30: fleetSnapshot.within30, expired: fleetSnapshot.expired }
  const totalLiters = Math.round(fuelTrend.reduce((sum, point) => sum + (point.liters ?? 0), 0))
  // Meses sin datos del proveedor (C-4): no suman, y el aviso de cobertura de la sección los nombra (una sola vez:
  // ni este tile ni el gráfico lo repiten). La suma incluye el mes en curso a la fecha: «6 meses» sin ese aviso se
  // leería como seis meses completos.
  const gapMonths = fuelTrend.filter((point) => point.providerGap).map((point) => point.monthKey)
  const partialMonths = fuelTrend.filter((point) => point.partial).map((point) => point.monthKey)
  const litersDetail = "Copec (tarjetas y estanques) · ahora"
  const canRegisterVehicles = permissions.includes("admin:fleet_vehicles")

  return (
    <>
      <DegradedDataBanner degraded={degradedSources} total={trackedCount} />
      <DomainSection
        domain={DASHBOARD_DOMAINS.flota}
        coverage={canViewFuel ? (
          <CoverageNotice
            gapMonths={gapMonths}
            partialMonths={partialMonths}
            subject={`las cifras de combustible de los últimos ${TREND_MONTHS} meses`}
            sourcesHref={fuelSourcesHref(session)}
          />
        ) : undefined}
        links={[
          // Mismos nombres que el menú del área (CO-IA, 2026-10-22).
          ...(canViewOperationalControl(session) ? [{ label: "Panel operacional", href: "/control-operacional" }] : []),
          ...(canViewFuel ? [{ label: "Consumo y rendimiento", href: FUEL_PATHS.consumo }] : []),
          ...(canViewFleet ? [{ label: "Vehículos", href: "/flota" }] : []),
          ...(canViewFuel && canSeeCosts ? [{ label: "Finanzas", href: "/dashboard?vista=finanzas" }] : []),
        ]}
        kpis={
          <>
            {canViewFleet && <KpiCard {...DASHBOARD_KPI} icon={<Truck size={16} />} label="Vehículos activos" value={activeVehicles}
              detail="En catálogo operativo · ahora" href="/flota"
              empty={activeVehicles === 0 && !degradedSources.includes("fleetSnapshot")
                ? { message: "Aún no hay vehículos activos", actionLabel: canRegisterVehicles ? "Registrar un vehículo" : "Ver vehículos" }
                : undefined} />}
            {/* Antes decía "Litros del período" con un valor que en realidad sale
                de 6 meses fijos, sin relación con `scope.period` — el rótulo
                contradecía directamente su propio valor (CO-038). */}
            {canViewFuel && <KpiCard {...DASHBOARD_KPI} icon={<Gauge size={16} />} label={`Litros (${TREND_MONTHS} meses)`}
              value={`${formatQty(totalLiters)} L`}
              detail={litersDetail}
              href={FUEL_PATHS.consumoLitros}
              empty={totalLiters === 0 && !degradedSources.includes("fuelTrend")
                ? { message: `Sin cargas registradas en ${TREND_MONTHS} meses`, actionLabel: "Ir a combustibles" }
                : undefined} />}
            {/* Foto de hoy, como «Vehículos activos»: no depende del período del tablero. El
                destino es la pestaña «abiertas» de la lista, que cuenta lo mismo. A5: ésta es
                la única vista del tablero con la cifra. */}
            {workOrderScope && <KpiCard {...DASHBOARD_KPI} icon={<Wrench size={16} />} label="OT abiertas"
              value={workOrders ? workOrders.openCount : "Sin dato"}
              valueKind={workOrders ? "number" : "text"}
              detail={workOrders
                ? workOrders.openCount === 0
                  ? "Sin órdenes de trabajo abiertas · ahora"
                  : `${workOrders.unassignedOpen > 0 ? `${workOrders.unassignedOpen} sin asignar` : "Todas con mecánico"}${workOrders.estimateOverdue > 0 ? ` · ${workOrders.estimateOverdue} con entrega vencida` : ""} · ahora`
                : "No se pudo calcular"}
              tone={workOrders && (workOrders.unassignedOpen > 0 || workOrders.estimateOverdue > 0) ? "signal" : "neutral"}
              href="/mantencion/ot?estado=abiertas" />}
            {canViewFleet && <KpiCard {...DASHBOARD_KPI} icon={<Certificate size={16} />} label="Equipos por vencer" value={docs.within30}
              detail={docs.expired > 0 ? `${docs.expired} ya vencido(s) · próximos 30 días` : "Próximos 30 días"}
              tone={docs.within30 + docs.expired > 0 ? "signal" : "neutral"}
              // La lista abre el subconjunto que cuenta la cifra: próximos si hay
              // próximos; si no, los vencidos que muestra el detalle.
              href={docs.within30 > 0
                ? "/flota?vencimiento=proximos"
                : docs.expired > 0
                  ? "/flota?vencimiento=vencidos"
                  : "/flota?vencimiento=al-dia"} />}
          </>
        }
        summary={<SummaryBar numerals="sans" stats={[
          ...(canViewFuel && canViewTae ? [{
            key: "tae-billed-gap",
            // A6: sigla con su nombre en el rótulo (glosario en `dashboard-glossary.ts`).
            label: "Brecha tarjeta TAE vs. facturado",
            value: fuelControl?.tae ? `${formatQty(Math.abs(Math.round(fuelControl.tae.liters - fuelControl.billed.liters)))} L` : "Sin dato",
            valueKind: fuelControl?.tae ? ("number" as const) : ("text" as const),
            secondary: fuelControl?.tae ? `${fuelControl.tae.pendingReview} por revisar · ${periodo}` : "Sin control de tarjeta TAE",
            href: FUEL_PATHS.cuadraturaTarjetaTerreno,
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
        charts={
          <>
            {canViewFuel && <ChartSlot span="full"><FuelConsumptionChart data={fuelTrend} showCosts={canSeeCosts} periodLabel={`últimos ${TREND_MONTHS} meses`} /></ChartSlot>}
          </>
        }
      />
    </>
  )
}
