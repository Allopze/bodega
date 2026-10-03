"use client"

import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import {
  CLASSIFICATION_CRITERIA, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, RE04_METHODOLOGY, classify, isScaleValue, magnitudeOf,
  type MiperScaleValue, type RiskClassification,
} from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

const TONE: Record<RiskClassification, string> = {
  tolerable: "bg-[var(--color-success-tint)]",
  moderate: "bg-[var(--color-warning-tint)]",
  important: "bg-[var(--color-danger-tint)]",
  intolerable: "bg-[var(--color-danger-tint)] border border-[var(--color-danger)]",
}
const probabilityOptions = PROBABILITY_LEVELS.map((level) => ({ value: level.value, title: `${level.value} · ${level.label}`, description: level.description }))
const consequenceOptions = CONSEQUENCE_LEVELS.map((level) => ({ value: level.value, title: `${level.value} · ${level.label}`, description: level.description }))

/** La leyenda sale de la misma fuente que congela cada MIPER (`methodology_snapshot`), no de un texto escrito a mano. */
const BANDS = RE04_METHODOLOGY.configuration.bands.map((band) => `${band.magnitudes.join("–")} ${band.label}`).join(" · ")

/**
 * Evaluación P×C del RE-04 (spec MIPER 2026-10-02 §6.3). Reemplaza al
 * `PcSelect` de la grilla: la persona elige leyendo el criterio, no un número
 * suelto. MR y clasificación se calculan al instante con `classify()`; la
 * columna generada de la base sigue siendo la autoridad.
 */
export function PcChoice({ probability, consequence, onChange, disabled = false }: {
  probability: number | null
  consequence: number | null
  onChange: (patch: { probability?: MiperScaleValue; consequence?: MiperScaleValue }) => void
  disabled?: boolean
}) {
  const p = isScaleValue(probability) ? probability : null
  const c = isScaleValue(consequence) ? consequence : null
  const classification = classify(p, c)
  const magnitude = magnitudeOf(p, c)
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Probabilidad</p>
        <ChoiceCardGroup label="Probabilidad" options={probabilityOptions} value={p} onChange={(value) => onChange({ probability: value })} disabled={disabled} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Consecuencia</p>
        <ChoiceCardGroup label="Consecuencia" options={consequenceOptions} value={c} onChange={(value) => onChange({ consequence: value })} disabled={disabled} />
      </div>
      <div role="status" aria-live="polite" className={cn("rounded-xl p-4", classification ? TONE[classification] : "bg-[var(--color-surface-2)]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{magnitude ?? "—"}</span>{" "}
            <span className="text-[var(--color-text-subtle)]">magnitud del riesgo (P × C, máximo 16)</span>
          </p>
          <RiskClassificationBadge classification={classification} magnitude={magnitude} />
        </div>
        <p className="mt-2 text-sm">{classification ? CLASSIFICATION_CRITERIA[classification] : "Elige probabilidad y consecuencia para calcular la magnitud del riesgo."}</p>
      </div>
      <p className="text-xs text-[var(--color-text-subtle)]">Bandas del RE-04: {BANDS}</p>
    </div>
  )
}
