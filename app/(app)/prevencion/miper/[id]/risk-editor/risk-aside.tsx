"use client"

import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { DetailItem } from "@/components/ui/detail-item"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { EDITOR_STEPS, EDITOR_STEP_LABEL, errorCountByStep, type EditorStep } from "@/lib/prevention/miper/entry-navigation"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { countOf } from "@/lib/utils"

export function RiskAside({ entry, issues, onGoToStep, canObserve, currentStep }: { entry: MiperEntrySnapshot; issues: CompletenessIssue[]; onGoToStep: (step: EditorStep) => void; canObserve: boolean; currentStep: EditorStep }) {
  const titleId = `${entry.id}-resumen`
  const counts = errorCountByStep(issues)
  const pending = issues.filter((issue) => issue.severity === "error").length
  return (
    <section aria-labelledby={titleId} className="space-y-4 border-t border-[var(--color-border)] pt-4 xl:border-t-0 xl:border-l xl:pl-4 xl:pt-0">
      <h3 id={titleId} className="text-sm font-semibold">Chequeo del riesgo</h3>
      <p className="text-sm text-[var(--color-text-subtle)]">{pending > 0 ? `${countOf(pending, "dato pendiente")} para enviar a revisión.` : "Datos completos para enviar a revisión."}</p>
      {pending > 0 && <details>
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-primary-ink)]">Ver pasos con pendientes</summary>
        <ul className="mt-2 space-y-2 text-sm">
          {EDITOR_STEPS.filter((step) => counts[step] > 0).map((step) => (
            <li key={step}><button type="button" onClick={() => onGoToStep(step)} className="text-left text-[var(--color-primary-ink)] underline">{EDITOR_STEP_LABEL[step]} ({counts[step]})</button></li>
          ))}
        </ul>
      </details>}
      <details className="border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer text-sm font-medium">Contexto de la tarea</summary>
        <dl className="mt-3 space-y-2 text-sm">
          <DetailItem label="Puesto" value={entry.position ?? "Sin indicar"} />
          <DetailItem label="Lugar" value={entry.location ?? "Sin indicar"} />
          <DetailItem label="Expuestos" value={String(entry.exposedFemale + entry.exposedMale + entry.exposedOther)} mono />
        </dl>
        <button type="button" className="mt-2 text-sm text-[var(--color-primary-ink)] underline" onClick={() => onGoToStep("identificacion")}>Ver identificación</button>
      </details>
      {currentStep !== "evaluacion" && <section className="space-y-2 border-t border-[var(--color-border)] pt-3">
        <h4 className="text-sm font-medium">Nivel de riesgo</h4>
        <RiskClassificationBadge classification={entry.classification} />
      </section>}
      {canObserve && currentStep !== "seguimiento" && <Button size="sm" variant="secondary" className="w-full" onClick={() => onGoToStep("seguimiento")}>Observar este riesgo</Button>}
    </section>
  )
}
