"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { captureStatusLabel, type CaptureSaveState } from "@/lib/prevention/inspection-capture"
import { cn } from "@/lib/utils"
import type { OfflineCloseEntry } from "../_hooks/use-offline-close-queue"
import type { PendingRestore, RestoreNotice } from "../_hooks/use-inspection-draft"

/* ── Estado de guardado ───────────────────────────────────────────────────────
 * UNA sola fuente de verdad: el escritorio y la barra fija del teléfono pintan
 * este mismo componente con el mismo estado, así que no pueden contradecirse
 * (P1-7: en el teléfono el rótulo no existía y quien ejecuta no sabía si podía
 * irse de la pantalla). El color acompaña al texto, nunca lo sustituye.
 */

function toneClass(state: CaptureSaveState): string {
  switch (state.kind) {
    case "saved":
      return state.heldCount > 0 ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text-subtle)]"
    case "saving":
    case "closing":
      return "text-[var(--color-text-subtle)]"
    case "dirty":
    case "offline":
    case "retrying":
    case "queued_close":
      return "text-[var(--color-warning-ink)]"
    case "conflict":
    case "not_editable":
    case "rejected":
      return "text-[var(--color-danger-ink)]"
  }
}

export function RunSaveStatus({ state, className }: { state: CaptureSaveState; className?: string }) {
  return (
    <span
      role="status"
      data-save-state={state.kind}
      className={cn("text-xs font-medium", toneClass(state), className)}
    >
      {captureStatusLabel(state)}
    </span>
  )
}

/* ── Avisos de la captura ─────────────────────────────────────────────────────
 * Reemplazan al banner que pintaba de verde los errores de guardado (P1-8) y a
 * los textos que prometían «tus respuestas siguen guardadas en este
 * dispositivo» sin que fuera cierto fuera de la pestaña.
 */

export interface RunCaptureMessagesProps {
  state: CaptureSaveState
  /** Rechazo permanente del servidor al guardar (no el del cierre guardado). */
  rejection: string | null
  /** El dispositivo no dejó escribir el espejo (cuota llena o almacenamiento bloqueado). */
  mirrorFailed: boolean
  restoreNotice: RestoreNotice | null
  pendingRestore: PendingRestore | null
  /** Esperando que el servidor devuelva su versión para recuperar o descartar. */
  resyncing: boolean
  onRecover: () => void
  onDiscard: () => void
  onViewCurrent: () => void
  onRetry: () => void
  onRecoverPending: () => void
  onDiscardPending: () => void
}

export function RunCaptureMessages({
  state, rejection, mirrorFailed, restoreNotice, pendingRestore, resyncing,
  onRecover, onDiscard, onViewCurrent, onRetry, onRecoverPending, onDiscardPending,
}: RunCaptureMessagesProps) {
  return (
    <>
      {state.kind === "conflict" && (
        <Callout tone="warning" role="alert" title="La inspección cambió en otra sesión">
          <p>Tus cambios sin guardar siguen en este dispositivo.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" loading={resyncing} onClick={onRecover}>Recuperar mis cambios</Button>
            <Button type="button" size="sm" variant="ghost" disabled={resyncing} onClick={onDiscard}>Descartar mis cambios</Button>
          </div>
        </Callout>
      )}

      {state.kind === "not_editable" && (
        <Callout tone="danger" role="alert">
          <p>Esta inspección ya no se puede editar: fue declarada ejecutada, cerrada o cancelada en otra sesión. Los cambios sin enviar de este dispositivo no se guardarán.</p>
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" onClick={onViewCurrent}>Ver la versión actual</Button>
          </div>
        </Callout>
      )}

      {rejection !== null && (
        <Callout tone="danger" role="alert">
          <p>{rejection}</p>
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>Reintentar</Button>
          </div>
        </Callout>
      )}

      {state.kind === "offline" && (
        mirrorFailed ? (
          <Callout tone="danger" role="alert">
            Sin conexión y sin espacio en este dispositivo: no cierres esta pestaña hasta que vuelva la señal.
          </Callout>
        ) : (
          <Callout tone="info" role="status">
            Sin conexión. Tus respuestas quedan guardadas en este dispositivo y se enviarán solas al volver la señal. No cierres sesión hasta entonces.
          </Callout>
        )
      )}

      {pendingRestore && (
        <Callout tone="warning" role="alert" title="Hay cambios de este dispositivo sin enviar">
          <p>
            La inspección se guardó desde otra sesión después de esos cambios
            {pendingRestore.count > 0 && ` (${pendingRestore.count} ${pendingRestore.count === 1 ? "respuesta" : "respuestas"})`}
            . Recupéralos para aplicarlos sobre la versión actual, o descártalos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onRecoverPending}>Recuperar mis cambios</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDiscardPending}>Descartar</Button>
          </div>
        </Callout>
      )}

      {/* «Se están guardando» deja de ser cierto en cuanto se guardó. */}
      {restoreNotice?.kind === "applied" && state.kind !== "saved" && (
        <Callout tone="info" role="status">
          Recuperamos cambios de este dispositivo que no alcanzaron a enviarse. Se están guardando.
        </Callout>
      )}

      {restoreNotice?.kind === "not_editable" && (
        <Callout tone="warning" role="status">
          Había cambios de este dispositivo sin enviar que ya no se pueden guardar porque la inspección está {restoreNotice.statusLabel}.
        </Callout>
      )}
    </>
  )
}

/* ── Cierre guardado en el dispositivo ────────────────────────────────────────
 * Sin señal el cierre no se pierde: queda en el dispositivo y se envía solo al
 * volver. Mientras esté pendiente la edición queda bloqueada, porque lo
 * guardado es una foto del trabajo y editar encima la dejaría desfasada.
 */

export function OfflineClosePanel({
  entry, sending, online, onSendNow, onKeepEditing, onRecover, onDiscard,
}: {
  entry: OfflineCloseEntry
  sending: boolean
  online: boolean
  onSendNow: () => void
  onKeepEditing: () => void
  onRecover: () => void
  onDiscard: () => void
}) {
  if (entry.rejected) {
    return (
      <Callout tone="danger" role="alert" title="No se pudo enviar el cierre guardado en este dispositivo">
        <p>{entry.lastError ?? "El servidor no aceptó el cierre."}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onRecover}>Recuperar el cierre</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>Descartar</Button>
        </div>
      </Callout>
    )
  }
  return (
    <Callout tone="info" role="status" title="Cierre guardado en este dispositivo">
      <p>{online ? "Se está enviando o se enviará solo en unos segundos." : "Se enviará solo al volver la señal."}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" loading={sending} disabled={!online} onClick={onSendNow}>Enviar ahora</Button>
        <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={onKeepEditing}>Seguir editando</Button>
      </div>
    </Callout>
  )
}
