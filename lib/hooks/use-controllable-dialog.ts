"use client"

import * as React from "react"

export interface ControllableDialogProps {
  /** Si se pasa, el diálogo lo abre el padre y no pinta su propio disparador. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Estado de apertura de un diálogo de alta que funciona igual con disparador
 * propio (no controlado) que abierto desde fuera —p. ej. desde
 * `CreateChoiceButton`, que lo abre sin pasar por un `DialogTrigger`—.
 *
 * `onOpen` es el "parte de cero al abrir" que ya tenían estos diálogos (faena
 * por defecto, hora de inicio sugerida…). Sin disparador, Radix nunca llama
 * `onOpenChange(true)`, así que en modo controlado se ejecuta al ver que `open`
 * pasó a `true`. Se hace durante el render (el patrón de React para "ajustar
 * estado cuando cambia una prop") y no en un efecto: varios campos son no
 * controlados (`defaultValue`) y sólo toman el valor con el que se montan; un
 * efecto llegaría después del montaje del formulario.
 */
export function useControllableDialog(
  { open: openProp, onOpenChange }: ControllableDialogProps,
  onOpen?: () => void,
) {
  const [innerOpen, setInnerOpen] = React.useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : innerOpen
  // `false` de partida: un diálogo que ya se monta abierto también parte de cero.
  const [seenOpen, setSeenOpen] = React.useState(false)
  if (controlled && open !== seenOpen) {
    setSeenOpen(open)
    if (open) onOpen?.()
  }

  function setOpen(value: boolean) {
    if (!controlled) {
      if (value) onOpen?.()
      setInnerOpen(value)
    }
    onOpenChange?.(value)
  }

  return { open, setOpen, controlled }
}
