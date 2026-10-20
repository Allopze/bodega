"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { RunSaveStatus } from "./run-status"
import type { RunViewModel } from "./run-view-types"

export type MobileActionBarModel = Pick<
  RunViewModel,
  "editable" | "canCurrentUserReview" | "showMobileActionBar" | "channel"
>

/**
 * La barra fija del teléfono: la línea de estado de guardado y debajo
 * [Guardar] [Declarar ejecutada] al editar, o [Revisar y cerrar] al revisar. No
 * pinta nada si no hay acción que ofrecer (`showMobileActionBar`).
 *
 * Ninguno de los dos diálogos se monta aquí: «Declarar ejecutada» avisa con
 * `onDeclare` y «Revisar y cerrar» con `onReview`, y la vista que corresponda
 * (captura o lectura) los abre, para que exista una sola copia de cada uno (el
 * botón de la cabecera del escritorio abre el mismo). Las acciones del registro
 * (Acta PDF, Reabrir, Cancelar) ya no viven aquí: están en el encabezado de la
 * página.
 */
export function MobileActionBar({ model, onDeclare, onReview, reviewLabel }: {
  model: MobileActionBarModel
  onDeclare?: () => void
  onReview?: () => void
  /** «Revisar y cerrar» o «Revisar y cerrar · 2 bloqueos». */
  reviewLabel?: string
}) {
  const { editable, canCurrentUserReview, showMobileActionBar, channel } = model
  if (!showMobileActionBar) return null
  return (
    <div role="group" aria-label="Acciones de la inspección en el teléfono" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
      {editable ? (
        <>
          {/* P1-7: el mismo estado que el escritorio, a la vista de quien trabaja de pie. */}
          <RunSaveStatus state={channel.captureState} className="col-span-2 text-center" />
          <Button type="button" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>{channel.saving ? "Guardando…" : "Guardar"}</Button>
          <Button type="button" disabled={channel.locked || !onDeclare} onClick={onDeclare}>Declarar ejecutada</Button>
        </>
      ) : canCurrentUserReview ? (
        <div className="col-span-2"><Button type="button" className="w-full" disabled={!onReview} onClick={onReview}>{reviewLabel ?? "Revisar y cerrar"}</Button></div>
      ) : null}
    </div>
  )
}
