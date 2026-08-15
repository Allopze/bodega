"use client"

import { useState, useCallback, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { markWeekCompletedAction } from "@/app/(app)/prevencion/actions"
import { calculateCompliance } from "@/lib/sst/compliance"
import { getApplicableResponseStatuses, sectionAppliesToEvaluatorRole, type SectionAccess } from "@/lib/sst/checklist"
import type { ChecklistDefinition } from "@/lib/sst/types"
import type { SstEvaluation, SstResponse, SstScheduledFollowup, SstWeeklyEvaluation } from "@/db/schema/sst"
import type { SstActionPlanItemView } from "@/lib/services/sst-module/capa-view"
import { useChecklistResponses } from "./use-checklist-responses"
import { useEvaluationClose } from "./use-evaluation-close"
import { useEvaluationNavigation, type NavigationItem } from "./use-evaluation-navigation"
import { getEvaluationProgress } from "./evaluation-progress"

interface Props {
  evaluation: SstEvaluation
  definition: ChecklistDefinition
  responses: SstResponse[]
  followups: SstScheduledFollowup[]
  actionPlan: SstActionPlanItemView[]
  canClose: boolean
  canManage: boolean
  canViewFullEvaluation: boolean
  sectionAccess: Record<string, SectionAccess>
  weeklyEvals?: SstWeeklyEvaluation[]
}

export type { NavigationItem }

export function useEvaluationDetail({
  evaluation,
  definition,
  responses: initialResponses,
  followups: initialFollowups,
  actionPlan: initialActionPlan,
  canClose,
  canManage,
  canViewFullEvaluation,
  sectionAccess,
  weeklyEvals = [],
}: Props) {
  const router = useRouter()
  const isCerrado = evaluation.estado === "cerrado"
  const cargos = (evaluation.cargosJson as string[]) ?? []

  const nav = useEvaluationNavigation({
    definition,
    cargos,
    sectionAccess,
    isCerrado,
    canViewFullEvaluation,
    tipo: evaluation.tipo,
    weeklyEvals,
  })

  const responses = useChecklistResponses({
    evaluationId: evaluation.id,
    initialResponses,
    canEditAnyVisible: nav.canEditAnyVisible,
    visibleSections: nav.visibleSections,
    isSectionReadOnly: nav.isSectionReadOnly,
  })

  const cls = useEvaluationClose({
    evaluationId: evaluation.id,
    initialRestricciones: evaluation.restricciones,
    initialObservaciones: evaluation.observacionesGenerales,
  })

  const [followups, setFollowups] = useState(initialFollowups)
  const [actionPlan, setActionPlan] = useState(initialActionPlan)
  const [sectionFocusRequest, setSectionFocusRequest] = useState(0)
  const [isPending, startTransition] = useTransition()

  const visibleResponses = Object.entries(responses.responseMap).flatMap(([seccionId, items]) =>
    Object.entries(items).map(([itemId, response]) => ({
      seccionId,
      itemId,
      estado: response.estado,
    }))
  )
  const allResponses = getApplicableResponseStatuses(definition, cargos, visibleResponses)
  const compliance = calculateCompliance(allResponses)
  // El gate de cierre debe contar las mismas secciones que closeEvaluation en
  // el servidor: un administrador (que ve el Punto 3 en cualquier evaluación)
  // quedaba bloqueado con "Completar pendientes" por ítems que el servidor
  // excluye cuando la evaluación no es de conductor_lider.
  const progress = useMemo(
    () => getEvaluationProgress(
      nav.visibleSections.filter((sec) => sectionAppliesToEvaluatorRole(sec, evaluation.evaluatorRole)),
      responses.responseMap,
    ),
    [nav.visibleSections, responses.responseMap, evaluation.evaluatorRole],
  )

  const handleClose = useCallback(() => {
    cls.handleClose(() => router.refresh())
  }, [cls, router])

  const handleMarkWeekComplete = useCallback((weeklyId: string) => {
    startTransition(async () => {
      const result = await markWeekCompletedAction(weeklyId)
      if (result.ok) {
        toast.success("Semana marcada como completada")
        router.refresh()
      } else {
        toast.error(result.message ?? "Error al marcar la semana")
      }
    })
  }, [router, startTransition])

  const goToNextPending = () => {
    const next = progress.pending[0]
    if (next) {
      nav.setActiveSection(next.sectionId)
      setSectionFocusRequest((request) => request + 1)
    }
  }

  return {
    evaluation,
    definition,
    isCerrado,
    cargos,
    visibleSections: nav.visibleSections,
    isSectionReadOnly: nav.isSectionReadOnly,
    canEditAnyVisible: nav.canEditAnyVisible,
    navigationItems: nav.navigationItems,
    activeNavigationIndex: nav.activeNavigationIndex,
    activeSection: nav.activeSection,
    sectionFocusRequest,
    setActiveSection: nav.setActiveSection,
    responseMap: responses.responseMap,
    followups,
    setFollowups,
    actionPlan,
    setActionPlan,
    saveState: responses.saveState,
    closePending: cls.closePending,
    isPending,
    closeOpen: cls.closeOpen,
    setCloseOpen: cls.setCloseOpen,
    restricciones: cls.restricciones,
    setRestricciones: cls.setRestricciones,
    observaciones: cls.observaciones,
    setObservaciones: cls.setObservaciones,
    hasCritical: cls.hasCritical,
    setHasCritical: cls.setHasCritical,
    hasReincidence: cls.hasReincidence,
    setHasReincidence: cls.setHasReincidence,
    compliance,
    progress,
    canClose,
    canManage,
    canViewFullEvaluation,
    weeklyEvals,
    isWeekLocked: nav.isWeekLocked,
    handleResponseChange: responses.handleResponseChange,
    moveActiveSection: nav.moveActiveSection,
    handleClose,
    handleMarkWeekComplete,
    goToNextPending,
  }
}
