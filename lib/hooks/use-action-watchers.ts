"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"

/**
 * Watcher genérico: muestra toast.success/error según el resultado de cada
 * `ActionState` vigilado. El estado idle (`{ ok: false }` sin message) no
 * emite nada, así que la referencia exacta del initial state es irrelevante.
 *
 * Antes cada pantalla tenía sus bloques `useEffect` idénticos por acción
 * (aprobaciones tenía tres: approve/reject/bulk).
 */
export function useActionStateToast(states: readonly ActionState[]) {
  useEffect(() => {
    for (const state of states) {
      if (state.ok && state.message) toast.success(state.message)
      else if (state.ok === false && state.message) toast.error(state.message)
    }
    // Los estados son la única dependencia real: la lista se rearma en cada
    // render, pero `useActionState` devuelve la misma referencia hasta que la
    // acción corre, así que el efecto no vuelve a tostar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, states)
}

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
