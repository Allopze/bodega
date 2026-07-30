"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { approveItemAction, rejectItemAction, returnItemAction, bulkApproveRequestAction } from "./actions"
import type { ActionState } from "@/lib/validation/operations"

export function useItemActions() {
  const [approveState, approveAction, approvePending] = useActionState<ActionState, FormData>(
    approveItemAction, INITIAL_STATE,
  )
  const [rejectState, rejectAction, rejectPending] = useActionState<ActionState, FormData>(
    rejectItemAction, INITIAL_STATE,
  )
  // `returnItemAction` existía completa —con permisos, observaciones obligatorias
  // y su propio estado de dominio `returned`— y **ningún botón la alcanzaba**,
  // mientras el CTA de /pendientes prometía "Aprobar o devolver" y la cola
  // pintaba `returned` como "Bloqueada" (auditoría UI/UX 2026-07-29, A-24).
  const [returnState, returnAction, returnPending] = useActionState<ActionState, FormData>(
    returnItemAction, INITIAL_STATE,
  )
  const decided =
    approveState.ok ? "approved" :
    rejectState.ok ? "rejected" :
    returnState.ok ? "returned" :
    null as "approved" | "rejected" | "returned" | null

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

  React.useEffect(() => {
    if (returnState.ok && returnState.message) {
      toast.success(returnState.message)
    } else if (returnState.ok === false && returnState.message && returnState !== INITIAL_STATE) {
      toast.error(returnState.message)
    }
  }, [returnState])

  return {
    approveState, approveAction, approvePending,
    rejectState, rejectAction, rejectPending,
    returnState, returnAction, returnPending,
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
