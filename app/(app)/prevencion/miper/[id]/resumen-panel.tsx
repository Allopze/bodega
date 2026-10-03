"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Progress } from "@/components/ui/progress"
import { SummaryBar, type SummaryLinkProps, type SummaryStat } from "@/components/ui/summary-bar"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
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
 * Pestaña «Resumen» del espacio de trabajo (spec §7, Fase B). No es la vista por
 * defecto: la matriz lo sigue siendo (§3, D9).
 *
 * - Cuatro cifras que llevan a su subconjunto (A1). Las tres de la matriz QUITAN
 *   los seis filtros antes de aplicar el suyo (`hrefToMatrixOnly`); si no, la
 *   cifra y lo que se ve al llegar no coinciden.
 * - La completitud por actividad, con cada barra enlazada a su tarjeta en la
 *   matriz. Si la tarjeta estaba plegada, se despliega.
 */
export function ResumenPanel({ matrixId, rows, tree, incomplete, programProgress, editable, onNewTask }: {
  matrixId: string
  rows: readonly MiperEntrySnapshot[]
  /** El árbol completo (sin filtros) de la matriz: el orden del RE-04 y la cuenta por actividad. */
  tree: readonly ActivityNode[]
  /** Riesgos con algún error de completitud: el mismo conjunto que filtra `completitud=pendientes`. */
  incomplete: ReadonlySet<string>
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
        description="El resumen se arma con los riesgos de la matriz: empieza por una tarea con su actividad, su puesto y sus peligros."
        action={editable
          ? <Button onClick={onNewTask}>Nueva tarea</Button>
          : <Button asChild variant="secondary"><WorkspaceLink href={hrefToTab(pathname, params, "matriz")} replace>Ver la matriz</WorkspaceLink></Button>}
      />
    )
  }
  const pending = rows.filter((row) => incomplete.has(row.id)).length
  const graves = rows.filter((row) => row.classification === "important" || row.classification === "intolerable").length
  const uncontrolled = rows.filter((row) => row.controlledStatus === "no").length
  const { done, planned, overdue, ratio } = programProgress
  const stats: SummaryStat[] = [
    {
      key: "completos", label: "Riesgos completos", value: `${rows.length - pending}/${rows.length}`,
      secondary: pending > 0 ? `${countOf(pending, "riesgo")} con pendientes` : "Ninguno con pendientes",
      href: hrefToMatrixOnly(pathname, params, { completitud: pending > 0 ? "pendientes" : "completos" }),
    },
    {
      key: "graves", label: "Importantes e Intolerables", value: graves, tone: "signal",
      secondary: graves > 0 ? "Exigen medida y seguimiento" : "Ninguno en esta MIPER",
      href: graves > 0 ? hrefToMatrixOnly(pathname, params, { clasificacion: "important,intolerable" }) : undefined,
    },
    {
      key: "no-controlados", label: "No controlados", value: uncontrolled, tone: "signal",
      secondary: uncontrolled > 0 ? "«¿Está controlado?» en No" : "Ninguno marcado No",
      href: uncontrolled > 0 ? hrefToMatrixOnly(pathname, params, { controlado: "no" }) : undefined,
    },
    {
      key: "programa", label: "Avance del programa", value: planned === 0 ? "Sin ocurrencias" : `${Math.round((ratio ?? 0) * 100)}%`,
      secondary: planned === 0 ? "Genera las actividades desde las medidas" : `${done}/${planned} realizadas${overdue > 0 ? ` · ${countOf(overdue, "vencida")}` : ""}`,
      href: hrefToProgramOnly(pathname, params),
    },
  ]
  return (
    <div className="space-y-4">
      <SummaryBar stats={stats} renderLink={ReplaceWorkspaceLink} />
      <section aria-labelledby="miper-resumen-actividades" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 id="miper-resumen-actividades" className="text-sm font-semibold">Completitud por actividad</h2>
        <ul className="mt-3 space-y-3">
          {tree.map((activity) => {
            const complete = activity.tasks.reduce((total, task) => total + task.complete, 0)
            const target = `miper-activity-${activity.key}`
            return (
              <li key={activity.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]">
                <WorkspaceLink href={`${hrefToMatrixOnly(pathname, params)}#${target}`} replace className="min-w-0 break-words text-sm font-medium hover:underline"
                  onClick={() => { revealActivity(matrixId, activity.key); scrollToWhenReady(target) }}>
                  {activity.label}
                </WorkspaceLink>
                <span className="col-start-2 row-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-3">{complete}/{activity.entryCount}</span>
                <Progress value={complete} max={activity.entryCount} label={`${activity.label}: ${complete} de ${activity.entryCount} completos`}
                  className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1" />
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
