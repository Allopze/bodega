"use client"

import { useState, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { saveResponsesAction, closeEvaluationAction, markWeekCompletedAction } from "@/app/(app)/prevencion/actions"
import { calculateCompliance } from "@/lib/sst/compliance"
import { getApplicableResponseStatuses, type SectionAccess } from "@/lib/sst/checklist"
import type { ChecklistDefinition, ChecklistSection } from "@/lib/sst/types"
import type { SstEvaluation, SstResponse, SstScheduledFollowup, SstActionPlan, SstWeeklyEvaluation } from "@/db/schema/sst"
import { buildInitialResponseMap, getApplicableSections, type ResponseMap } from "./helpers"
import type { ItemResponse } from "../checklist-section"

interface Props {
  evaluation: SstEvaluation
  definition: ChecklistDefinition
  responses: SstResponse[]
  followups: SstScheduledFollowup[]
  actionPlan: SstActionPlan[]
  canClose: boolean
  canManage: boolean
  canViewFullEvaluation: boolean
  sectionAccess: Record<string, SectionAccess>
  weeklyEvals?: SstWeeklyEvaluation[]
}

export interface NavigationItem {
  value: string
  label: string
}

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
  const applicableSections = getApplicableSections(definition, cargos)
  const visibleSections = applicableSections.filter(
    (sec) => sectionAccess[sec.id]?.canView ?? false,
  )

  const isWeekLocked = useCallback((semana: number) => {
    const weekly = weeklyEvals.find(w => w.semana === semana)
    if (!weekly) return false
    const today = new Date().toISOString().slice(0, 10)
    return today < weekly.fechaDesbloqueo
  }, [weeklyEvals])

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

  const navigationItems: NavigationItem[] = [
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
          ...(evaluation.tipo === "seguimiento"
             ? [{ value: "seguimientos", label: "Seguimientos" }]
             : []),
          { value: "plan", label: "Plan de acción" },
        ]
      : []),
  ]

  const [responseMap, setResponseMap] = useState<ResponseMap>(
    () => buildInitialResponseMap(initialResponses)
  )
  const [followups, setFollowups]     = useState(initialFollowups)
  const [actionPlan, setActionPlan]   = useState(initialActionPlan)
  const [activeSection, setActiveSection] = useState(() => navigationItems[0]?.value ?? "acta")
  const [saveState, setSaveState] = useState<null | "saving" | { ts: string } | "error">(null)
  const [closePending, startClose]    = useTransition()
  const [isPending, startTransition]  = useTransition()

  const [closeOpen, setCloseOpen]         = useState(false)
  const [restricciones, setRestricciones] = useState(evaluation.restricciones ?? "")
  const [observaciones, setObservaciones] = useState(evaluation.observacionesGenerales ?? "")
  const [hasCritical, setHasCritical]     = useState(false)
  const [hasReincidence, setHasReincidence] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeNavigationIndex = Math.max(
    navigationItems.findIndex((item) => item.value === activeSection),
    0,
  )

  const visibleResponses = Object.entries(responseMap).flatMap(([seccionId, items]) =>
    Object.entries(items).map(([itemId, response]) => ({
      seccionId,
      itemId,
      estado: response.estado,
    }))
  )
  const allResponses = getApplicableResponseStatuses(definition, cargos, visibleResponses)
  const compliance = calculateCompliance(allResponses)

  function scheduleAutoSave(newMap: ResponseMap) {
    if (!canEditAnyVisible) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const editableSections = visibleSections.filter((sec) => !isSectionReadOnly(sec.id))
    debounceRef.current = setTimeout(async () => {
      setSaveState("saving")
      const batch = editableSections.flatMap((sec) =>
        sec.items.map((item) => {
          const r = newMap[sec.id]?.[item.id] ?? { estado: null, observacion: "", accionCorrectiva: "" }
          return {
            evaluationId:     evaluation.id,
            seccionId:        sec.id,
            itemId:           item.id,
            estado:           r.estado,
            observacion:      r.observacion || undefined,
            accionCorrectiva: r.accionCorrectiva || undefined,
          }
        })
      )
      const result = await saveResponsesAction(evaluation.id, batch)
      if (!result.ok) {
        setSaveState("error")
        toast.error(result.message ?? "Error al guardar respuestas")
      } else {
        const now = new Date()
        const ts  = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
        setSaveState({ ts })
        setTimeout(() => setSaveState(null), 4000)
      }
    }, 800)
  }

  const handleResponseChange = useCallback(
    (seccionId: string, itemId: string, patch: Partial<ItemResponse>) => {
      setResponseMap((prev) => {
        const next = {
          ...prev,
          [seccionId]: {
            ...(prev[seccionId] ?? {}),
            [itemId]: {
              ...(prev[seccionId]?.[itemId] ?? { estado: null, observacion: "", accionCorrectiva: "" }),
              ...patch,
            },
          },
        }
        scheduleAutoSave(next)
        return next
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evaluation.id, canEditAnyVisible]
  )

  function moveActiveSection(offset: number) {
    const next = navigationItems[activeNavigationIndex + offset]
    if (next) setActiveSection(next.value)
  }

  function handleClose() {
    startClose(async () => {
      const result = await closeEvaluationAction(evaluation.id, {
        evaluationId:           evaluation.id,
        restricciones:          restricciones || undefined,
        observacionesGenerales: observaciones || undefined,
        hasCriticalDeviation:   hasCritical,
        hasReincidence,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al cerrar la evaluación")
        return
      }
      toast.success("Evaluación cerrada exitosamente")
      setCloseOpen(false)
      router.refresh()
    })
  }

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

  return {
    evaluation,
    definition,
    isCerrado,
    cargos,
    visibleSections,
    isSectionReadOnly,
    canEditAnyVisible,
    navigationItems,
    activeNavigationIndex,
    activeSection,
    setActiveSection,
    responseMap,
    followups,
    setFollowups,
    actionPlan,
    setActionPlan,
    saveState,
    closePending,
    isPending,
    closeOpen,
    setCloseOpen,
    restricciones,
    setRestricciones,
    observaciones,
    setObservaciones,
    hasCritical,
    setHasCritical,
    hasReincidence,
    setHasReincidence,
    compliance,
    canClose,
    canManage,
    canViewFullEvaluation,
    weeklyEvals,
    isWeekLocked,
    handleResponseChange,
    moveActiveSection,
    handleClose,
    handleMarkWeekComplete,
  }
}
