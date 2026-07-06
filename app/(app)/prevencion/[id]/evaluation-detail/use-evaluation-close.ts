"use client"

import { useState, useTransition } from "react"
import { toast } from "@/lib/toast"
import { closeEvaluationAction } from "@/app/(app)/prevencion/actions"

interface UseEvaluationCloseOptions {
  evaluationId: string
  initialRestricciones: string | null
  initialObservaciones: string | null
}

export function useEvaluationClose({
  evaluationId,
  initialRestricciones,
  initialObservaciones,
}: UseEvaluationCloseOptions) {
  const [closeOpen, setCloseOpen] = useState(false)
  const [restricciones, setRestricciones] = useState(initialRestricciones ?? "")
  const [observaciones, setObservaciones] = useState(initialObservaciones ?? "")
  const [hasCritical, setHasCritical] = useState(false)
  const [hasReincidence, setHasReincidence] = useState(false)
  const [closePending, startClose] = useTransition()

  function handleClose(onSuccess: () => void) {
    startClose(async () => {
      const result = await closeEvaluationAction(evaluationId, {
        evaluationId,
        restricciones: restricciones || undefined,
        observacionesGenerales: observaciones || undefined,
        hasCriticalDeviation: hasCritical,
        hasReincidence,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al cerrar la evaluación")
        return
      }
      toast.success("Evaluación cerrada exitosamente")
      setCloseOpen(false)
      onSuccess()
    })
  }

  return {
    closeOpen, setCloseOpen,
    restricciones, setRestricciones,
    observaciones, setObservaciones,
    hasCritical, setHasCritical,
    hasReincidence, setHasReincidence,
    closePending,
    handleClose,
  }
}
