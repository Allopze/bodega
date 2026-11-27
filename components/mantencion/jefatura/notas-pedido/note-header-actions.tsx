"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  acceptPartsNoteAction, holdPartsNoteAction, rejectPartsNoteAction, reopenPartsNoteAction, voidPartsNoteAction,
} from "@/app/(app)/mantencion/notas-pedido/actions"
import { Button } from "@/components/ui/button"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import type { NoteActionKey } from "@/lib/services/mantencion/parts-notes/transitions"
import { NoteReasonDialog } from "./note-reason-dialog"
import { NOTE_ACTION_LABELS } from "./parts-notes-format"

type ReasonAction = Exclude<NoteActionKey, "aceptar">

/** Lo que pide el diálogo de cada acción con motivo, y la acción de servidor que llama con el motivo ya recortado. */
const REASON_ACTIONS: Record<ReasonAction, {
  title: (code: string) => string
  description: string
  label: string
  destructive: boolean
  run: (noteId: string, reason: string) => Promise<OperationResult>
  success: string
}> = {
  en_espera: {
    title: (code) => `Poner ${code} en espera`,
    description: "Mientras esté en espera no se resuelven sus líneas. El motivo queda en el historial y se muestra en la nota; con «Aceptar» sigue su curso.",
    label: "Motivo de la espera",
    destructive: false,
    run: (noteId, reason) => holdPartsNoteAction({ noteId, reason }),
    success: "Nota en espera",
  },
  rechazar: {
    title: (code) => `Rechazar ${code}`,
    description: "Se rechazan todas las líneas que siguen pendientes, con este motivo, y el solicitante lo ve. Después se puede reabrir.",
    label: "Motivo del rechazo",
    destructive: true,
    run: (noteId, reason) => rejectPartsNoteAction({ noteId, reason }),
    success: "Nota rechazada",
  },
  anular: {
    title: (code) => `Anular ${code}`,
    description: "Queda visible como anulada, con su motivo, y deja de esperar repuestos. No se puede deshacer.",
    label: "Motivo de la anulación",
    destructive: true,
    run: (noteId, reason) => voidPartsNoteAction({ noteId, reason }),
    success: "Nota anulada",
  },
  reabrir: {
    title: (code) => `Reabrir ${code}`,
    description: "Las líneas que se rechazaron vuelven a pendiente para resolverlas de nuevo. El motivo queda en el historial.",
    label: "Motivo de la reapertura",
    destructive: false,
    run: (noteId, reason) => reopenPartsNoteAction({ noteId, reason }),
    success: "Nota reabierta",
  },
}

/**
 * Acciones de cabecera de la nota en el encabezado de la página (acciones de toda la nota: regla 5 de `app/AGENTS.md`).
 * Muestra sólo las que el servidor dijo que valen para quien mira (`actions`, de `allowedNoteActions`). «Aceptar» no pide
 * confirmación ni motivo; las demás piden un motivo escrito en un diálogo. El servidor vuelve a validar estado, permiso y
 * alcance en cada una: esto es presentación, no autorización.
 */
export function NoteHeaderActions({ noteId, code, actions }: { noteId: string; code: string; actions: readonly NoteActionKey[] }) {
  const router = useRouter()
  const op = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const [dialog, setDialog] = React.useState<ReasonAction | null>(null)
  if (actions.length === 0) return null
  const spec = dialog ? REASON_ACTIONS[dialog] : null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((key) => key === "aceptar" ? (
          <Button key={key} size="sm" loading={op.pending} onClick={() => op.run(() => acceptPartsNoteAction({ noteId }))}>
            {NOTE_ACTION_LABELS[key]}
          </Button>
        ) : (
          <Button key={key} variant="secondary" size="sm" disabled={op.pending} onClick={() => setDialog(key)}>{NOTE_ACTION_LABELS[key]}</Button>
        ))}
      </div>
      {dialog && spec && (
        <NoteReasonDialog
          onOpenChange={(open) => { if (!open) setDialog(null) }}
          title={spec.title(code)}
          description={spec.description}
          label={spec.label}
          submitLabel={NOTE_ACTION_LABELS[dialog]}
          destructive={spec.destructive}
          action={(reason) => spec.run(noteId, reason)}
          successMessage={spec.success}
        />
      )}
    </>
  )
}
