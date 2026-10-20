"use client"

import * as React from "react"
import { OfflineClosePanel, RunCaptureMessages } from "./run-status"
import type { RunViewModel } from "./run-view-types"

export type RunCaptureNoticesModel = Pick<RunViewModel, "canExecute" | "channel" | "inspectionDraft" | "rejection">

/**
 * Los avisos de guardado y el panel del cierre guardado sin conexión (P1-8):
 * cada uno dice qué pasó, y el que exige acción trae sus botones. Los ven
 * quienes pueden ejecutar, también cuando la pantalla ya no es editable (p. ej.
 * justo después de declararla ejecutada o con un cierre en cola).
 */
export function RunCaptureNotices({ model }: { model: RunCaptureNoticesModel }) {
  const { canExecute, channel, inspectionDraft, rejection } = model
  if (!canExecute) return null
  return (
    <>
      {/* P1-8: los avisos de guardado ya no se pintan de verde ni prometen lo que
          no es cierto. Cada uno dice qué pasó, y el que exige acción trae sus botones. */}
      <RunCaptureMessages
        state={channel.captureState}
        rejection={rejection}
        mirrorFailed={channel.mirrorFailed}
        restoreNotice={inspectionDraft.restoreNotice}
        pendingRestore={inspectionDraft.pendingRestore}
        resyncing={channel.resyncing}
        onRecover={channel.recoverConflict}
        onDiscard={channel.discardConflict}
        onViewCurrent={channel.viewCurrent}
        onRetry={() => void channel.retry()}
        onRecoverPending={inspectionDraft.recoverPending}
        onDiscardPending={inspectionDraft.discardPending}
      />

      {channel.queue.entry && (
        <OfflineClosePanel
          entry={channel.queue.entry}
          sending={channel.queue.sending}
          online={channel.online}
          onSendNow={() => void channel.queue.sendNow()}
          onKeepEditing={() => void channel.queue.discard()}
          onRecover={() => void channel.queue.recover()}
          onDiscard={() => void channel.queue.discard()}
        />
      )}
    </>
  )
}
