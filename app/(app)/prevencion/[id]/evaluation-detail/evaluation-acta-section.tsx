"use client"

import { TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RESULTADO_LABELS, MOTIVO_LABELS, resultadoBadgeVariant } from "@/lib/sst/badges"
import { SIGNATURE_ROLE_LABELS } from "@/lib/sst/cargos"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import type { ChecklistDefinition } from "@/lib/sst/types"

interface Props {
  definition: ChecklistDefinition
  evaluation: {
    motivo?: string | null
    resultadoFinal?: string | null
    porcentajeCumplimiento?: number | null
    restricciones?: string | null
    observacionesGenerales?: string | null
    estado: string
  }
  isCerrado: boolean
  activeNavigationIndex: number
  navigationItems: { value: string; label: string }[]
  moveActiveSection: (offset: number) => void
}

export function EvaluationActaSection({
  definition,
  evaluation,
  isCerrado,
  activeNavigationIndex,
  navigationItems,
  moveActiveSection,
}: Props) {
  return (
    <TabsContent value="acta">
      <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-5">
        <h3 className="text-base font-semibold text-(--color-text)">Acta de Cierre</h3>

        {evaluation.motivo && (
          <div>
            <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Motivo</p>
            <p className="text-sm text-(--color-text)">{MOTIVO_LABELS[evaluation.motivo] ?? evaluation.motivo}</p>
          </div>
        )}

        {isCerrado && evaluation.resultadoFinal && (
          <div>
            <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Resultado Final</p>
            <Badge variant={resultadoBadgeVariant(evaluation.resultadoFinal)}>
              {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
            </Badge>
            {evaluation.porcentajeCumplimiento !== null && (
              <p className="mt-1 text-sm text-text-subtle">
                Cumplimiento: {evaluation.porcentajeCumplimiento!.toFixed(1)}%
              </p>
            )}
          </div>
        )}

        {evaluation.restricciones && (
          <div>
            <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Restricciones</p>
            <p className="text-sm text-(--color-text)">{evaluation.restricciones}</p>
          </div>
        )}

        {evaluation.observacionesGenerales && (
          <div>
            <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Observaciones generales</p>
            <p className="text-sm text-(--color-text)">{evaluation.observacionesGenerales}</p>
          </div>
        )}

        {!isCerrado && (
          <div className="rounded-(--radius) border border-(--color-border) bg-surface-2 px-4 py-3">
            <p className="text-sm text-(--color-text-muted)">
              El acta de cierre se completa al cerrar la evaluación. Usa el botón <strong>Cerrar evaluación</strong> en la cabecera cuando hayas finalizado el checklist.
            </p>
          </div>
        )}

        {definition.closingAct.signatureRoles.length > 0 && (
          <div>
            <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-2">Firmas requeridas (en acta impresa)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {definition.closingAct.signatureRoles.map((role) => (
                <div
                  key={role}
                  className="h-16 rounded-(--radius) border-2 border-dashed border-(--color-border) flex flex-col items-center justify-end pb-1"
                >
                  <span className="text-xs text-text-subtle">{SIGNATURE_ROLE_LABELS[role] ?? role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-[var(--color-border)] flex justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => moveActiveSection(-1)}
            disabled={activeNavigationIndex === 0}
          >
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
            Anterior
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => moveActiveSection(1)}
            disabled={activeNavigationIndex >= navigationItems.length - 1}
          >
            Siguiente
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </TabsContent>
  )
}
