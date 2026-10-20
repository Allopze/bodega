"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { CompleteDialog } from "./complete-dialog"
import { ReviewDialog } from "./review-dialog"
import { RunSaveStatus } from "./run-status"
import type { RunViewModel } from "./run-view-types"

export type MobileActionBarModel = Pick<
  RunViewModel,
  | "run" | "editable" | "canExecute" | "canCurrentUserReview" | "showMobileActionBar"
  | "currentUserId" | "assignees" | "findings" | "channel" | "completion" | "jumpToItem"
>

/**
 * La barra fija del teléfono: estado de guardado y [Guardar] [Declarar
 * ejecutada] al editar, o [Revisar y cerrar] al revisar. No pinta nada si no
 * hay acción que ofrecer (`showMobileActionBar`).
 */
export function MobileActionBar({ model }: { model: MobileActionBarModel }) {
  const { run, editable, canExecute, canCurrentUserReview, showMobileActionBar, currentUserId, assignees, findings, channel, completion, jumpToItem } = model
  if (!showMobileActionBar) return null
  return (
    <div role="group" aria-label="Acciones de la inspección en el teléfono" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
      {editable ? (
        <>
          {/* P1-7: el mismo estado que el escritorio, a la vista de quien trabaja de pie. */}
          <RunSaveStatus state={channel.captureState} className="col-span-2 text-center" />
          <Button type="button" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>{channel.saving ? "Guardando…" : "Guardar"}</Button>
          <CompleteDialog
            run={run}
            completion={completion}
            held={channel.held}
            online={channel.online}
            saving={channel.saving}
            disabled={channel.locked}
            onComplete={channel.complete}
            onQueueClose={channel.queueClose}
            onJump={jumpToItem}
          />
        </>
      ) : canCurrentUserReview ? (
        <div className="col-span-2"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={channel.version} assignees={assignees} canExecute={canExecute} /></div>
      ) : null}
    </div>
  )
}
