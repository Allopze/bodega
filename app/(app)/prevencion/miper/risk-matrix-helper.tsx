"use client"

import { Badge } from "@/components/ui/badge"
import {
  DEFAULT_RISK_METHODOLOGY,
  RISK_CLASSIFICATION_BADGE_VARIANT,
  RISK_CLASSIFICATION_LABEL,
  classifyRisk,
  computeRiskMagnitude,
} from "@/lib/prevention/risk-engine"

/**
 * Matriz P×C de sólo lectura (ficha §21): ayuda visual para elegir
 * probabilidad y consecuencia. El usuario NUNCA edita MR desde acá — sólo ve
 * dónde cae la combinación elegida. Usa la metodología por defecto porque es
 * la única que existe hoy (`ensureIspRiskMethodology`); si en el futuro una
 * matriz declara otra, este helper debería recibir la metodología resuelta
 * como prop en vez de importar el default directo.
 */
export function RiskMatrixHelper({ probability, consequence }: { probability?: number; consequence?: number }) {
  const { probability: pScale, consequence: cScale } = DEFAULT_RISK_METHODOLOGY
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-center text-xs">
        <caption className="sr-only">Matriz de magnitud de riesgo, probabilidad por consecuencia</caption>
        <thead>
          <tr className="bg-[var(--color-surface-2)]">
            <th className="border p-2 text-left font-medium">C \ P</th>
            {pScale.map((p) => <th key={p.value} className="border p-2 font-medium">{p.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {cScale.map((c) => (
            <tr key={c.value}>
              <th scope="row" className="border p-2 text-left font-medium">{c.label}</th>
              {pScale.map((p) => {
                const magnitude = computeRiskMagnitude(p.value, c.value)
                const classification = classifyRisk(magnitude, DEFAULT_RISK_METHODOLOGY)
                const active = probability === p.value && consequence === c.value
                return (
                  <td key={p.value} className={`border p-2 ${active ? "ring-2 ring-inset ring-[var(--color-signal)]" : ""}`}>
                    <Badge variant={RISK_CLASSIFICATION_BADGE_VARIANT[classification]} size="sm" className="font-mono">{magnitude}</Badge>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {probability != null && consequence != null && (() => {
        const magnitude = computeRiskMagnitude(probability, consequence)
        const classification = classifyRisk(magnitude, DEFAULT_RISK_METHODOLOGY)
        return (
          <p className="flex flex-wrap items-center gap-2 border-t p-2 text-sm">
            <span>MR = {magnitude}</span>
            <Badge variant={RISK_CLASSIFICATION_BADGE_VARIANT[classification]}>{RISK_CLASSIFICATION_LABEL[classification]}</Badge>
            <span className="text-[var(--color-text-subtle)]">— el servidor recalcula al guardar</span>
          </p>
        )
      })()}
    </div>
  )
}
