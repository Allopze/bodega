import type { Session } from "next-auth"
import {
  Broom, Certificate, ClipboardText, FileText, Gauge, Package,
  ShieldWarning, Siren, Truck, WarningOctagon, Wrench,
} from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import type { WorksiteScope } from "@/lib/auth/scope"
import { getAnalyticsDashboard } from "@/lib/services/analytics-module/dashboard"
import { getDashboardData } from "@/lib/services/dashboard"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
import { getDashboardCounters } from "@/lib/services/prevention-documents/search"
import { getLegalDashboard, getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import { getPpaStats } from "@/lib/services/ppa-module/calculos"
import { getDashboardStats } from "@/lib/services/sst-module/dashboard"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getStockAlerts } from "@/lib/services/stock-alerts"
import { listCompetencyGaps } from "@/lib/services/prevention-training"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getExpiringFleetDocuments, getFieldControlSummary, getReceptionQuality } from "@/lib/services/dashboard-domains-data"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getFleetOverview } from "@/lib/services/fleet"
import { getUsageMaintenanceAlerts } from "@/lib/services/maintenance"
import { getCanonicalSafetyIndicatorYear, getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"
import { getPdtpComplianceIndicatorsForScope } from "@/lib/services/pdtp/compliance"
import { countPendingFuelCreditNotes } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { DASHBOARD_DOMAINS, type DashboardDomainKey } from "./dashboard-domains"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "./pdtp-compliance-card"
import { FinanceSection } from "./sections/finance-section"
import { DomainSection } from "./dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId, type DashboardScope } from "./dashboard-scope"
import { MONTH_LABELS, toSstMonthlyPoints } from "./sst-monthly-points"
import { CHART_COLORS } from "@/lib/chart-palette"
import type { ModuleWorkloadPoint } from "./dashboard-charts"
import {
  CompositionDonutChart, FuelConsumptionChart, MaintenanceTrendChart, MaterialEnvironmentalChart,
  ModuleWorkloadChart, OperationalTrendChart, SstAccidentChart, SstTrendChart, StatusShareBar,
  ThresholdRankingChart,
} from "./dashboard-domain-charts"

const CHILE_TODAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export interface DomainSectionsProps {
  session: Session
  scope: DashboardScope
  worksiteScope: WorksiteScope
  pdtpScope: string[] | "all"
  /** Faenas del alcance ya resueltas a ids: varias funciones exigen `string[]`. */
  worksiteIds: string[]
  currentYear: number
  moduleWorkload: ModuleWorkloadPoint[]
  queueTotal: number
}

/** Filtros de `getAnalyticsDashboard` derivados del alcance global. */
function analyticsFilters(scope: DashboardScope) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  return {
    fromDate: bounds.currentStart.slice(0, 10),
    toDate: bounds.currentEnd.slice(0, 10),
    ...(scopedWorksiteId(scope) ? { worksiteId: scopedWorksiteId(scope)! } : {}),
  }
}

function todayInChile() {
  return CHILE_TODAY_FORMATTER.format(new Date())
}

/** Porcentaje entero, con 0 cuando no hay denominador (evita NaN en el gráfico). */
function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function plusDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

// ── Adquisiciones ────────────────────────────────────────────────────────────

/**
 * Adquisiciones: el **proceso** de comprar, no su monto.
 *
 * El gasto, el ticket medio, los proveedores por gasto, el gasto por módulo, la
 * inversión por faena y la salud DTE se fueron a Finanzas, donde conviven con la
 * facturación de venta. Quedaron acá las cifras que describen cómo avanza el
 * flujo: cuántas OC se emiten, cuántas siguen abiertas, qué tan limpio llega lo
 * que se recibe y qué espera una decisión.
 *
 * A5 sigue rigiendo: una cifra, una representación. El tope de tiles se relajó
 * para el tablero; la prohibición de duplicar cifras no.
 */
