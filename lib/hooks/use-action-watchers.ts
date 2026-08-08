"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"

interface ActionWatchersInput {
  submitState:    ActionState
  cancelState:    ActionState
  deleteState:    ActionState
  router:         ReturnType<typeof useRouter>
}

/**
 * Side-effect watchers for server-action states.
 *
 * Each effect subscribes to one action's result and shows a toast on error
 * (or success + navigation, for delete).
 *
 * Extracted from use-request-form to keep the main hook focused on form logic.
 */
export function useActionWatchers({
  submitState, cancelState, deleteState, router,
}: ActionWatchersInput) {
  useEffect(() => {
    if (submitState.message && !submitState.ok) {
      toast.error(submitState.message)
    }
  }, [submitState])

  useEffect(() => {
    if (cancelState.message && !cancelState.ok) {
      toast.error(cancelState.message)
    }
  }, [cancelState])

  useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) {
      toast.success(deleteState.message)
      router.push("/solicitudes")
    } else {
      toast.error(deleteState.message)
    }
  }, [deleteState, router])
}
