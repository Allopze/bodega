"use client"

import { PcChoice } from "@/components/prevention/pc-choice"
import type { StepProps } from "./types"

export function EvaluationStep({ entry, editable, autosave, issues }: StepProps) {
  const missing = [...new Set(issues.filter((issue) => issue.severity === "error" && (issue.field === "probability" || issue.field === "consequence")).map((issue) => issue.message))]
  const error = autosave.fieldError(entry.id, "probability") ?? autosave.fieldError(entry.id, "consequence")
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-subtle)]">Selecciona probabilidad y consecuencia según los criterios del RE-04.</p>
      {missing.length > 0 && <ul className="space-y-1 rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">{missing.map((message) => <li key={message}>{message}</li>)}</ul>}
      <PcChoice probability={entry.probability} consequence={entry.consequence} disabled={!editable} onChange={(patch) => { void autosave.commit(entry, patch) }} />
      {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}
