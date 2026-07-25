"use client"

import * as React from "react"

/**
 * E-5 · `Enter` avanza al siguiente campo en formularios de captura repetitiva.
 *
 * En una estación de captura (entregas, recepción) el operador escribe cifra,
 * cifra, cifra. El comportamiento nativo de `Enter` dentro de un `<form>` es
 * enviarlo, así que hoy hay que ir al ratón o al `Tab` entre cada campo — el
 * viaje que la Ley de Fitts penaliza y que se repite decenas de veces al día.
 *
 * Este hook hace que `Enter` se comporte como `Tab` dentro del formulario, y
 * reserva el envío para el último campo (o para el botón de submit, que sigue
 * respondiendo a `Enter` cuando tiene el foco).
 *
 * Deliberadamente NO se aplica a:
 * - `<textarea>`, donde `Enter` significa salto de línea.
 * - `<select>` y controles Radix, que usan `Enter` para confirmar su opción.
 * - Botones, que ya tienen su propia semántica de activación.
 *
 * Uso:
 * ```tsx
 * const formRef = React.useRef<HTMLFormElement>(null)
 * useEnterAdvancesFields(formRef)
 * <form ref={formRef}>…</form>
 * ```
 */
export function useEnterAdvancesFields(
  formRef: React.RefObject<HTMLFormElement | null>,
  enabled = true,
) {
  React.useEffect(() => {
    const form = formRef.current
    if (!form || !enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (!target) return
      // Estos usan Enter para otra cosa; no se les toca.
      if (target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLSelectElement) return
      if (target instanceof HTMLButtonElement) return
      if (target.getAttribute("role") === "combobox") return
      if (target.isContentEditable) return
      if (!(target instanceof HTMLInputElement)) return

      const scope = event.currentTarget as HTMLFormElement
      const fields = [...scope.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])',
      )].filter((el) => (
        // `offsetParent !== null` sería lo obvio, pero da null también para los
        // `position: fixed` — es decir, habría ignorado todo formulario dentro de
        // un Dialog o un Sheet. `checkVisibility()` sí distingue oculto de
        // posicionado; donde no exista, no se filtra (mejor avanzar que no hacer nada).
        typeof el.checkVisibility === "function" ? el.checkVisibility() : true
      ))

      const index = fields.indexOf(target)
      if (index === -1) return

      const next = fields[index + 1]
      // En el último campo se conserva el envío nativo: el operador termina
      // la fila y confirma sin cambiar de mano.
      if (!next) return

      event.preventDefault()
      next.focus()
      if (next instanceof HTMLInputElement && next.type !== "checkbox" && next.type !== "radio") {
        next.select()
      }
    }

    form.addEventListener("keydown", onKeyDown)
    return () => form.removeEventListener("keydown", onKeyDown)
  }, [formRef, enabled])
}
