import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { cn, formatDate } from "@/lib/utils"

/**
 * Franja de resumen en TEXTO (regla A1: nada de tarjetas de KPI sobre la
 * matriz). Es la cabecera de la vista de revisión del §8.4 y sirve igual a la
 * prevencionista.
 *
 * Con `onToggleClassification`, cada conteo por clasificación es además el
 * filtro de la matriz (A1: una cifra accionable; A5: la clasificación no tiene
 * otro control). Igual «No controlados» con `onToggleUncontrolled`.
 */
export function SummaryStrip({ snapshot, authorName, submittedAt, versionLabel, taskCount, completeCount, pendingActive = false, onTogglePending, activeClassifications = [], uncontrolledActive = false, onToggleClassification, onToggleUncontrolled }: {
  snapshot: MiperSnapshot
  authorName: string | null
  submittedAt: string | null
  versionLabel: string
  /** Opcionales hasta que el espacio de trabajo los entregue (Task 11); sin ellos no se pinta ese ítem. */
  taskCount?: number
  completeCount?: number
  pendingActive?: boolean
  onTogglePending?: () => void
  activeClassifications?: readonly RiskClassification[]
  uncontrolledActive?: boolean
  onToggleClassification?: (classification: RiskClassification) => void
  onToggleUncontrolled?: () => void
}) {
  const entries = snapshot.entries
  const count = (cls: string) => entries.filter((entry) => entry.classification === cls).length
  const uncontrolled = entries.filter((entry) => entry.controlledStatus === "no").length
  const h = snapshot.header
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-sm">
      <div><dt className="sr-only">Faena</dt><dd className="font-semibold">{h.worksiteName} · {h.period}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Versión </dt><dd className="inline">{versionLabel}</dd></div>
      {authorName && <div><dt className="inline text-[var(--color-text-subtle)]">Elaboró </dt><dd className="inline">{authorName}{submittedAt ? ` · enviada ${formatDate(submittedAt)}` : ""}</dd></div>}
      <div><dt className="inline text-[var(--color-text-subtle)]">Dotación </dt><dd className="inline tabular-nums">{h.headcountTotal ?? "—"}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Riesgos </dt><dd className="inline tabular-nums">{entries.length}</dd></div>
      {taskCount !== undefined && <div><dt className="inline text-[var(--color-text-subtle)]">Tareas </dt><dd className="inline tabular-nums">{taskCount}</dd></div>}
      {completeCount !== undefined && (
        <div>
          <dt className="sr-only">Riesgos completos</dt>
          <dd>
            {onTogglePending ? (
              <button type="button" aria-pressed={pendingActive} onClick={onTogglePending} className={cn(toggleClass, pendingActive && activeClass)}
                aria-label={`Filtrar la matriz: con pendientes (${entries.length - completeCount})`}>
                <span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span>
              </button>
            ) : <><span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span></>}
          </dd>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <dt className="sr-only">Distribución por clasificación</dt>
        {[...RISK_CLASSIFICATIONS].reverse().map((cls) => {
          const content = <><RiskClassificationBadge classification={cls} size="sm" /><span className="tabular-nums">{count(cls)}</span></>
          if (!onToggleClassification) return <dd key={cls} className="inline-flex items-center gap-1">{content}</dd>
          const active = activeClassifications.includes(cls)
          return (
            <dd key={cls}>
              <button type="button" aria-pressed={active} onClick={() => onToggleClassification(cls)}
                aria-label={`Filtrar la matriz: ${CLASSIFICATION_LABEL[cls]} (${count(cls)})`}
                className={cn(toggleClass, active && activeClass)}>
                {content}
              </button>
            </dd>
          )
        })}
      </div>
      <div>
        <dt className="sr-only">No controlados</dt>
        <dd>
          {onToggleUncontrolled ? (
            <button type="button" aria-pressed={uncontrolledActive} onClick={onToggleUncontrolled} className={cn(toggleClass, uncontrolledActive && activeClass)}>
              <span className="text-[var(--color-text-subtle)]">No controlados</span> <span className="tabular-nums">{uncontrolled}</span>
            </button>
          ) : <><span className="text-[var(--color-text-subtle)]">No controlados</span> <span className="tabular-nums">{uncontrolled}</span></>}
        </dd>
      </div>
    </dl>
  )
}

const toggleClass = "inline-flex items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
const activeClass = "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-tint)]"
