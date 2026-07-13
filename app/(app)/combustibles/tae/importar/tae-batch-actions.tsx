"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { revertTaeImportBatchAction } from "./actions"

export function RevertTaeBatchButton({ batchId, canRevert }: { batchId: string; canRevert: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!canRevert) return null

  async function handleConfirm() {
    setLoading(true)
    const result = await revertTaeImportBatchAction(batchId)
    setLoading(false)
    setOpen(false)
    if (result.ok) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash className="h-4 w-4" /> Revertir lote
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Revertir este lote TAE?"
        description="Se eliminarán todas las cargas y evidencias importadas por este lote. La cabecera, sus métricas y la auditoría se conservarán. Esta acción no se puede deshacer."
        confirmLabel="Revertir lote"
        variant="destructive"
        onConfirm={handleConfirm}
        loading={loading}
      />
    </>
  )
}
