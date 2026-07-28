import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  getPdtpComplianceByCategoryForScope,
  getPdtpComplianceIndicatorsForScope,
  getPdtpIntegralCompliance,
  getPdtpIntegralComplianceForScope,
  listActionsByProgram,
  listPdtpPrograms,
  type PdtpComplianceIndicators,
  type PdtpIntegralCompliance,
} from "@/lib/services/prevention-pdtp"
import { isPdtpActionOpen } from "@/lib/services/pdtp/checklist-domain"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/ui/kpi-card"
import { ChartBar, ListChecks, Plus, ShieldCheck, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { resolvePdtpYear, resolveSelectedWorksiteId } from "./pdtp-context"
import { PdtpWorksitePicker } from "./pdtp-sheet-table-ui"
import {
  getCanonicalSafetyIndicatorYear,
  getMaterialEnvironmentalEvents,
  getIncidentAnalyticsData,
} from "@/lib/services/prevention-indicadores"
import {
  PdtpDashboardCharts,
  type MonthlyTrendData,
  type WorksiteComplianceData,
  type CategoryBreakdownData,
  type SstPoint,
  type MaterialEnvPoint,
  type CommonAccidentPoint,
  type WorksiteIncidentPoint,
  type PotentialSeverityPoint,
} from "./pdtp-dashboard-charts"

export const metadata: Metadata = { title: "Dashboard de Cumplimiento — PDTP SG-SST" }

type PdtpDashboardPageProps = {
  searchParams: Promise<{ faena?: string | string[]; anio?: string | string[] }>
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]

export default async function PdtpDashboardPage({ searchParams }: PdtpDashboardPageProps) {
  let session
  try {
    session = await requireAuth()
  } catch {
    redirect("/forbidden")
  }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v)
  const requestedWorksite = one(query.faena)
  const requestedYear = one(query.anio)

  const year = resolvePdtpYear(requestedYear)
  const canManageProgram = can(session, "prevention:pdtp:program:manage")

  const scope = resolveWorksiteScope(session)
  const worksiteScopeIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const scopedWorksites = await listScopedWorksites(worksiteScopeIds)
  const selectedWorksiteId = resolveSelectedWorksiteId(requestedWorksite, scopedWorksites)

  // Programa del período. Con varios programas y ninguno activo NO se elige
  // silenciosamente una versión: se pide elegir (la portada anterior mostraba
  // el selector por la misma razón, y mostrar los números de un borrador
  // arbitrario rotulado "Programa activo" es peor que no mostrar nada).
  const [activeProgram, programsForYear] = await Promise.all([
    getActivePdtpProgram(year),
    listPdtpPrograms({ year }),
  ])
  const focusProgram = activeProgram ?? (programsForYear.length === 1 ? programsForYear[0]! : null)
  const mustChooseProgram = !focusProgram && programsForYear.length > 1

  let indicators: PdtpComplianceIndicators | null = null
  let integral: PdtpIntegralCompliance | null = null
  let actions: Awaited<ReturnType<typeof listActionsByProgram>> = []
  let monthlyTrendData: MonthlyTrendData[] = []
  let worksiteComplianceData: WorksiteComplianceData[] = []
  let categoryBreakdownData: CategoryBreakdownData[] = []
  let sstPoints: SstPoint[] = []
  let materialEnvPoints: MaterialEnvPoint[] = []
  let commonAccidentsData: CommonAccidentPoint[] = []
  let worksiteIncidentsData: WorksiteIncidentPoint[] = []
  let potentialSeverityData: PotentialSeverityPoint[] = []

  if (focusProgram) {
    // UX-01: `getPdtpComplianceIndicators` sin faena deja `executed` en 0 aunque
    // exista avance real (loadProgramScheduleAndExecutions no agrega ejecuciones
    // sin faena). El agregado se pide sobre las faenas autorizadas del usuario,
    // y el mismo fan-out alimenta la comparativa por faena — antes se recalculaba
    // una vez por faena en un segundo round-trip.
    const [scopeIndicators, integralRes, categoryRes, actRes, sstYearView, envEventsData, incidentAnalytics] = await Promise.all([
      getPdtpComplianceIndicatorsForScope(focusProgram.id, scopedWorksites.map((w) => w.id)),
      // Sin faena elegida el integral se agrega sobre el alcance del usuario.
      // No es el promedio de los integrales por faena: verificación es un
      // promedio de checklists y cierre un ratio de acciones, así que ambos ejes
      // se recalculan sobre las filas crudas de todas las faenas.
      selectedWorksiteId
        ? getPdtpIntegralCompliance(focusProgram.id, selectedWorksiteId)
        : getPdtpIntegralComplianceForScope(focusProgram.id, scopedWorksites.map((w) => w.id)),
      // Sigue a la faena elegida, como el resto de los KPI. La comparativa por
      // faena es el único gráfico que mira siempre todo el alcance.
      getPdtpComplianceByCategoryForScope(
        focusProgram.id,
        selectedWorksiteId ? [selectedWorksiteId] : scopedWorksites.map((w) => w.id),
      ),
      listActionsByProgram(focusProgram.id, {
        worksiteId: selectedWorksiteId,
        scope: worksiteScopeIds,
      }),
      getCanonicalSafetyIndicatorYear(year, scope).catch(() => null),
      getMaterialEnvironmentalEvents(year, scope).catch(() => null),
      getIncidentAnalyticsData(year, scope).catch(() => null),
    ])

    // Con faena elegida se usa su desglose; sin faena, el agregado del alcance.
    indicators = selectedWorksiteId
      ? scopeIndicators?.perWorksite.find((entry) => entry.worksiteId === selectedWorksiteId)?.indicators ?? null
      : scopeIndicators
    integral = integralRes
    actions = actRes

    if (incidentAnalytics) {
      commonAccidentsData = incidentAnalytics.commonAccidents
      worksiteIncidentsData = incidentAnalytics.worksiteIncidents
      potentialSeverityData = incidentAnalytics.potentialSeverity
    }

    if (sstYearView) {
      const targetWorksiteId = selectedWorksiteId || "total"
      const group = sstYearView.groups.find((g) => g.worksiteId === targetWorksiteId) || sstYearView.groups.find((g) => g.worksiteId === "total")
      if (group) {
        // Solo TF y TG, que es lo que el gráfico grafica. No se derivan series
        // de "accidentes con/sin tiempo perdido" del eje confirmed/provisional:
        // ese eje es certeza de clasificación, no tiempo perdido — todos los
        // casos del motor canónico ya son con tiempo perdido
        // (`absenceAtLeastNormalShift`) y `provisional` contiene a `confirmed`.
        sstPoints = group.monthly.map((m, i) => ({
          monthName: MONTH_NAMES[i] ?? `M${i + 1}`,
          tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
          tasaGravedad: m.confirmed.severityRate ?? 0,
        }))
      }
    }

    if (envEventsData) {
      const targetWorksiteId = selectedWorksiteId || "total"
      const eventItem = envEventsData.eventData.find((e) => e.worksiteId === targetWorksiteId) || envEventsData.eventData.find((e) => e.worksiteId === "total")
      if (eventItem) {
        materialEnvPoints = eventItem.monthly.map((m) => ({
          monthName: MONTH_NAMES[m.month - 1] ?? `M${m.month}`,
          dangerousIncidents: m.dangerousIncidents,
          materialDamage: m.materialDamage,
          environmentalSpills: m.environmentalSpills,
        }))
      }
    }

    // 1. Datos para gráfico de tendencia mensual
    if (indicators?.monthly) {
      monthlyTrendData = indicators.monthly.map((m) => ({
        monthName: MONTH_NAMES[m.month - 1] ?? `M${m.month}`,
        scheduled: m.planned,
        executed: m.executed,
        compliancePercent: m.percent !== null ? Math.round(m.percent * 100) : 0,
      }))
    }

    // 2. Comparativa por faena — reusa el desglose que ya trajo el agregado.
    worksiteComplianceData = (scopeIndicators?.perWorksite ?? []).map((entry) => {
      const worksite = scopedWorksites.find((w) => w.id === entry.worksiteId)
      const percent = entry.indicators?.annual.percent
      return {
        name: worksite?.name ?? entry.worksiteId,
        percent: percent != null ? Math.round(percent * 100) : 0,
        executed: entry.indicators?.annual.executed ?? 0,
        scheduled: entry.indicators?.annual.planned ?? 0,
      }
    })

    // 3. Avance por eje SG-SST, con ejecuciones aprobadas reales agrupadas por
    // hoja. La versión anterior prorrateaba el ratio global entre categorías, lo
    // que mezclaba nº de actividades con cantidades e inventaba el ejecutado.
    categoryBreakdownData = (categoryRes ?? []).map((entry) => ({
      category: entry.category,
      scheduled: entry.planned,
      executed: entry.executed,
      percent: entry.percent !== null ? Math.round(entry.percent * 100) : 0,
    }))
  }

  const annualPercent = indicators?.annual.percent !== null && indicators?.annual.percent !== undefined
    ? Math.round(indicators.annual.percent * 100)
    : 0

  const currentMonthNum = currentPdtpPeriod().month
  const currentMonthData = indicators?.monthly.find((m) => m.month === currentMonthNum)
  const currentMonthPercent = currentMonthData?.percent !== null && currentMonthData?.percent !== undefined
    ? Math.round(currentMonthData.percent * 100)
    : 0

  // `PDTP_ESTADOS_CERRADOS` es la constante del dominio (completado/verificado/
  // cancelado) que ya usan el cumplimiento integral y el cálculo de vencidas.
  // Antes esto filtraba por "verificada", que no es un valor del enum —el filtro
  // no excluía nada y el tile contaba el 100 % de las acciones.
  const openActionsCount = actions.filter((a) => isPdtpActionOpen(a.estado)).length
  const overdueActionsCount = actions.filter((a) => a.vencida).length
  const integralPercent = integral?.integral != null ? Math.round(integral.integral) : null

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard de Cumplimiento SG-SST"
        description={`Avance operacional del Programa de Trabajo Preventivo ${year}. Monitoreo general y por faena.`}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Prevención", href: "/prevencion" },
              { label: "Programa de trabajo (PDTP)" },
            ]}
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/prevencion/pdtp/programas">Listado de programas</Link>
            </Button>
            {canManageProgram && (
              <Button asChild size="sm">
                <Link href="/prevencion/pdtp/nuevo">
                  <Plus size={14} />
                  Nuevo programa
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Barra de Filtros Primarios */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-4">
          <PdtpWorksitePicker
            current={selectedWorksiteId}
            sheetCode="pdtp_general"
            worksites={scopedWorksites}
          />
          {focusProgram && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {activeProgram ? "Programa activo" : "Programa en borrador"}:{" "}
              <strong className="font-semibold text-[var(--color-text)]">{focusProgram.title}</strong> (v{focusProgram.version})
            </span>
          )}
        </div>
        {focusProgram && (
          <Link
            href={`/prevencion/pdtp/${focusProgram.id}`}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Ver matriz detallada de actividades →
          </Link>
        )}
      </div>

      {mustChooseProgram ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 shadow-xs">
          <p className="text-center font-semibold text-[var(--color-text)]">Hay {programsForYear.length} programas para {year} y ninguno activo</p>
          <p className="mx-auto mt-1 max-w-prose text-center text-sm text-[var(--color-text-muted)]">
            Elige cuál quieres revisar. No se muestra un tablero agregado porque las
            cifras de un borrador no representan el cumplimiento del período.
          </p>
          <ul className="mx-auto mt-4 grid max-w-2xl gap-2">
            {programsForYear.map((program) => (
              <li key={program.id}>
                <Link
                  href={`/prevencion/pdtp/${program.id}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  <span className="font-medium text-[var(--color-text)]">{program.title}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">v{program.version} · {program.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : !focusProgram ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center shadow-xs">
          <p className="font-semibold text-[var(--color-text)]">Sin programa para {year}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            No hay programas de trabajo preventivo registrados para este año.
          </p>
          {canManageProgram && (
            <Button asChild className="mt-4" size="sm">
              <Link href="/prevencion/pdtp/nuevo">Crear programa para {year}</Link>
            </Button>
          )}
        </div>
      ) : scopedWorksites.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center shadow-xs">
          <p className="font-semibold text-[var(--color-text)]">Sin faenas asignadas a tu usuario</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--color-text-muted)]">
            El cumplimiento se calcula sobre las faenas que tienes autorizadas y hoy no
            tienes ninguna. Pide a un administrador que te asigne al menos una faena.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 4 Tiles KPI Principales */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Cumplimiento Anual"
              value={`${annualPercent}%`}
              detail={
                selectedWorksiteId
                  ? `${indicators?.annual.executed ?? 0} de ${indicators?.annual.planned ?? 0} ejecuciones`
                  : `${indicators?.annual.executed ?? 0} de ${indicators?.annual.planned ?? 0} ejecuciones · ${scopedWorksites.length} faena${scopedWorksites.length === 1 ? "" : "s"}`
              }
              icon={<ShieldCheck size={22} className="text-[var(--color-success)]" />}
            />
            <KpiCard
              label="Avance Mes Vigente"
              value={`${currentMonthPercent}%`}
              detail={`Mes ${currentMonthNum}: ${currentMonthData?.executed ?? 0}/${currentMonthData?.planned ?? 0} ejecuciones`}
              icon={<ChartBar size={22} className="text-[var(--color-primary)]" />}
            />
            {/* Reemplaza el conteo de faenas, que no cambiaba ninguna decisión
                (regla A1). El integral pondera ejecución + verificación de
                checklist + cierre de acciones, y solo está definido por faena. */}
            <KpiCard
              label="Cumplimiento Integral"
              value={integralPercent !== null ? `${integralPercent}%` : "—"}
              detail={
                integralPercent !== null
                  ? `Ejec. ${Math.round((integral?.ejecucion ?? 0) * 100)}% · Verif. ${Math.round(integral?.verificacion ?? 0)}% · Cierre ${Math.round(integral?.cierre ?? 0)}%`
                  : "Sin ejecuciones aprobadas todavía"
              }
              icon={<ListChecks size={22} className="text-[var(--color-info)]" />}
            />
            <KpiCard
              label="Acciones Pendientes"
              value={String(openActionsCount)}
              detail={overdueActionsCount > 0 ? `${overdueActionsCount} acciones vencidas` : "Sin hallazgos vencidos"}
              icon={
                <WarningCircle
                  size={22}
                  className={overdueActionsCount > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"}
                />
              }
            />
          </div>

          {/* Gráficos Shadcn (Recharts) */}
          <PdtpDashboardCharts
            monthlyTrend={monthlyTrendData}
            worksiteCompliance={worksiteComplianceData}
            categoryBreakdown={categoryBreakdownData}
            sstPoints={sstPoints}
            materialEnvPoints={materialEnvPoints}
            commonAccidents={commonAccidentsData}
            worksiteIncidents={worksiteIncidentsData}
            potentialSeverity={potentialSeverityData}
          />
        </div>
      )}
    </PageContainer>
  )
}
