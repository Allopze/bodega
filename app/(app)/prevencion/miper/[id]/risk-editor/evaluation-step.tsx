"use client"

import { PcChoice } from "@/components/prevention/pc-choice"
import type { StepProps } from "./types"

export function EvaluationStep({ entry, editable, autosave }: StepProps) {
  const error = autosave.fieldError(entry.id, "probability") ?? autosave.fieldError(entry.id, "consequence")
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-subtle)]">Selecciona probabilidad y consecuencia según los criterios del RE-04.</p>
      <PcChoice probability={entry.probability} consequence={entry.consequence} disabled={!editable} onChange={(patch) => { void autosave.commit(entry, patch) }} />
      {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}
