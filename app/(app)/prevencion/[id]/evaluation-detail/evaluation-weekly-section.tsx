"use client"

import { TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateDisplay } from "@/lib/sst/date"
import { ChecklistSectionPanel } from "../checklist-section"
import { LockSimple, CaretLeft, CaretRight, Check } from "@phosphor-icons/react"
import type { ChecklistSection } from "@/lib/sst/types"
import type { SstWeeklyEvaluation } from "@/db/schema/sst"
import type { ResponseMap } from "./helpers"

interface Props {
  section: ChecklistSection
  responseMap: ResponseMap
  isSectionReadOnly: (id: string) => boolean
  weeklyEvals: SstWeeklyEvaluation[]
  isWeekLocked: (semana: number) => boolean
  isPending: boolean
  activeNavigationIndex: number
  navigationItems: { value: string; label: string }[]
  handleResponseChange: (seccionId: string, itemId: string, patch: any) => void
  moveActiveSection: (offset: number) => void
  handleMarkWeekComplete: (weeklyId: string) => void
}

export function EvaluationWeeklySection({
  section,
  responseMap,
  isSectionReadOnly,
  weeklyEvals,
  isWeekLocked,
  isPending,
  activeNavigationIndex,
  navigationItems,
  handleResponseChange,
  moveActiveSection,
  handleMarkWeekComplete,
}: Props) {
  const weekly = section.weekNumber ? weeklyEvals.find(w => w.semana === section.weekNumber) : null
  const isWeekLockedVal = section.weekNumber ? isWeekLocked(section.weekNumber) : false
  const canMarkComplete = weekly && weekly.estado === 'pendiente' && !isWeekLockedVal && !(isSectionReadOnly(section.id))

  return (
    <TabsContent key={section.id} value={section.id}>
      <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-semibold text-(--color-text)">{section.title}</h3>
          {weekly && (
            <Badge variant={weekly.estado === 'completada' ? 'success' : isWeekLockedVal ? 'outline' : 'warning'}>
              {weekly.estado === 'completada' ? 'Completada' : isWeekLockedVal ? 'Bloqueada' : 'Pendiente'}
            </Badge>
          )}
        </div>

        {isWeekLockedVal && weekly && (
          <div className="flex items-center gap-2 p-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm rounded-[var(--radius)]">
            <LockSimple size={16} />
            <span>Sección bloqueada hasta el <strong>{formatDateDisplay(weekly.fechaDesbloqueo)}</strong></span>
          </div>
        )}

        <ChecklistSectionPanel
          section={section}
          responses={responseMap[section.id] ?? {}}
          readOnly={isSectionReadOnly(section.id)}
          onChange={handleResponseChange}
        />

        <div className="pt-4 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
          <div className="flex gap-2">
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
          {canMarkComplete && (
            <Button
              type="button"
              variant="signal"
              onClick={() => handleMarkWeekComplete(weekly.id)}
              disabled={isPending}
            >
              <Check size={14} className="mr-1.5" />
              Marcar Semana {section.weekNumber} como Completada
            </Button>
          )}
        </div>
      </div>
    </TabsContent>
  )
}
