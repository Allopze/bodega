"use client"

import { useState, useTransition } from "react"
import { Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { archiveSstDocumentAction } from "../actions"

interface Props {
  documentId: string
  disabled: boolean
  onArchived: () => void
}

export function ArchiveButton({ documentId, disabled, onArchived }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <Trash size={14} className="mr-1" /> Archivar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archivar documento"
        description="El documento se marca como archivado. Las versiones aprobadas y vigentes se mantienen como evidencia histórica."
        variant="destructive"
        confirmLabel="Archivar"
        onConfirm={() => {
          startTransition(async () => {
            const res = await archiveSstDocumentAction({ documentId, comment: "Archivado" })
            if (res.ok) {
              toast.success(res.message ?? "Documento archivado.")
              setOpen(false)
              onArchived()
            } else {
              toast.error(res.message ?? "Error al archivar.")
            }
          })
        }}
        loading={isPending}
      />
    </>
  )
}
