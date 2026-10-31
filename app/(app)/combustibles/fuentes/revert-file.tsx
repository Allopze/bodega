"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { revertBatchAction } from "../actions-consumos"
import { revertBatchOperationsAction } from "../actions-operaciones-batch"
import { revertControlImportBatchAction } from "../control/importar/actions"
import { revertTaeImportBatchAction } from "../tae/importar/actions"
import type { ImportedFileKind } from "./imported-file-kinds"

export interface RevertTarget {
  kind: ImportedFileKind
  id: string
  fileName: string
  newRows?: number | null
  updatedRows?: number | null
}

/** Cada tipo de archivo se revierte con su propia acción (cada una recalcula lo suyo); acá se unifican. */
export async function revertImportedFile(kind: ImportedFileKind, id: string): Promise<OperationResult> {
  if (kind === "tarjeta" || kind === "planilla") {
    const formData = new FormData()
    formData.set("batchId", id)
    const response = kind === "tarjeta"
      ? await revertBatchAction({ ok: true }, formData)
      : await revertBatchOperationsAction({ ok: true }, formData)
    return { ok: response.ok, message: response.message }
  }
  if (kind === "sellos") {
    const response = await revertTaeImportBatchAction(id)
    return { ok: response.ok, message: response.message }
  }
  const response = await revertControlImportBatchAction({ batchId: id })
  return { ok: response.ok, message: response.message }
}

/** Lo que borra revertir, dicho por tipo: es un acto irreversible y se explica. */
export function revertDescription(target: RevertTarget): string {
  const traza = "El archivo y su historial se conservan para trazabilidad. Queda registrado en la auditoría. Esta acción no se puede deshacer."
  switch (target.kind) {
    case "tarjeta":
      return `Se eliminarán los totales por patente y mes que trajo «${target.fileName}». ${traza}`
    case "planilla":
      return `Se eliminarán las cargas que trajo «${target.fileName}» y se recalculará el rendimiento de los equipos afectados. ${traza}`
    case "sellos":
      return `Se eliminarán todas las cargas y evidencias que importó «${target.fileName}». ${traza}`
    default:
      return `Se eliminarán las ${formatQty(target.newRows ?? 0)} filas que «${target.fileName}» creó. Las ${formatQty(target.updatedRows ?? 0)} que sólo actualizó conservan los valores nuevos. ${traza}`
  }
}

/** El diálogo de «Revertir» compartido por la lista y la ficha: un solo texto, una sola confirmación. */
export function RevertFileDialog({ target, onClose }: { target: RevertTarget | null; onClose: () => void }) {
  const router = useRouter()
  const { pending, message, setMessage, run } = useOperation()

  function confirm() {
    if (!target) return
    const { kind, id } = target
    run(() => revertImportedFile(kind, id), (result) => {
      toast.success(result.message ?? "Archivo revertido")
      onClose()
      router.refresh()
    })
  }

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => { if (!open && !pending) { onClose(); setMessage("") } }}
      title="¿Revertir este archivo?"
      description={target ? revertDescription(target) : ""}
      confirmLabel="Revertir archivo"
      variant="destructive"
      loading={pending}
      error={message || undefined}
      onConfirm={confirm}
    />
  )
}

/** «Revertir» de la ficha de un archivo. Sin el permiso, o con el archivo ya revertido, no se pinta. */
export function RevertFileButton({ target, canRevert }: { target: RevertTarget; canRevert: boolean }) {
  const [open, setOpen] = React.useState(false)
  if (!canRevert) return null
  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <ArrowCounterClockwise size={14} aria-hidden />Revertir archivo
      </Button>
      <RevertFileDialog target={open ? target : null} onClose={() => setOpen(false)} />
    </>
  )
}
