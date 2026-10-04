"use client"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import type { NextStep, NextStepAction } from "@/lib/prevention/miper/next-step"
import { WorkspaceLink } from "./workspace-nav"

const TONE = { info: "info", warning: "warning", success: "success" } as const
/** La acción principal describe continuar el trabajo; la secundaria muestra su alcance. */
const RISK_LABEL = { pending: "Continuar completando", review: "Empezar la revisión" } as const
const LABEL = { ficha: "Abrir la ficha", tab: "Ir a Revisión", filtro: "Ver riesgos con datos pendientes" } as const
const labelOf = (action: NextStepAction) => (action.kind === "riesgo" ? RISK_LABEL[action.purpose] : LABEL[action.kind])

/**
 * «Siguiente paso» (spec §4 y §5.6): una sola recomendación bajo la cabecera.
 * Ir a un riesgo es una vista más profunda (push: «atrás» vuelve a la matriz);
 * la ficha, la pestaña y el filtro son estado de la vista (replace, sin scroll).
 * Navega sin ida al servidor (`WorkspaceLink`): las filas ya están en el cliente.
 */
export function NextStepCard({ step, hrefFor }: { step: NextStep | null; hrefFor: (action: NextStepAction) => string }) {
  if (!step) return null
  return (
    <Callout tone={TONE[step.tone]} title={step.title}>
      {step.description && <p>{step.description}</p>}
      {(step.action || step.secondary) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {step.action && (
            <Button asChild size="sm">
              <WorkspaceLink href={hrefFor(step.action)} replace={step.action.kind !== "riesgo"}>
                {labelOf(step.action)}
              </WorkspaceLink>
            </Button>
          )}
          {step.secondary && (
            <Button asChild size="sm" variant="secondary">
              <WorkspaceLink href={hrefFor(step.secondary)} replace={step.secondary.kind !== "riesgo"}>{labelOf(step.secondary)}</WorkspaceLink>
            </Button>
          )}
        </div>
      )}
    </Callout>
  )
}