async function AcquisitionsSection({ session, scope, moduleWorkload, queueTotal }: DomainSectionsProps) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  /*
   * `getDashboardData` se consulta acá y no en la página.
   *
   * Entrega `pendingApprovals` —ítems esperando decisión **ahora**, la misma
   * cifra que la alerta del Resumen; `analytics.kpis.pendingApprovals` filtra
   * por la ventana del período y la pantalla llegó a mostrar 3, 1 y 0 para
   * "aprobaciones" a la vez (I-02)— y `orders_pending_receipt`. Con las vistas
   * conmutadas, dejarla en la página la cobraba a los ocho renders.
   */
  const [analytics, quality, trend, dashboardData] = await Promise.all([
    getAnalyticsDashboard(session, analyticsFilters(scope)),
    getReceptionQuality(session, { from: bounds.currentStart, to: bounds.currentEnd }, scopedWorksiteId(scope)),
    getOperationalTrendHistory(session, 6, new Date(), scopedWorksiteId(scope)),
    getDashboardData(session, scopedWorksiteId(scope)),
  ])
  const pendingApprovals = dashboardData.metrics.pending_approvals

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.adquisiciones}
      links={[{ label: "Compras", href: "/compras" }, { label: "Analítica", href: "/analitica" }, { label: "Finanzas", href: "/dashboard?vista=finanzas" }]}
      kpis={
        <>
          <KpiCard icon={<ClipboardText size={16} />} label="OC emitidas" value={String(analytics.kpis.purchaseOrderCount)}
            detail={`Órdenes creadas · ${periodo}`} href="/compras" />
          <KpiCard icon={<Truck size={16} />} label="Por recibir" value={String(dashboardData.metrics.orders_pending_receipt)}
            detail="Órdenes con recepción pendiente · ahora"
            tone={dashboardData.metrics.orders_pending_receipt > 0 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard icon={<Broom size={16} />} label="Rechazo en recepción" value={`${quality.rejectionRate}%`}
            detail={quality.rejected + quality.damaged > 0 ? `${quality.rejected} rechazadas · ${quality.damaged} dañadas · ${periodo}` : `Todo llegó conforme · ${periodo}`}
            tone={quality.rejectionRate > 5 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard icon={<Package size={16} />} label="Por aprobar" value={String(pendingApprovals)}
            detail="Ítems esperando decisión ahora" href="/pendientes?module=aprobaciones" />
        </>
      }
      charts={
        <>
          <div className="xl:col-span-2">
            <OperationalTrendChart data={trend.map((p) => ({ month: p.month, requests: p.requests, orders: p.orders, receipts: p.receipts }))} />
          </div>
          {moduleWorkload.length > 0 && <ModuleWorkloadChart data={moduleWorkload} total={queueTotal} />}
        </>
      }
    />
  )
}

// ── Bodega y entregas ────────────────────────────────────────────────────────

async function WarehouseSection({ session, scope }: DomainSectionsProps) {
  const [analytics, alerts] = await Promise.all([
    getAnalyticsDashboard(session, analyticsFilters(scope)),
    getStockAlerts(),
  ])

  const worksiteId = scopedWorksiteId(scope)
  const scoped = worksiteId ? alerts.filter((alert) => alert.worksiteId === worksiteId) : alerts
  const critical = scoped.filter((alert) => alert.severity === "critical")
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.bodega}
      links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
      kpis={
        <>
          <KpiCard icon={<WarningOctagon size={16} />} label="Stock crítico" value={String(critical.length)}
            detail={critical.length > 0 ? "Bajo su mínimo, ahora" : "Todo sobre el mínimo, ahora"}
            tone={critical.length > 0 ? "signal" : "neutral"} href="/bodega" />
          <KpiCard icon={<Package size={16} />} label="Stock en alerta" value={String(scoped.length - critical.length)}
            detail="Cerca del mínimo, ahora" href="/bodega" />
          <KpiCard icon={<Truck size={16} />} label="Entregas de EPP" value={String(analytics.eppDeliveries.length)}
            detail={`Trabajadores con entrega · ${periodo}`} href="/entregas" />
          <KpiCard icon={<Gauge size={16} />} label="Productos en rotación" value={String(analytics.productRotation.length)}
            detail={`Con movimiento · ${periodo}`} href="/analitica" />
        </>
      }
      charts={
        <>
          <ThresholdRankingChart
            title="Mayor déficit de stock" description="Cuánto falta para alcanzar el mínimo definido" unit=" u."
            invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
            data={scoped.slice(0, 8).map((alert) => ({
              name: alert.productName,
              value: Math.max(0, Math.round(alert.minStock - alert.currentQty)),
              detail: `${alert.currentQty} de ${alert.minStock} · ${alert.worksiteName}`,
            }))}
          />
          <ThresholdRankingChart
            title="EPP entregado por trabajador" description="Unidades entregadas en el período" unit=" u."
            invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
            data={analytics.eppDeliveries.slice(0, 8).map((row) => ({
              name: row.workerName, value: row.totalQty, detail: `${row.deliveryCount} entregas · ${row.worksiteName}`,
            }))}
          />
        </>
      }
    />
  )
}

