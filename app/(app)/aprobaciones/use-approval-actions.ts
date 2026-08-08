"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
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

  React.useEffect(() => {
    if (approveState.ok && approveState.message) {
      toast.success(approveState.message)
    } else if (approveState.ok === false && approveState.message && approveState !== INITIAL_STATE) {
      toast.error(approveState.message)
    }
  }, [approveState])

  React.useEffect(() => {
    if (rejectState.ok && rejectState.message) {
      toast.success(rejectState.message)
    } else if (rejectState.ok === false && rejectState.message && rejectState !== INITIAL_STATE) {
      toast.error(rejectState.message)
    }
  }, [rejectState])

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

  React.useEffect(() => {
    if (bulkState.ok && bulkState.message) {
      toast.success(bulkState.message)
    } else if (bulkState.ok === false && bulkState.message && bulkState !== INITIAL_STATE) {
      toast.error(bulkState.message)
    }
  }, [bulkState])

  return { bulkState, bulkAction, bulkPending }
}
