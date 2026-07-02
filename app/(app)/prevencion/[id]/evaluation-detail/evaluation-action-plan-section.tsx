"use client"

import { TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ActionPlanPanel } from "../action-plan-panel"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import type { SstActionPlan } from "@/db/schema/sst"

interface Props {
  evaluationId: string
  items: SstActionPlan[]
  readOnly: boolean
  onUpdate: (v: SstActionPlan[]) => void
  activeNavigationIndex: number
  navigationItems: { value: string; label: string }[]
  moveActiveSection: (offset: number) => void
}

export function EvaluationActionPlanSection({
  evaluationId,
  items,
  readOnly,
  onUpdate,
  activeNavigationIndex,
  navigationItems,
  moveActiveSection,
}: Props) {
  return (
    <TabsContent value="plan">
      <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
        <ActionPlanPanel
          evaluationId={evaluationId}
          items={items}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
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
