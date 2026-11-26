"use client"

import * as React from "react"
import { voidPartsNoteAction } from "@/app/(app)/mantencion/notas-pedido/actions"
import { Button } from "@/components/ui/button"
import { NoteReasonDialog } from "./note-reason-dialog"

/** «Anular nota» del encabezado de la página (acción de toda la nota: regla 5 de `app/AGENTS.md`). */
export function VoidNoteButton({ noteId, code }: { noteId: string; code: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Anular nota</Button>
      {open && (
        <NoteReasonDialog
          onOpenChange={setOpen}
          title={`Anular ${code}`}
          description="Queda visible como anulada, con su motivo, y deja de esperar repuestos. No se puede deshacer."
          label="Motivo de la anulación"
          submitLabel="Anular nota"
          destructive
          action={(reason) => voidPartsNoteAction({ noteId, reason })}
          successMessage="Nota anulada"
        />
      )}
    </>
  )
}
