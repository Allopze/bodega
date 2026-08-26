"use client"

import { useActionState } from "react"
import { INITIAL_STATE } from "@/lib/form-state"
import { useActionStateToast } from "@/lib/hooks/use-action-watchers"
import { approveItemAction, rejectItemAction, bulkApproveRequestAction } from "./actions"
import type { ActionState } from "@/lib/validation/operations"

export function useItemActions() {
  const [approveState, approveAction, approvePending] = useActionState<ActionState, FormData>(
    approveItemAction, INITIAL_STATE,
  )
  const [rejectState, rejectAction, rejectPending] = useActionState<ActionState, FormData>(
    rejectItemAction, INITIAL_STATE,
  )
  const decided =
    approveState.ok ? "approved" :
    rejectState.ok ? "rejected" :
    null as "approved" | "rejected" | null

  useActionStateToast([approveState, rejectState])

  return {
    approveState, approveAction, approvePending,
    rejectState, rejectAction, rejectPending,
    decided,
  }
}

export function useBulkApproveAction() {
  const [bulkState, bulkAction, bulkPending] = useActionState<ActionState, FormData>(
    bulkApproveRequestAction, INITIAL_STATE,
  )

  useActionStateToast([bulkState])

  return { bulkState, bulkAction, bulkPending }
}