// ── Prevención y SST ─────────────────────────────────────────────────────────

async function PreventionSection({ session, worksiteScope, worksiteIds, currentYear }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)

  const [capa, incidents, legal, risk, sstYear, envEvents, pdtpByWorksite, pdtpSummary] = await Promise.all([
    has("prevention:capa:view")
      ? getCapaDashboardCounts({ scope: worksiteScope, permissions })
      : Promise.resolve({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0 }),
    has("prevention:incidents:view")
      ? getIncidentDashboardCounts({ ctx: { userId: session.user.id }, scope: worksiteScope, permissions })
      : Promise.resolve({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 }),
    has("prevention:legal:view") ? getLegalDashboard({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => null) : Promise.resolve(null),
    has("prevention:risk:view") ? getRiskDashboard({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => null) : Promise.resolve(null),
    has("prevention:indicadores:view") ? getCanonicalSafetyIndicatorYear(currentYear, worksiteScope).catch(() => null) : Promise.resolve(null),
    has("prevention:indicadores:view") ? getMaterialEnvironmentalEvents(currentYear, worksiteScope).catch(() => null) : Promise.resolve(null),
    has("prevention:pdtp:view") ? getPdtpComplianceIndicatorsForScope(currentYear, worksiteIds).catch(() => null) : Promise.resolve(null),
    /*
     * La tarjeta de cumplimiento PDTP vivía en el aside del Centro de Control.
     * Se muda acá, junto al resto del detalle preventivo: en el Resumen ahora
     * hay un medidor radial con la misma cifra, y A5 prohíbe que una cifra
     * tenga dos representaciones en la misma pantalla.
     */
    has("prevention:pdtp:view") ? loadPdtpComplianceSummary(worksiteIds).catch(() => null) : Promise.resolve(null),
  ])

  const totalGroup = sstYear?.groups.find((group) => group.worksiteId === "total")
  const sstPoints = totalGroup ? toSstMonthlyPoints(totalGroup.monthly) : []
  const materialEnvPoints = envEvents?.eventData.find((entry) => entry.worksiteId === "total")?.monthly.map((month) => ({
    month: MONTH_LABELS[month.month - 1] ?? `M${month.month}`,
    dangerousIncidents: month.dangerousIncidents,
    materialDamage: month.materialDamage,
    environmentalSpills: month.environmentalSpills,
  })) ?? []

  // `perWorksite` viene con ids; los nombres salen del propio dashboard legal,
  // que ya consulta las faenas visibles del alcance.
  const worksiteNames = new Map((legal?.worksites ?? risk?.worksites ?? []).map((w) => [w.id, w.name]))
  const pdtpPercent = pdtpByWorksite?.annual.percent ?? null
  // `getLegalDashboard` entrega las aplicabilidades crudas y la lista de brechas;
  // el porcentaje se deriva acá sobre el denominador correcto —sólo las
  // marcadas "applicable"—, no sobre el total de requisitos del catálogo.
  const applicableCount = legal?.applicabilities.filter((item) => item.applicability.applicabilityStatus === "applicable").length ?? 0
  const legalGaps = legal?.gaps.length ?? 0
  const legalCompliance = applicableCount > 0
    ? Math.round(((applicableCount - legalGaps) / applicableCount) * 100)
    : null

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.prevencion}
      note="Las tasas y los eventos son anuales por norma; no siguen el período elegido arriba."
      links={[
        { label: "PDTP", href: "/prevencion/pdtp" },
        { label: "Incidentes", href: "/prevencion/incidentes" },
        { label: "Indicadores", href: "/prevencion/indicadores" },
      ]}
      kpis={
        <>
          <KpiCard icon={<Certificate size={16} />} label="Cumplimiento PDTP"
            value={pdtpPercent === null ? "—" : `${Math.round(pdtpPercent * 100)}%`}
            detail={pdtpPercent === null ? "Sin programa activo" : `Avance acreditado · año ${currentYear}`} href="/prevencion/pdtp" />
          <KpiCard icon={<Siren size={16} />} label="Incidentes abiertos" value={String(incidents.totalOpen)}
            detail={incidents.fatalOrSerious > 0 ? `${incidents.fatalOrSerious} fatal(es) o grave(s) · ahora` : "Ninguno fatal ni grave, ahora"}
            tone={incidents.fatalOrSerious > 0 ? "signal" : "neutral"} href="/prevencion/incidentes?quick=open" />
          <KpiCard icon={<ShieldWarning size={16} />} label="CAPA vencidas" value={String(capa.overdue)}
            detail={`${capa.open} abierta${capa.open === 1 ? "" : "s"} en total · ahora`} tone={capa.overdue > 0 ? "signal" : "neutral"} href="/prevencion/capa?vista=overdue" />
          {risk && (
            <KpiCard icon={<ShieldWarning size={16} />} label="Riesgos críticos sin control"
              value={String(risk.criticalBlockers.length)}
              detail={risk.criticalBlockers.length > 0 ? "Sin control verificado ni PDTP · ahora" : "Todos con control verificado"}
              tone={risk.criticalBlockers.length > 0 ? "signal" : "neutral"} href="/prevencion/miper#bloqueos" />
          )}
        </>
      }
      summary={
        <>
          <SummaryBar stats={[{
            key: "legal-compliance",
            label: "Cumplimiento legal",
            value: legalCompliance === null ? "—" : `${legalCompliance}%`,
            secondary: applicableCount > 0 ? `${legalGaps} brechas de ${applicableCount} aplicables · ahora` : "Sin requisitos evaluados",
            href: "/prevencion/requisitos-legales",
          }]} />
          {pdtpSummary && <div className="mt-3"><PdtpComplianceCard {...pdtpSummary} /></div>}
        </>
      }
      charts={
        <>
          {sstPoints.length > 0 && <div className="xl:col-span-2"><SstTrendChart data={sstPoints} /></div>}
          {sstPoints.length > 0 && <SstAccidentChart data={sstPoints} />}
          {materialEnvPoints.length > 0 && <div className="xl:col-span-2"><MaterialEnvironmentalChart data={materialEnvPoints} /></div>}
          {risk && (risk.coverage.activeProcesses > 0 || risk.coverage.activePositions > 0) && (
            <ThresholdRankingChart
              title="Cobertura MIPER" description="Procesos y cargos con matriz de riesgos publicada"
              data={[
                { name: "Procesos", value: pct(risk.coverage.coveredProcesses, risk.coverage.activeProcesses), detail: `${risk.coverage.coveredProcesses} de ${risk.coverage.activeProcesses}` },
                { name: "Cargos", value: pct(risk.coverage.coveredPositions, risk.coverage.activePositions), detail: `${risk.coverage.coveredPositions} de ${risk.coverage.activePositions}` },
              ]}
            />
          )}
          {pdtpByWorksite && pdtpByWorksite.perWorksite.length > 0 && (
            <ThresholdRankingChart
              title="Cumplimiento PDTP por faena" description="Comparativa entre las faenas del alcance"
              data={pdtpByWorksite.perWorksite
                .filter((entry) => entry.indicators !== null)
                .map((entry) => ({
                  name: worksiteNames.get(entry.worksiteId) ?? entry.worksiteId,
                  value: Math.round((entry.indicators!.annual.percent ?? 0) * 100),
                  detail: `${entry.indicators!.annual.executed} de ${entry.indicators!.annual.planned}`,
                }))}
            />
          )}
        </>
      }
    />
  )
}

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
async function FleetSection({ session, scope }: DomainSectionsProps) {
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
    getFleetOverview(session).catch(() => []),
    getUsageMaintenanceAlerts(session).catch(() => []),
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
          <KpiCard icon={<Truck size={16} />} label="Vehículos con actividad" value={String(fleet.length)}
            detail="Con al menos un movimiento registrado · ahora" href="/flota" />
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
              description="Combustible + mantención por km o por hora — últimos 12 meses"
              unit="" format="clp" invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={costPerUse}
            />
          )}
        </>
      }
    />
  )
}


