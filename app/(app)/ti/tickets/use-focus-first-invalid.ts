"use client"

import * as React from "react"
import type { ActionState } from "@/lib/form-state"

/**
 * Tras un envío fallido, lleva el foco al primer campo inválido (o, si el
 * error no es de un campo, a la alerta del formulario). Sin esto, quien usa
 * teclado o lector de pantalla queda donde estaba el botón «Enviar», sin saber
 * que algo falló ni dónde.
 *
 * El foco solo se mueve cuando llega un resultado nuevo: la acción devuelve un
 * objeto distinto en cada envío, así que depender de `state` basta.
 */
export function useFocusFirstInvalid(
  formRef: React.RefObject<HTMLFormElement | null>,
  state: ActionState,
) {
  React.useEffect(() => {
    if (state.ok || !state.message) return
    const form = formRef.current
    if (!form) return
    const hasFieldErrors = Boolean(state.fieldErrors && Object.keys(state.fieldErrors).length > 0)
    const target = hasFieldErrors
      ? form.querySelector<HTMLElement>('[aria-invalid="true"]')
      : form.querySelector<HTMLElement>("[data-form-alert]")
    target?.focus()
  }, [state, formRef])
}
