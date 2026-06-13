"use client"

import { useActionState, useEffect } from "react"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { duplicateRequest } from "../actions"
import { toast } from "@/lib/toast"

export function DuplicateButton({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(duplicateRequest, INITIAL_STATE)

  useEffect(() => {
    if (state.ok === false && state.message) {
      toast.error(state.message)
    }
    // ok === true → server action calls redirect(); no toast needed here
  }, [state])

  return (
    <form action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton
        label="Duplicar solicitud"
        loadingLabel="Duplicando..."
        variant="secondary"
        size="sm"
      />
    </form>
  )
}
