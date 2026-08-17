"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"

type ToggleAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

/**
 * Centralizes the sheet-open/edit-row state and the activate/deactivate
 * useActionState + toast wiring repeated across every catalog list
 * (faenas-list, worker-list, supplier-list, ...).
 */
export function useCatalogSheet<T>(toggleAction: ToggleAction) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editRow, setEditRow] = useState<T | null>(null)
  const [toggleState, toggleFormAction, togglePending] = useActionState(toggleAction, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openCreate() { setEditRow(null); setSheetOpen(true) }
  function openEdit(row: T) { setEditRow(row); setSheetOpen(true) }
  function closeSheet() { setSheetOpen(false) }

  // `toggleState` se expone para los catálogos cuyo diálogo de confirmación
  // puede ser rechazado por el servidor: cerrarlo al enviar deja al usuario sin
  // el formulario que tiene que corregir.
  return { sheetOpen, editRow, openCreate, openEdit, closeSheet, toggleAction: toggleFormAction, togglePending, toggleState }
}
