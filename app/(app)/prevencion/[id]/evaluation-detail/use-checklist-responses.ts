"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "@/lib/toast"
import { useDebouncedAutosave } from "@/lib/hooks/use-debounced-autosave"
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
  // El hook compartido vigila un primitivo por valor: un contador que cambia en
  // cada edición cumple sin serializar el mapa completo en cada render.
  const [revision, setRevision] = useState(0)
  const clearSavedAtRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveBatch = useCallback(async () => {
    const editableSections = visibleSections.filter((sec) => !isSectionReadOnly(sec.id))
    const batch = editableSections.flatMap((sec) =>
      sec.items.map((item) => {
        const r = responseMap[sec.id]?.[item.id] ?? { estado: null, observacion: "", accionCorrectiva: "" }
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
    return saveResponsesAction(evaluationId, batch)
  }, [evaluationId, visibleSections, isSectionReadOnly, responseMap])

  const markSaved = useCallback(() => {
    const now = new Date()
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
    setSaveState({ ts })
    if (clearSavedAtRef.current) clearTimeout(clearSavedAtRef.current)
    clearSavedAtRef.current = setTimeout(() => setSaveState(null), 4000)
  }, [])

  const { status, error } = useDebouncedAutosave({
    watchKey: revision,
    isDirty: revision > 0,
    onSave: saveBatch,
    onSaved: markSaved,
    enabled: canEditAnyVisible,
    debounceMs: 800,
  })
  const pending = status === "saving"

  // El hook compartido expone el mensaje del action como `error`; esta pantalla
  // además lo tosta y refleja el estado en `saveState`.
  useEffect(() => {
    if (pending) {
      setSaveState("saving")
    } else if (error) {
      setSaveState("error")
      toast.error(error)
    }
  }, [pending, error])

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
      setRevision((value) => value + 1)
    },
    []
  )

  return { responseMap, saveState, handleResponseChange }
}
