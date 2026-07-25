import type { Metadata } from "next"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { cn, formatCLP } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { CheckCircle, ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr"
import { buildWorkTasks } from "@/lib/work-queue"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getDashboardData, getWorkQueueSnapshot, buildActor } from "@/lib/services/dashboard"
import { MetricBar } from "./metric-bar"
import { QuickActions } from "./quick-actions"
import { RecentActivity } from "./recent-activity"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "./pdtp-compliance-card"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { TaskRow } from "./dashboard-task-row"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const session = await auth()
  if (!session) return null

  const [data, snapshot] = await Promise.all([
    getDashboardData(session),
    getWorkQueueSnapshot(session),
  ])
  const tasks = buildWorkTasks(buildActor(session), snapshot)
  const visibleTasks = tasks.slice(0, 12)
  const stockAlertCount = await getCriticalStockAlertCount()
  const criticalTaskCount = tasks.filter((task) => task.priority === "critical").length
  const deliveryTaskCount = tasks.filter((task) => task.type === "warehouse_delivery").length
  const maxWorksiteCost = Math.max(...data.worksitesBreakdown.map((row) => row.totalCost), 1)

  const approvalRate = data.summary.totalRequests > 0
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  const firstName = session.user.name?.split(" ")[0] ?? "usuario"

  // PDTP compliance summary — sólo si el usuario puede ver el módulo
  const canViewPdtp = can(session, "prevention:pdtp:view")
  const canManagePdtp = can(session, "prevention:pdtp:program:manage")
  const [pdtpSummary, activeProgram, allPrograms] = await Promise.all([
    canViewPdtp
      ? loadPdtpComplianceSummary(scopeToWorksiteIds(resolveWorksiteScope(session)))
      : Promise.resolve(null),
    canViewPdtp ? getActivePdtpProgram(new Date().getFullYear()) : Promise.resolve(null),
    canViewPdtp ? listPdtpPrograms() : Promise.resolve([]),
  ])
  const currentYear = new Date().getFullYear()
  const hasNextYearProgram = allPrograms.some((p) => p.year === currentYear + 1)
  const shouldSuggestNextYear = activeProgram && !hasNextYearProgram && canManagePdtp

  const canViewEpp = can(session, "prevention:epp:view")
  const eppGapsCount = canViewEpp
    ? (await listEppCoverageGaps({ userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }))
        .filter((g) => g.enforcement === "blocking").length
    : 0

  // Los conteos accionables (por aprobar, sin OC, por recibir, alertas de stock) ya viven
  // en la MetricBar de abajo, que es responsive y se ve en desktop y móvil. Duplicarlos en
  // el TopBar (headerActions, solo desktop) creaba dos representaciones del mismo dato.
  return (
    <PageContainer>
      <PageHeader title="Dashboard" />
      <div className="animate-in fade-in duration-[var(--duration-default)]">

      {/* ── Cabecera: saludo + estado ── */}
      <header>
        <p className="text-eyebrow">Tablero</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">Hola, {firstName}</h2>
            {tasks.length > 0 ? (
              <p className="mt-2 text-h2 text-[var(--color-text)]">
                Tienes{" "}
                <span className="text-[var(--color-primary)]">{tasks.length}</span>{" "}
                {tasks.length === 1 ? "tarea pendiente" : "tareas pendientes"} hoy.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="inline-flex items-center gap-2 text-display text-[var(--color-text)]">
                  <CheckCircle size={20} weight="fill" className="text-[var(--color-primary)]" />
                  Todo al día.
                </span>
                <span className="text-sub">Sin pendientes por ahora.</span>
              </div>
            )}
          </div>
          {/* Enlace, no botón relleno: "Nueva solicitud" (abajo) es el único CTA
              primario de la vista. Dos rellenos verdes compitiendo anulaban el
              punto focal, y la cola de tareas ya está inmediatamente debajo —
              esto es un salto de conveniencia, no la acción principal. */}
          {tasks.length > 0 && (
            <Link
              href="/aprobaciones"
              data-pressable
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-[var(--radius)] px-3 sm:self-end",
                "text-[13px] font-semibold text-[var(--color-primary-ink)] underline-offset-4",
                "transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "hover:bg-[var(--color-primary-tint)] hover:underline",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              )}
            >
              Ver tareas
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </header>

      {/* ── Tira de métricas (editorial, sin cajas, por permiso) ── */}
      <div className="mt-6">
        <MetricBar
          session={session}
          pendingTasks={tasks.length}
          criticalTasks={criticalTaskCount}
          pendingApprovals={data.metrics.pending_approvals}
          approvedWithoutOc={data.metrics.approved_without_oc}
          ordersPendingReceipt={data.metrics.orders_pending_receipt}
          deliveryTasks={deliveryTaskCount}
          stockAlerts={stockAlertCount}
          eppGaps={eppGapsCount}
          totalCosts={data.summary.totalCosts}
          approvalRate={approvalRate}
        />
      </div>

      {/* ── Accesos rápidos (toolbar de pills, por rol) ── */}
      <div className="mt-4">
        <QuickActions session={session} />
      </div>

      {/* ── Cumplimiento PDTP (gated por permiso) ── */}
      {canViewPdtp && (
        <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-h2 text-[var(--color-text)]">Programa de Trabajo Preventivo</h2>
            <div className="flex items-center gap-3">
              {pdtpSummary && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Meta anual {Math.round(pdtpSummary.target * 100)}%
                </p>
              )}
              {shouldSuggestNextYear && (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/prevencion/pdtp/nuevo`}>
                    <Plus size={13} />
                    Preparar programa {currentYear + 1}
                  </Link>
                </Button>
              )}
              {!activeProgram && allPrograms.length === 0 && canManagePdtp && (
                <Button asChild size="sm">
                  <Link href={`/prevencion/pdtp/nuevo`}>
                    <Plus size={13} />
                    Crear programa {currentYear}
                  </Link>
                </Button>
              )}
            </div>
          </div>
          {pdtpSummary && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PdtpComplianceCard {...pdtpSummary} />
            </div>
          )}
          {!pdtpSummary && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
              <p className="text-sm text-[var(--color-text-muted)]">
                No hay un programa activo para {currentYear}.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Trabajo: cola con tareas, o actividad reciente sin pendientes ── */}
      {visibleTasks.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {visibleTasks.map((task, i) => (
              <li key={task.id}>
                <TaskRow task={task} index={i} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-8">
          <RecentActivity
            requests={snapshot.requests}
            orders={snapshot.orders}
            viewerId={session.user.id}
            canViewAll={can(session, "requests:view_all")}
          />
        </div>
      )}

      {/* ── Actividad por faena ── */}
      {data.worksitesBreakdown.length > 0 && (
        <section className="mt-8">
          <h2 className="text-h2 text-[var(--color-text)] mb-3">Actividad por faena</h2>
          <div className="overflow-x-auto border-y border-[var(--color-border)]">
              <table className="w-full border-collapse text-left text-[13px]" aria-label="Actividad y costos por faena">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                    <th scope="col" className="px-5 py-3 th-type">Faena</th>
                    <th scope="col" className="px-5 py-3 text-right th-type">Solicitudes</th>
                    <th scope="col" className="px-5 py-3 text-right th-type">Pendientes</th>
                    <th scope="col" className="px-5 py-3 text-right th-type">Aprobadas</th>
                    <th scope="col" className="px-5 py-3 text-right th-type">Total OC</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worksitesBreakdown.map((row, i) => (
                    <tr key={row.id} className={cn(
                      "transition-colors hover:bg-[var(--color-surface-2)]",
                      i > 0 && "border-t border-[var(--color-border)]",
                    )}>
                      <td className="px-5 py-3 font-medium text-[var(--color-text)]">{row.name}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.requestsCount}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">
                        {row.pendingCount > 0
                          ? <span className="font-semibold text-[var(--color-signal-ink)]">{row.pendingCount}</span>
                          : <span className="text-[var(--color-text-faint)]">0</span>}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.approvedCount}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="ml-auto flex max-w-[15rem] flex-col items-end gap-1.5">
                          <span className="font-mono font-medium tabular-nums text-[var(--color-text)]">{formatCLP(row.totalCost)}</span>
                          <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" aria-hidden>
                            <span
                              className="block h-full rounded-full bg-[var(--color-primary)]"
                              style={{ width: `${Math.max(4, Math.round((row.totalCost / maxWorksiteCost) * 100))}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </section>
      )}
      </div>
    </PageContainer>
  )
}



