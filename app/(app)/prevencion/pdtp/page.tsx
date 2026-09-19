import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  getPdtpAggregatedSheetViewByProgram,
  getPdtpComplianceByCategoryForScope,
  getPdtpComplianceIndicatorsForScope,
  listActionsByProgram,
  listPdtpProgramWorksites,
  listPdtpPrograms,
  resolveProgramWorksiteIds,
  type PdtpComplianceIndicators,
} from "@/lib/services/prevention-pdtp"
import { isPdtpActionOpen } from "@/lib/services/pdtp/checklist-domain"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod, type PdtpPeriod } from "@/lib/services/pdtp/period"
import { getLatestPdtpPeriodClosure } from "@/lib/services/pdtp/period-closures"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/ui/kpi-card"
import { ChartBar, ListChecks, Plus, ShieldCheck, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { countOf } from "@/lib/utils"
import { resolvePdtpYear, resolveSelectedWorksiteId } from "./pdtp-context"
import { PdtpWorksitePicker, PdtpYearPicker } from "./pdtp-sheet-table-ui"
import {
  type MonthlyTrendData,
  type WorksiteComplianceData,
  type CategoryBreakdownData,
} from "./pdtp-dashboard-charts"
import { PdtpDashboardChartsLazy } from "./pdtp-dashboard-charts-lazy"
import { pdtpProgramStatusLabel } from "@/lib/prevention/pdtp"
import { CreatePdtpRevisionButton } from "./[programId]/create-pdtp-revision-button"

export const metadata: Metadata = { title: "Dashboard de Cumplimiento (PDTP SG-SST)" }

type PdtpDashboardPageProps = {
  searchParams: Promise<{ faena?: string | string[]; anio?: string | string[] }>
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]
const one = (value?: string | string[]) => Array.isArray(value) ? value[0] : value
const activitiesHref = (programId: string, year: number, worksiteId: string | undefined, view: "semana" | "anual", status?: string, period?: PdtpPeriod) => {
  const params = new URLSearchParams({ programa: programId, anio: String(year), vista: view })
  if (worksiteId) params.set("faena", worksiteId)
  if (status) params.set("estado", status)
  if (period) {
    params.set("mes", String(period.month))
    params.set("semana", String(period.week))
  }
  return `/prevencion/pdtp/actividades?${params}`
}

export default async function PdtpDashboardPage({ searchParams }: PdtpDashboardPageProps) {
  let session
  try {
    session = await requireAuth()
  } catch {
    redirect("/forbidden")
  }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const requestedWorksite = one(query.faena)
  const requestedYear = one(query.anio)

  const year = resolvePdtpYear(requestedYear)
  const canManageProgram = can(session, "prevention:pdtp:program:manage")

  const scope = resolveWorksiteScope(session)
  const worksiteScopeIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const scopedWorksites = await listScopedWorksites(worksiteScopeIds)
  let selectedWorksiteId = resolveSelectedWorksiteId(requestedWorksite, scopedWorksites)

  // Programa del período. Con varios programas y ninguno activo NO se elige
  // silenciosamente una versión: se pide elegir (la portada anterior mostraba
  // el selector por la misma razón, y mostrar los números de un borrador
  // arbitrario rotulado "Programa activo" es peor que no mostrar nada).
  const [activeProgram, programsForYear, allPrograms] = await Promise.all([
    getActivePdtpProgram(year),
    listPdtpPrograms({ year }),
    listPdtpPrograms(),
  ])
  const focusProgram = activeProgram ?? (programsForYear.length === 1 ? programsForYear[0]! : null)
  const mustChooseProgram = !focusProgram && programsForYear.length > 1
  const currentPeriod = currentPdtpPeriod()
  let effectiveWorksites = scopedWorksites
  let hasUndeclaredActiveScope = false
  if (focusProgram) {
    const members = await listPdtpProgramWorksites(focusProgram.id)
    hasUndeclaredActiveScope = focusProgram.status === "active"
      && !focusProgram.appliesToAllWorksites
      && members.length === 0
    const effectiveIds = new Set(resolveProgramWorksiteIds(
      members.map((member) => member.worksiteId),
      scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [],
      scopedWorksites.map((worksite) => worksite.id),
      focusProgram.appliesToAllWorksites,
    ))
    effectiveWorksites = scopedWorksites.filter((worksite) => effectiveIds.has(worksite.id))
    selectedWorksiteId = resolveSelectedWorksiteId(requestedWorksite, effectiveWorksites)
  }

  let indicators: PdtpComplianceIndicators | null = null
  let actions: Awaited<ReturnType<typeof listActionsByProgram>> = []
  let monthlyTrendData: MonthlyTrendData[] = []
  let worksiteComplianceData: WorksiteComplianceData[] = []
  let categoryBreakdownData: CategoryBreakdownData[] = []

  if (focusProgram) {
    // UX-01: `getPdtpComplianceIndicators` sin faena deja `executed` en 0 aunque
    // exista avance real (loadProgramScheduleAndExecutions no agrega ejecuciones
    // sin faena). El agregado se pide sobre las faenas autorizadas del usuario,
    // y el mismo fan-out alimenta la comparativa por faena — antes se recalculaba
    // una vez por faena en un segundo round-trip.
    const [scopeIndicators, categoryRes, actRes] = await Promise.all([
      getPdtpComplianceIndicatorsForScope(focusProgram.id, effectiveWorksites.map((w) => w.id)),
      // Sigue a la faena elegida, como el resto de los KPI. La comparativa por
      // faena es el único gráfico que mira siempre todo el alcance.
      getPdtpComplianceByCategoryForScope(
        focusProgram.id,
        selectedWorksiteId ? [selectedWorksiteId] : effectiveWorksites.map((w) => w.id),
      ),
      listActionsByProgram(focusProgram.id, effectiveWorksites.map((worksite) => worksite.id), {
        worksiteId: selectedWorksiteId,
      }),
    ])

    // Con faena elegida se usa su desglose; sin faena, el agregado del alcance.
    indicators = selectedWorksiteId
      ? scopeIndicators?.perWorksite.find((entry) => entry.worksiteId === selectedWorksiteId)?.indicators ?? null
      : scopeIndicators
    actions = actRes

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
      const worksite = effectiveWorksites.find((w) => w.id === entry.worksiteId)
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

  const currentMonthNum = currentPeriod.month
  const currentMonthData = indicators?.monthly.find((m) => m.month === currentMonthNum)

  // `PDTP_ESTADOS_CERRADOS` es la constante del dominio (completado/verificado/
  // cancelado) que ya usan el cumplimiento integral y el cálculo de vencidas.
  // Antes esto filtraba por "verificada", que no es un valor del enum —el filtro
  // no excluía nada y el tile contaba el 100 % de las acciones.
  const openActionsCount = actions.filter((a) => isPdtpActionOpen(a.estado)).length
  const overdueActionsCount = actions.filter((a) => a.vencida).length
  const executedCount = indicators?.annual.executed ?? 0
  const pendingCount = Math.max(0, (currentMonthData?.planned ?? 0) - (currentMonthData?.executed ?? 0))
  // Expone cuántas de las pendientes del mes vigente no tienen NINGUNA
  // ejecución aprobada (distinto de "no llegó al 100%"): el % mensual puede
  // compensar una actividad sobreejecutada con otra en cero y marcar el mes
  // en 100%, así que este número es el que de verdad dice si algo quedó sin
  // tocar (tarea 1.4, no cambia la fórmula de `percent`).
  const zeroActivitiesThisMonth = currentMonthData?.zeroActivities ?? 0
  const zeroActivitiesLabel = countOf(zeroActivitiesThisMonth, "actividad en cero", "actividades en cero")
  // Sin faena elegida, `zeroActivitiesThisMonth` es la UNIÓN entre las faenas
  // autorizadas (`getPdtpComplianceIndicatorsForScope`): una actividad cuenta
  // una vez aunque esté en cero en varias faenas a la vez. Sin esta
  // aclaración, "N actividades en cero" se lee como "N faena-mes en cero".
  const zeroActivitiesQualifier = selectedWorksiteId ? "" : " en al menos una faena"
  // Último mes congelado del programa, en el alcance del usuario: responde
  // "¿hasta dónde llega la evidencia firmada?" sin abrir la pantalla de cierres.
  const latestClosure = focusProgram
    ? await getLatestPdtpPeriodClosure(focusProgram.id, effectiveWorksites.map((worksite) => worksite.id))
    : null

  const aggregateForKpis = focusProgram
    ? await getPdtpAggregatedSheetViewByProgram(focusProgram.id, "pdtp_general", effectiveWorksites.map((worksite) => worksite.id), currentPeriod)
    : null
  const overdueActivityCount = aggregateForKpis?.activities.filter((activity) => activity.worksiteSummaries.some((summary) => summary.status === "overdue")).length ?? 0

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard de Cumplimiento SG-SST"
        description={`Avance operacional del Programa de Trabajo Preventivo ${year}. Monitoreo general y por faena.`}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Prevención", href: "/prevencion" },
              { label: "Programa de trabajo" },
            ]}
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={focusProgram ? activitiesHref(focusProgram.id, year, selectedWorksiteId, "anual", undefined, currentPeriod) : `/prevencion/pdtp/actividades?anio=${year}`}>Ver actividades</Link>
            </Button>
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
          <PdtpYearPicker current={year} years={allPrograms.map((program) => program.year)} hrefBase="/prevencion/pdtp" worksiteId={selectedWorksiteId} />
          <PdtpWorksitePicker
            current={selectedWorksiteId}
            sheetCode="pdtp_general"
            worksites={effectiveWorksites}
          />
          {focusProgram && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {activeProgram ? "Programa activo" : "Programa en borrador"}:{" "}
              <strong className="font-semibold text-[var(--color-text)]">{focusProgram.title} <span className="font-mono text-xs font-normal text-[var(--color-text-muted)]">v{focusProgram.version}</span></strong>
            </span>
          )}
          {focusProgram && (
            <span className="text-xs text-[var(--color-text-muted)]">
              Último cierre:{" "}
              {latestClosure
                ? (
                  <Link href={`/prevencion/pdtp/${focusProgram.id}/cierres`} className="font-semibold text-[var(--color-text)] hover:underline">
                    {`${String(latestClosure.month).padStart(2, "0")}/${latestClosure.year}`}
                  </Link>
                )
                : <strong className="font-semibold text-[var(--color-text)]">ningún mes cerrado</strong>}
            </span>
          )}
        </div>
        {focusProgram && (
          <Link
            href={activitiesHref(focusProgram.id, year, selectedWorksiteId, "anual", undefined, currentPeriod)}
            className="inline-flex min-h-11 sm:min-h-0 items-center text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Ver actividades del programa →
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
                  <span className="font-medium text-[var(--color-text)]">{program.title} <span className="font-mono text-xs font-normal text-[var(--color-text-muted)]">v{program.version}</span></span>
                  <span className="text-xs text-[var(--color-text-muted)]">{pdtpProgramStatusLabel(program.status)}</span>
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
      ) : effectiveWorksites.length === 0 ? (
        hasUndeclaredActiveScope ? (
          <div className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-4 py-8 text-center shadow-xs" role="alert">
            <p className="font-semibold text-[var(--color-warning-ink)]">Alcance de faenas no declarado</p>
            <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--color-text-muted)]">
              La versión activa no tiene faenas asignadas ni declara alcance corporativo. No recibirá nuevas acreditaciones hasta que una revisión v+1 defina su cobertura.
            </p>
            <div className="mt-4">
              {canManageProgram
                ? <CreatePdtpRevisionButton sourceProgramId={focusProgram.id} />
                : <span className="text-xs text-[var(--color-text-subtle)]">Solicita a quien administra el programa que cree la revisión v+1.</span>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center shadow-xs">
            <p className="font-semibold text-[var(--color-text)]">Sin faenas asignadas a tu usuario</p>
            <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--color-text-muted)]">
              El cumplimiento se calcula sobre las faenas que tienes autorizadas y hoy no
              tienes ninguna. Pide a un administrador que te asigne al menos una faena.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          {/* 4 Tiles KPI Principales */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Ejecutadas"
              value={String(executedCount)}
              detail={`Ejecuciones registradas en ${year}`}
              icon={<ShieldCheck size={22} className="text-[var(--color-success-ink)]" />}
              href={focusProgram ? activitiesHref(focusProgram.id, year, selectedWorksiteId, "anual", "executed", currentPeriod) : undefined}
            />
            <KpiCard
              label="Pendientes"
              value={String(pendingCount)}
              // Primero explica lo que muestra el tile (una cantidad de
              // instancias programadas sin ejecutar este mes); las
              // actividades en cero van como dato secundario, con
              // singular/plural correcto — antes decía "1 actividades".
              detail={`Programadas sin ejecutar este mes · ${zeroActivitiesLabel}${zeroActivitiesQualifier}`}
              icon={<ChartBar size={22} className="text-[var(--color-primary)]" />}
              // "en_cero" (pending ∪ overdue), el mismo destino que la
              // columna "En cero" del panel de indicadores cuando hablan del
              // mismo mes: antes este tile enlazaba a "pending" a secas y
              // dejaba fuera las atrasadas, que también están en cero.
              href={focusProgram ? activitiesHref(focusProgram.id, year, selectedWorksiteId, "semana", "en_cero", currentPeriod) : undefined}
            />
            {/* Reemplaza el conteo de faenas, que no cambiaba ninguna decisión
                (regla A1). El integral pondera ejecución + verificación de
                checklist + cierre de acciones, y solo está definido por faena. */}
            <KpiCard
              label="Atrasadas"
              value={String(overdueActivityCount)}
              detail="Actividades que requieren revisión prioritaria"
              icon={<ListChecks size={22} className="text-[var(--color-info-ink)]" />}
              href={focusProgram ? activitiesHref(focusProgram.id, year, selectedWorksiteId, "semana", "overdue", currentPeriod) : undefined}
            />
            <KpiCard
              label="Acciones Pendientes"
              value={String(openActionsCount)}
              detail={overdueActionsCount > 0 ? countOf(overdueActionsCount, "acción vencida", "acciones vencidas") : "Sin hallazgos vencidos"}
              icon={
                <WarningCircle
                  size={22}
                  className={overdueActionsCount > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-warning-ink)]"}
                />
              }
              href={focusProgram ? `/prevencion/pdtp/acciones?programa=${focusProgram.id}&anio=${year}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}${overdueActionsCount > 0 ? "&vencidas=1" : "&estado=abierta"}` : "/prevencion/pdtp/acciones"}
            />
          </div>

          {/* Gráficos Shadcn (Recharts) */}
          <PdtpDashboardChartsLazy
            monthlyTrend={monthlyTrendData}
            worksiteCompliance={worksiteComplianceData}
            categoryBreakdown={categoryBreakdownData}
            operationalHref={focusProgram ? activitiesHref(focusProgram.id, year, selectedWorksiteId, "semana", "pending", currentPeriod) : "/prevencion/pdtp/actividades"}
          />
        </div>
      )}
    </PageContainer>
  )
}
