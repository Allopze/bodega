import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { formatDate } from "@/lib/utils"

/**
 * Franja de resumen en TEXTO (regla A1: nada de tarjetas de KPI sobre la
 * matriz). Es la cabecera de la vista de revisión del §8.4 y sirve igual a la
 * prevencionista.
 */
export function SummaryStrip({ snapshot, authorName, submittedAt, versionLabel }: { snapshot: MiperSnapshot; authorName: string | null; submittedAt: string | null; versionLabel: string }) {
  const entries = snapshot.entries
  const count = (cls: string) => entries.filter((entry) => entry.classification === cls).length
  const uncontrolled = entries.filter((entry) => entry.controlledStatus === "no").length
  const controls = entries.flatMap((entry) => entry.controls.map((control) => ({ control, entry })))
  const noResponsible = controls.filter(({ control, entry }) => entry.classification !== "tolerable" && !control.responsibleUserId && !control.responsibleName).length
  const noDeadline = controls.filter(({ control }) => !control.dueDate).length
  const h = snapshot.header
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-sm">
      <div><dt className="sr-only">Faena</dt><dd className="font-semibold">{h.worksiteName} · {h.period}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Versión </dt><dd className="inline">{versionLabel}</dd></div>
      {authorName && <div><dt className="inline text-[var(--color-text-subtle)]">Elaboró </dt><dd className="inline">{authorName}{submittedAt ? ` · enviada ${formatDate(submittedAt)}` : ""}</dd></div>}
      <div><dt className="inline text-[var(--color-text-subtle)]">Dotación </dt><dd className="inline tabular-nums">{h.headcountTotal ?? "—"}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Riesgos </dt><dd className="inline tabular-nums">{entries.length}</dd></div>
      <div className="flex flex-wrap gap-1.5">
        <dt className="sr-only">Distribución por clasificación</dt>
        {[...RISK_CLASSIFICATIONS].reverse().map((cls) => <dd key={cls} className="inline-flex items-center gap-1"><RiskClassificationBadge classification={cls} size="sm" /><span className="tabular-nums">{count(cls)}</span></dd>)}
      </div>
      <div><dt className="inline text-[var(--color-text-subtle)]">No controlados </dt><dd className="inline tabular-nums">{uncontrolled}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Medidas sin responsable </dt><dd className="inline tabular-nums">{noResponsible}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Medidas sin plazo </dt><dd className="inline tabular-nums">{noDeadline}</dd></div>
    </dl>
  )
}
