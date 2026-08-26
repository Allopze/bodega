"use client"

import { useActionState, useEffect } from "react"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE } from "@/lib/form-state"
import { duplicateRequest } from "../actions"
import { toast } from "@/lib/toast"
import { QUOTATION_TYPES } from "@/lib/request-types"

export function DuplicateButton({ requestId, requestType }: { requestId: string; requestType: string }) {
  const [state, action] = useActionState(duplicateRequest, INITIAL_STATE)

  useEffect(() => {
    if (state.ok === false && state.message) {
      toast.error(state.message)
    }
    // ok === true → server action calls redirect(); no toast needed here
  }, [state])

  // EPP/otro no duplican nada: la acción sólo redirige al creador precargado
  // (ver duplicate.ts). "Duplicando..." ahí sería una animación de carga
  // mintiendo sobre qué está pasando.
  const loadingLabel = QUOTATION_TYPES.has(requestType) ? "Duplicando..." : "Abriendo..."

  return (
    <form action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton
        label="Duplicar solicitud"
        loadingLabel={loadingLabel}
        variant="secondary"
        size="sm"
      />
    </form>
  )
}