// ── Control preventivo en terreno ────────────────────────────────────────────

/**
 * Los seis dominios que no tenían representación: inspecciones, permisos de
 * trabajo, simulacros, acuerdos del comité, higiene y gestión del cambio.
 *
 * Van en **una** sección y no en seis: comparten la pregunta "¿el control
 * preventivo se está ejecutando en terreno?", y seis secciones más habrían
 * devuelto la pantalla al muro que esta auditoría desarmó. Todas sus cifras son
 * estado actual, así que ninguna hereda el período del alcance.
 */
async function FieldControlSection({ session, scope }: DomainSectionsProps) {
  const field = await getFieldControlSummary(session, scopedWorksiteId(scope))

  const permitTotal = field.permitsActive + field.permitsSuspended
  const drillTotal = field.drillsCompleted

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.terreno}
      links={[
        { label: "Inspecciones", href: "/prevencion/inspecciones" },
        { label: "Permisos", href: "/prevencion/permisos" },
        { label: "CPHS", href: "/prevencion/cphs" },
      ]}
      kpis={
        <>
          <KpiCard icon={<ClipboardText size={16} />} label="Cumplimiento de inspecciones"
            value={field.inspectionCompliance === null ? "—" : `${field.inspectionCompliance}%`}
            detail={field.inspectionsReviewed > 0 ? `${field.inspectionsReviewed} revisadas · ahora` : "Sin inspecciones con resultado"}
            href="/prevencion/inspecciones" />
          <KpiCard icon={<WarningOctagon size={16} />} label="Hallazgos críticos abiertos"
            value={String(field.criticalFindingsOpen)}
            detail={field.criticalFindingsOpen > 0 ? "Criticidad alta o crítica · ahora" : "Ninguno abierto, ahora"}
            tone={field.criticalFindingsOpen > 0 ? "danger" : "neutral"} href="/prevencion/inspecciones?vista=critical" />
          <KpiCard icon={<Siren size={16} />} label="Simulacros por mejorar"
            value={String(field.drillsNeedingImprovement)}
            detail={drillTotal > 0 ? `De ${drillTotal} ejecutado(s) · ahora` : "Sin simulacros ejecutados"}
            tone={field.drillsNeedingImprovement > 0 ? "signal" : "neutral"} href="/prevencion/emergencias?tab=drills&vista=needs_improvement" />
          <KpiCard icon={<ShieldWarning size={16} />} label="Mediciones sobre el límite"
            value={String(field.measurementsAboveLimit)}
            detail={field.measurementsAboveLimit > 0 ? "Exposición sobre el límite permisible · ahora" : "Ninguna sobre el límite"}
            tone={field.measurementsAboveLimit > 0 ? "danger" : "neutral"} href="/prevencion/higiene?tab=groups&vista=above_limit" />
        </>
      }
      summary={<SummaryBar stats={fieldControlSummaryStats(field)} />}
      charts={
        permitTotal > 0 || drillTotal > 0 ? (
          <>
            {permitTotal > 0 && (
              <StatusShareBar
                title="Permisos de trabajo por estado" description="Reparto entre activos y suspendidos, ahora"
                data={[
                  { key: "active", label: "Activos", value: field.permitsActive, color: CHART_COLORS.brand },
                  { key: "suspended", label: "Suspendidos", value: field.permitsSuspended, color: CHART_COLORS.signal },
                ]}
              />
            )}
            {drillTotal > 0 && (
              <StatusShareBar
                title="Resultado de los simulacros" description="Ejecutados, por resultado registrado"
                data={[
                  { key: "ok", label: "Satisfactorios", value: Math.max(0, drillTotal - field.drillsNeedingImprovement), color: CHART_COLORS.brand },
                  { key: "mejora", label: "Por mejorar", value: field.drillsNeedingImprovement, color: CHART_COLORS.signal },
                ]}
              />
            )}
          </>
        ) : null
      }
    />
  )
}

