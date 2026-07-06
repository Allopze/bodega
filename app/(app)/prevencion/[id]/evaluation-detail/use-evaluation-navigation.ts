"use client"

import { useState, useCallback, useMemo } from "react"
import type { ChecklistSection, ChecklistDefinition } from "@/lib/sst/types"
import type { SectionAccess } from "@/lib/sst/checklist"
import type { SstWeeklyEvaluation } from "@/db/schema/sst"
import { getApplicableSections } from "./helpers"

export interface NavigationItem {
  value: string
  label: string
}

interface UseEvaluationNavigationOptions {
  definition: ChecklistDefinition
  cargos: string[]
  sectionAccess: Record<string, SectionAccess>
  isCerrado: boolean
  canViewFullEvaluation: boolean
  tipo: string
  weeklyEvals: SstWeeklyEvaluation[]
}

export function useEvaluationNavigation({
  definition,
  cargos,
  sectionAccess,
  isCerrado,
  canViewFullEvaluation,
  tipo,
  weeklyEvals,
}: UseEvaluationNavigationOptions) {
  const isWeekLocked = useCallback((semana: number) => {
    const weekly = weeklyEvals.find(w => w.semana === semana)
    if (!weekly) return false
    const today = new Date().toISOString().slice(0, 10)
    return today < weekly.fechaDesbloqueo
  }, [weeklyEvals])

  const applicableSections = useMemo(
    () => getApplicableSections(definition, cargos),
    [definition, cargos]
  )

  const visibleSections = useMemo(
    () => applicableSections.filter((sec) => sectionAccess[sec.id]?.canView ?? false),
    [applicableSections, sectionAccess]
  )

  const isSectionReadOnly = useCallback(
    (sectionId: string) => {
      if (isCerrado) return true

      const sec = visibleSections.find(s => s.id === sectionId)
      if (sec?.weekNumber) {
        const weekly = weeklyEvals.find(w => w.semana === sec.weekNumber)
        if (weekly) {
          if (weekly.estado === 'completada') return true
          if (isWeekLocked(sec.weekNumber)) return true
        }
      }

      return !(sectionAccess[sectionId]?.canEdit ?? false)
    },
    [isCerrado, sectionAccess, visibleSections, weeklyEvals, isWeekLocked],
  )

  const canEditAnyVisible = visibleSections.some((sec) => !isSectionReadOnly(sec.id))

  const navigationItems: NavigationItem[] = useMemo(() => [
    ...visibleSections.map((section) => {
      const isLocked = section.weekNumber ? isWeekLocked(section.weekNumber) : false
      return {
        value: section.id,
        label: section.title + (isLocked ? " 🔒" : ""),
      }
    }),
    ...(canViewFullEvaluation
      ? [
          { value: "acta", label: "Acta de cierre" },
          ...(tipo === "seguimiento"
             ? [{ value: "seguimientos", label: "Seguimientos" }]
             : []),
          { value: "plan", label: "Plan de acción" },
        ]
      : []),
  ], [visibleSections, isWeekLocked, canViewFullEvaluation, tipo])

  const [activeSection, setActiveSection] = useState(() => navigationItems[0]?.value ?? "acta")

  const activeNavigationIndex = Math.max(
    navigationItems.findIndex((item) => item.value === activeSection),
    0,
  )

  function moveActiveSection(offset: number) {
    const next = navigationItems[activeNavigationIndex + offset]
    if (next) setActiveSection(next.value)
  }

  return {
    visibleSections,
    isSectionReadOnly,
    canEditAnyVisible,
    navigationItems,
    activeSection,
    setActiveSection,
    activeNavigationIndex,
    isWeekLocked,
    moveActiveSection,
  }
}
