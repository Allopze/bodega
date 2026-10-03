"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import { CONTROL_HIERARCHY_LABEL, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"

/**
 * Tarjeta de una medida. El borrado se confirma y el diálogo **espera la
 * respuesta** (A2, fila 9): si el servidor lo rechaza (otra persona la editó,
 * cubre una actividad del PDTP…), el motivo queda en el diálogo, que no se
 * cierra hasta que la persona decide.
 */
export function ControlCard({ control, linkedActionNumbers, editable, verifyHref, onEdit, onDelete, editDisabled = false }: {
  control: MiperControlSnapshot
  linkedActionNumbers: readonly number[]
  editable: boolean
  verifyHref: string | null
  onEdit: () => void
  /** Borra la medida. El diálogo espera la respuesta: cierra si salió bien y, si no, muestra el motivo. */
  onDelete: () => Promise<OperationResult>
  /** Hay otra medida abierta en edición: no se abre una segunda ni se borra otra a la vez. */
  editDisabled?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const deletion = useOperation()
  const short = control.description.length > 60 ? `${control.description.slice(0, 60)}…` : control.description
  const onOpenChange = (open: boolean) => {
    // Mientras el servidor responde, el diálogo no se cierra (ni con Escape).
    if (deletion.pending) return
    setConfirming(open)
    if (!open) deletion.setMessage("")
  }
  return (
    <article aria-label={`Medida: ${short}`} className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium">{CONTROL_HIERARCHY_LABEL[control.hierarchy]}</p>
        <p className="whitespace-pre-line">{control.description}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"} · Plazo: {control.dueDate ? formatDate(control.dueDate) : "sin plazo"}</p>
        {linkedActionNumbers.length > 0 && <p className="text-xs">En el programa: {linkedActionNumbers.map((number) => `Actividad #${number}`).join(", ")}</p>}
        {verifyHref && <Link className="text-xs underline" href={verifyHref}>Verificar eficacia del control</Link>}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" aria-label={`Editar la medida: ${short}`} disabled={editDisabled} onClick={onEdit}>Editar</Button>
          <Button size="sm" variant="ghost" aria-label={`Eliminar la medida: ${short}`} disabled={editDisabled} onClick={() => setConfirming(true)}>Eliminar</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming} onOpenChange={onOpenChange}
        title="Eliminar la medida" description={`Se elimina «${short}». El cambio queda en el historial de la MIPER.`}
        confirmLabel="Eliminar medida" variant="destructive" loading={deletion.pending} error={deletion.message || undefined}
        onConfirm={() => deletion.run(onDelete, (result) => { setConfirming(false); toast.success(result.message ?? "Medida eliminada") })}
      />
    </article>
  )
}
