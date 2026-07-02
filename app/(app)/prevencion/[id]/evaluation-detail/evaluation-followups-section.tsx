"use client"

import { TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { FollowupsPanel } from "../followups-panel"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import type { SstScheduledFollowup } from "@/db/schema/sst"

interface Props {
  followups: SstScheduledFollowup[]
  canManage: boolean
  onUpdate: (v: SstScheduledFollowup[]) => void
  activeNavigationIndex: number
  navigationItems: { value: string; label: string }[]
  moveActiveSection: (offset: number) => void
}

export function EvaluationFollowupsSection({
  followups,
  canManage,
  onUpdate,
  activeNavigationIndex,
  navigationItems,
  moveActiveSection,
}: Props) {
  return (
    <TabsContent value="seguimientos">
      <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
        <h3 className="text-base font-semibold text-(--color-text)">Seguimientos programados</h3>
        <FollowupsPanel
          followups={followups}
          canManage={canManage}
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
