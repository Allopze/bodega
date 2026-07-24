"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { toast } from "@/lib/toast"
import { saveResponsesAction } from "@/app/(app)/prevencion/actions"
import type { ChecklistSection, StatusValue } from "@/lib/sst/types"
import type { SstResponse } from "@/db/schema/sst"
import { buildInitialResponseMap, type ResponseMap } from "./helpers"

export interface ItemResponse {
  estado: StatusValue
  observacion: string
  accionCorrectiva: string
}

interface UseChecklistResponsesOptions {
  evaluationId: string
  initialResponses: SstResponse[]
  canEditAnyVisible: boolean
  visibleSections: ChecklistSection[]
  isSectionReadOnly: (sectionId: string) => boolean
}

export function useChecklistResponses({
  evaluationId,
  initialResponses,
  canEditAnyVisible,
  visibleSections,
  isSectionReadOnly,
}: UseChecklistResponsesOptions) {
  const [responseMap, setResponseMap] = useState<ResponseMap>(
    () => buildInitialResponseMap(initialResponses)
  )
  const [saveState, setSaveState] = useState<null | "saving" | { ts: string } | "error">(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

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
            evaluationId,
            seccionId: sec.id,
            itemId: item.id,
            estado: r.estado,
            observacion: r.observacion || undefined,
            accionCorrectiva: r.accionCorrectiva || undefined,
          }
        })
      )
      const result = await saveResponsesAction(evaluationId, batch)
      if (!result.ok) {
        setSaveState("error")
        toast.error(result.message ?? "Error al guardar respuestas")
      } else {
        const now = new Date()
        const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
        setSaveState({ ts })
        setTimeout(() => setSaveState(null), 4000)
      }
    }, 800)
  }

  const handleResponseChange = useCallback(
    (seccionId: string, itemId: string, patch: Partial<ItemResponse>) => {
      setResponseMap((prev) => ({
        ...prev,
        [seccionId]: {
          ...(prev[seccionId] ?? {}),
          [itemId]: {
            ...(prev[seccionId]?.[itemId] ?? { estado: null, observacion: "", accionCorrectiva: "" }),
            ...patch,
          },
        },
      }))
    },
    []
  )

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    scheduleAutoSave(responseMap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseMap])

  return { responseMap, saveState, handleResponseChange }
}
