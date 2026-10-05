"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Progress } from "@/components/ui/progress"
import { SummaryBar, type SummaryLinkProps, type SummaryStat } from "@/components/ui/summary-bar"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import { progressPercent, type ProgramProgress } from "@/lib/prevention/miper/progress"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToMatrixOnly, hrefToProgramOnly, hrefToTab } from "@/lib/prevention/miper/workspace-url"
import { countOf } from "@/lib/utils"
import { revealActivity } from "./workspace-memory"
import { scrollToWhenReady, WorkspaceLink } from "./workspace-nav"

/** Las cifras cambian la vista con `replaceState`: sin ida al servidor y sin entrada nueva en el historial (spec §3). */
function ReplaceWorkspaceLink({ href, className, children, ...rest }: SummaryLinkProps) {
  return <WorkspaceLink href={href} replace className={className} {...rest}>{children}</WorkspaceLink>
}

/**
 * Inicio del documento (URL heredada `tab=resumen`), destino de la portada.
 * Las URLs sin pestaña conservan la matriz para no alterar enlaces previos.
 *
 * - Cuatro cifras que llevan a su subconjunto (A1). Las tres de la matriz QUITAN
 *   los seis filtros antes de aplicar el suyo (`hrefToMatrixOnly`); si no, la
 *   cifra y lo que se ve al llegar no coinciden.
 * - La completitud por actividad, con cada barra enlazada a su tarjeta en la
 *   matriz. Si la tarjeta estaba plegada, se despliega.
 */
export function ResumenPanel({ matrixId, rows, tree, incomplete, linkedControlIds, programProgress, editable, onNewTask }: {
  matrixId: string
  rows: readonly MiperEntrySnapshot[]
  /** El árbol completo (sin filtros) de la matriz: el orden del RE-04 y la cuenta por actividad. */
  tree: readonly ActivityNode[]
  /** Riesgos con algún error de completitud: el mismo conjunto que filtra `completitud=pendientes`. */
  incomplete: ReadonlySet<string>
  /** Ids de las medidas de la matriz que ya tienen una actividad en el Programa de Trabajo (informativo; no cambia ninguna regla de envío). */
  linkedControlIds: ReadonlySet<string>
  programProgress: ProgramProgress
  editable: boolean
  onNewTask: () => void
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Esta MIPER todavía no tiene riesgos"
        description="Empieza por una actividad y su tarea. Después identifica los peligros, evalúa los riesgos y define las medidas."
        action={editable
          ? <Button onClick={onNewTask}>Nueva tarea</Button>
          : <Button asChild variant="secondary"><WorkspaceLink href={hrefToTab(pathname, params, "matriz")} replace>Ver riesgos</WorkspaceLink></Button>}
      />
    )
  }
  const pending = rows.filter((row) => incomplete.has(row.id)).length
  const graveRows = rows.filter((row) => row.classification === "important" || row.classification === "intolerable")
  const graves = graveRows.length
  const gravesLinked = graveRows.filter((row) => row.controls.some((control) => linkedControlIds.has(control.id))).length
  const uncontrolled = rows.filter((row) => row.controlledStatus === "no").length
  const { done, planned, overdue } = programProgress
  const allComplete = tree.length > 0 && tree.every((activity) => activity.tasks.reduce((total, task) => total + task.complete, 0) === activity.entryCount)
  const stats: SummaryStat[] = [
    {
      key: "completos", label: "Riesgos completos", value: `${rows.length - pending}/${rows.length}`,
      secondary: pending > 0 ? `${countOf(pending, "riesgo")} con pendientes` : "Todos tienen los datos requeridos",
      href: rows.length > pending ? hrefToMatrixOnly(pathname, params, { completitud: "completos" }) : undefined,
    },
    {
      key: "graves", label: "Importantes e Intolerables", value: graves, tone: "signal",
      secondary: graves === 0 ? "Ninguno en esta MIPER"
        : gravesLinked === graves ? "Exigen seguimiento · todos con actividad en el plan" : `Exigen seguimiento · ${gravesLinked} con actividad en el plan`,
      href: graves > 0 ? hrefToMatrixOnly(pathname, params, { clasificacion: "important,intolerable" }) : undefined,
    },
    {
      key: "no-controlados", label: "No controlados", value: uncontrolled, tone: "signal",
      secondary: uncontrolled > 0 ? "Marcados como no controlados" : "Ninguno marcado como no controlado",
      href: uncontrolled > 0 ? hrefToMatrixOnly(pathname, params, { controlado: "no" }) : undefined,
    },
    {
      key: "programa", label: "Avance del plan", value: planned === 0 ? "Aún sin actividades" : `${progressPercent(programProgress)}%`,
      valueKind: planned === 0 ? "text" : "number",
      secondary: planned === 0 ? "Genéralas desde las medidas" : `${done}/${planned} realizadas${overdue > 0 ? ` · ${countOf(overdue, "vencida")}` : ""}`,
      href: hrefToProgramOnly(pathname, params),
    },
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Estado del trabajo</h2>
        <Button asChild size="sm" variant="secondary"><WorkspaceLink href={hrefToMatrixOnly(pathname, params)} replace>Ver riesgos</WorkspaceLink></Button>
      </div>
      <SummaryBar stats={stats} renderLink={ReplaceWorkspaceLink} />
      <section aria-labelledby="miper-resumen-actividades" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 id="miper-resumen-actividades" className="text-sm font-semibold">Datos completos por actividad</h2>
        {allComplete ? (
          <p className="mt-3 flex items-center gap-2 text-sm">
            <CheckCircle size={16} weight="fill" className="shrink-0 text-[var(--color-success-ink)]" aria-hidden />
            {tree.length === 1 ? "La única actividad tiene todos sus datos." : `Las ${tree.length} actividades tienen todos sus datos.`}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {tree.map((activity) => {
              const complete = activity.tasks.reduce((total, task) => total + task.complete, 0)
              const target = `miper-activity-${activity.key}`
              return (
                <li key={activity.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_4.5rem]">
                  {/* Cuenta de ancho fijo: así todas las barras terminan en la misma x. En móvil el enlace llega a 44 px sin cambiar la densidad de escritorio. */}
                  <WorkspaceLink href={`${hrefToMatrixOnly(pathname, params)}#${target}`} replace className="inline-flex min-h-11 min-w-0 items-center break-words text-sm font-medium hover:underline sm:min-h-0"
                    onClick={() => { revealActivity(matrixId, activity.key); scrollToWhenReady(target) }}>
                    {activity.label}
                  </WorkspaceLink>
                  <span className="col-start-2 row-start-1 text-right text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-3">{complete}/{activity.entryCount}</span>
                  <Progress value={complete} max={activity.entryCount} label={`${activity.label}: ${complete} de ${activity.entryCount} completos`}
                    className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1" />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
