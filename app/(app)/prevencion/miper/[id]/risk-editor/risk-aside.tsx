"use client"

import { CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Button } from "@/components/ui/button"
import { DetailItem } from "@/components/ui/detail-item"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { riskChecks } from "@/lib/prevention/miper/risk-checks"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const card = "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"

export function RiskAside({ entry, issues, onGoToStep, canObserve }: { entry: MiperEntrySnapshot; issues: CompletenessIssue[]; onGoToStep: (step: EditorStep) => void; canObserve: boolean }) {
  return (
    <aside aria-label="Resumen del riesgo" className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className={card} aria-label="Contexto">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Contexto</h3>
        <dl className="space-y-1.5 text-sm">
          <DetailItem label="Actividad" value={entry.activity ?? "—"} />
          <DetailItem label="Tarea" value={entry.task ?? "—"} />
          <DetailItem label="Puesto" value={entry.position ?? "—"} />
          <DetailItem label="Lugar" value={entry.location ?? "—"} />
          <DetailItem label="Expuestos" value={String(entry.exposedFemale + entry.exposedMale + entry.exposedOther)} mono />
        </dl>
      </section>
      <section className={card} aria-label="Chequeo del riesgo">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Chequeo del riesgo</h3>
        <ul className="space-y-2 text-sm">
          {riskChecks(entry, issues).map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.ok
                ? <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-[var(--color-success-ink)]" />
                : <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-[var(--color-warning-ink)]" />}
              <span>
                <span className="sr-only">{check.ok ? "Listo: " : "Pendiente: "}</span>{check.label}
                {!check.ok && <button type="button" onClick={() => onGoToStep(check.step)} className="block text-left text-xs text-[var(--color-primary-ink)] underline">{check.messages[0]}</button>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className={card} aria-label="Nivel de riesgo">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Nivel de riesgo</h3>
        {/* Sin magnitud a propósito: «Clasificación · MR n» vive una sola vez en pantalla (paso Evaluación). */}
        <div className="flex flex-wrap items-center gap-2">
          <RiskClassificationBadge classification={entry.classification} />
          {entry.classification && <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">{typeof entry.magnitude === "number" ? `MR ${entry.magnitude}` : "Sin evaluar"}</span>}
        </div>
      </section>
      {canObserve && <Button size="sm" variant="secondary" className="w-full" onClick={() => onGoToStep("seguimiento")}>Observar este riesgo</Button>}
    </aside>
  )
}