function fieldControlSummaryStats(field: Awaited<ReturnType<typeof getFieldControlSummary>>): SummaryStat[] {
  return [
    {
      key: "permits-active",
      // "Permisos" a secas es ambiguo en una sección que también habla de
      // inspecciones, simulacros y mediciones: el dominio es permiso de trabajo.
      label: "Permisos de trabajo activos",
      value: field.permitsActive,
      secondary: field.permitsSuspended > 0 ? `${field.permitsSuspended} suspendido(s) · ahora` : "Ninguno suspendido, ahora",
      href: "/prevencion/permisos",
    },
    {
      key: "committee-agreements",
      label: "Acuerdos del comité abiertos",
      value: field.committeeAgreementsOpen,
      secondary: "Sin cerrar ni derivar a CAPA · ahora",
      href: "/prevencion/cphs",
      tone: "signal",
    },
    {
      key: "change-open",
      label: "Gestión del cambio abierta",
      value: field.changeRequestsOpen,
      secondary: "Cambios sin cerrar · ahora",
      href: "/prevencion/gestion-cambio",
      tone: "signal",
    },
  ]
}

// ── Cumplimiento y gobernanza ────────────────────────────────────────────────

async function GovernanceSection({ session, scope, worksiteScope, worksiteIds }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)

  const [docs, ppa, sstStats, gaps] = await Promise.all([
    has("prevention:docs:view")
      ? getDashboardCounters(worksiteScope, permissions)
      : Promise.resolve(null),
    has("ppa:view") ? getPpaStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("sst:view") ? getDashboardStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("prevention:training:view")
      ? listCompetencyGaps({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => [])
      : Promise.resolve([]),
  ])

  const blockingGaps = gaps.filter((gap) => gap.enforcement === "blocking").length
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.gobernanza}
      links={[
        { label: "Documentación", href: "/prevencion/documentacion" },
        { label: "Capacitación", href: "/prevencion/capacitacion" },
        { label: "PPA", href: "/prevencion/ppa" },
      ]}
      kpis={
        <>
          <KpiCard icon={<FileText size={16} />} label="Documentos por vencer"
            value={String(docs?.expiringSoon.within30 ?? 0)}
            detail={`${docs?.expiringSoon.within7 ?? 0} en 7 días · ${docs?.byStatus.vencido ?? 0} ya vencidos`}
            // El indicador lleva a la lista ya acotada al mismo rango que cuenta:
            // antes anunciaba una urgencia y dejaba al usuario buscándola a mano.
            tone={(docs?.expiringSoon.within7 ?? 0) > 0 ? "signal" : "neutral"} href="/prevencion/documentacion?vence=30" />
          <KpiCard icon={<Certificate size={16} />} label="Acuses pendientes" value={String(docs?.ackPending ?? 0)}
            detail="Distribuciones sin firmar, ahora" href="/prevencion/documentacion" />
          <KpiCard icon={<ShieldWarning size={16} />} label="Brechas de competencia" value={String(blockingGaps)}
            detail={`${gaps.length} en total · ahora`}
            tone={blockingGaps > 0 ? "signal" : "neutral"} href="/prevencion/capacitacion/brechas" />
          <KpiCard icon={<Siren size={16} />} label="Desviaciones PPA"
            value={ppa ? `${Math.round(ppa.porcentajeDesviaciones)}%` : "—"}
            detail={ppa ? `${ppa.detenidos} detenciones de ${ppa.total} · ${periodo}` : "Sin registros PPA"}
            tone={ppa && ppa.detenidos > 0 ? "signal" : "neutral"} href="/prevencion/ppa" />
        </>
      }
      charts={
        <>
          {docs && (
            <CompositionDonutChart
              title="Documentos por estado" description="Cómo se reparte la biblioteca documental SST"
              totalLabel="documentos"
              data={Object.entries(docs.byStatus).map(([status, value]) => ({
                key: status, label: status.replace(/_/g, " "), value,
              }))}
            />
          )}
          {sstStats && (
            <StatusShareBar
              title="Evaluaciones SST de trabajador" description="Reparto entre habilitados y no habilitados"
              data={[
                { key: "habilitados", label: "Habilitados", value: sstStats.habilitados, color: CHART_COLORS.brand },
                { key: "noHabilitados", label: "No habilitados", value: sstStats.noHabilitados, color: CHART_COLORS.danger },
                { key: "borrador", label: "En borrador", value: sstStats.borrador, color: CHART_COLORS.neutral },
              ]}
            />
          )}
        </>
      }
    />
  )
}

// ── Orquestador ──────────────────────────────────────────────────────────────

export const SECTION_BY_DOMAIN: Record<DashboardDomainKey, (props: DomainSectionsProps) => Promise<React.JSX.Element>> = {
  finanzas: FinanceSection,
  adquisiciones: AcquisitionsSection,
  bodega: WarehouseSection,
  prevencion: PreventionSection,
  flota: FleetSection,
  terreno: FieldControlSection,
  gobernanza: GovernanceSection,
}

/**
 * La sección del dominio activo. Una, no seis.
 *
 * `DashboardDomainSections` montaba las seis con un `Suspense` cada una: la de
 * Adquisiciones sola dispara ~20 consultas, y se pagaban todas en cada carga
 * aunque el usuario mirara Prevención.
 */
export function DashboardDomainSection({ domain, ...props }: DomainSectionsProps & { domain: DashboardDomainKey }) {
  const Section = SECTION_BY_DOMAIN[domain]
  return <Section {...props} />
}
