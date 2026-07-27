import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  getPdtpComplianceIndicators,
  getPdtpIntegralCompliance,
  listActionsByProgram,
  listPdtpPrograms,
  listPdtpProgramSheets,
  listPdtpProgramActivities,
  type PdtpComplianceIndicators,
  type PdtpIntegralCompliance,
} from "@/lib/services/prevention-pdtp"
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

  // Obtener el programa activo o el último disponible para el año seleccionado
  const activeProgram = (await getActivePdtpProgram(year))
    ?? (await listPdtpPrograms({ year }))[0]
    ?? null

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

  if (activeProgram) {
    const [indRes, actRes, activitiesRes, sstYearView, envEventsData, incidentAnalytics] = await Promise.all([
      getPdtpComplianceIndicators(activeProgram.id, selectedWorksiteId),
      listActionsByProgram(activeProgram.id, {
        worksiteId: selectedWorksiteId,
        scope: worksiteScopeIds,
      }),
      listPdtpProgramActivities(activeProgram.id),
      getCanonicalSafetyIndicatorYear(year, scope).catch(() => null),
      getMaterialEnvironmentalEvents(year, scope).catch(() => null),
      getIncidentAnalyticsData(year, scope).catch(() => null),
    ])

    indicators = indRes
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
        sstPoints = group.monthly.map((m, i) => ({
          monthName: MONTH_NAMES[i] ?? `M${i + 1}`,
          tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
          tasaGravedad: m.confirmed.severityRate ?? 0,
          accConTiempoPerdido: m.confirmed.accidents ?? 0,
          accSinTiempoPerdido: m.provisional.accidents ?? 0,
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

    // 2. Datos para gráfico de cumplimiento por faena (comparativa)
    if (scopedWorksites.length > 0) {
      const worksiteIndicators = await Promise.all(
        scopedWorksites.map(async (ws) => {
          const res = await getPdtpComplianceIndicators(activeProgram.id, ws.id)
          const pct = res?.annual.percent !== null && res?.annual.percent !== undefined
            ? Math.round(res.annual.percent * 100)
            : 0
          return {
            name: ws.name,
            percent: pct,
            executed: res?.annual.executed ?? 0,
            scheduled: res?.annual.planned ?? 0,
          }
        }),
      )
      worksiteComplianceData = worksiteIndicators
    }

    // 3. Desglose por hoja/área SG-SST
    const activitiesBySheet = new Map<string, number>()
    for (const act of activitiesRes) {
      const sheetLabel = act.program ?? "General"
      activitiesBySheet.set(sheetLabel, (activitiesBySheet.get(sheetLabel) ?? 0) + 1)
    }

    categoryBreakdownData = [...activitiesBySheet.entries()].map(([cat, total]) => {
      const executedEst = Math.round(
        (total * (indicators?.annual.executed ?? 0)) / Math.max(indicators?.annual.planned ?? 1, 1),
      )
      return {
        category: cat,
        scheduled: total,
        executed: Math.min(executedEst, total),
        percent: Math.round((Math.min(executedEst, total) / total) * 100),
      }
    })
  }

  const annualPercent = indicators?.annual.percent !== null && indicators?.annual.percent !== undefined
    ? Math.round(indicators.annual.percent * 100)
    : 0

  const currentMonthNum = currentPdtpPeriod().month
  const currentMonthData = indicators?.monthly.find((m) => m.month === currentMonthNum)
  const currentMonthPercent = currentMonthData?.percent !== null && currentMonthData?.percent !== undefined
    ? Math.round(currentMonthData.percent * 100)
    : 0

  const openActionsCount = actions.filter((a) => a.estado !== "verificada").length
  const overdueActionsCount = actions.filter((a) => a.vencida).length

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
          {activeProgram && (
            <span className="text-xs text-[var(--color-text-muted)]">
              Programa activo: <strong className="font-semibold text-[var(--color-text)]">{activeProgram.title}</strong> (v{activeProgram.version})
            </span>
          )}
        </div>
        {activeProgram && (
          <Link
            href={`/prevencion/pdtp/${activeProgram.id}`}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Ver matriz detallada de actividades →
          </Link>
        )}
      </div>

      {!activeProgram ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center shadow-xs">
          <p className="font-semibold text-[var(--color-text)]">Sin programa activo para {year}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            No se encontró un programa de trabajo preventivo vigente para este año.
          </p>
          {canManageProgram && (
            <Button asChild className="mt-4" size="sm">
              <Link href="/prevencion/pdtp/nuevo">Crear programa para {year}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 4 Tiles KPI Principales */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Cumplimiento Anual"
              value={`${annualPercent}%`}
              detail={`${indicators?.annual.executed ?? 0} de ${indicators?.annual.planned ?? 0} ejecuciones`}
              icon={<ShieldCheck size={22} className="text-[var(--color-success)]" />}
            />
            <KpiCard
              label="Avance Mes Vigente"
              value={`${currentMonthPercent}%`}
              detail={`Mes ${currentMonthNum}: ${currentMonthData?.executed ?? 0}/${currentMonthData?.planned ?? 0} ejecuciones`}
              icon={<ChartBar size={22} className="text-[var(--color-primary)]" />}
            />
            <KpiCard
              label="Faenas Autorizadas"
              value={String(scopedWorksites.length)}
              detail={selectedWorksiteId ? "Faena seleccionada activa" : "Todas las faenas en alcance"}
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
