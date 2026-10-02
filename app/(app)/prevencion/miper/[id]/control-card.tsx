"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CONTROL_HIERARCHY_LABEL, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { formatDate } from "@/lib/utils"

export function ControlCard({ control, linkedActionNumbers, editable, verifyHref, onEdit, onDelete, deleting }: {
  control: MiperControlSnapshot
  linkedActionNumbers: readonly number[]
  editable: boolean
  verifyHref: string | null
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const short = control.description.length > 60 ? `${control.description.slice(0, 60)}…` : control.description
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
          <Button size="sm" variant="secondary" aria-label={`Editar la medida: ${short}`} onClick={onEdit}>Editar</Button>
          <Button size="sm" variant="ghost" aria-label={`Eliminar la medida: ${short}`} onClick={() => setConfirming(true)}>Eliminar</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming} onOpenChange={setConfirming}
        title="Eliminar la medida" description={`Se elimina «${short}». El cambio queda en el historial de la MIPER.`}
        confirmLabel="Eliminar medida" variant="destructive" loading={deleting}
        onConfirm={() => { onDelete(); setConfirming(false) }}
      />
    </article>
  )
}
