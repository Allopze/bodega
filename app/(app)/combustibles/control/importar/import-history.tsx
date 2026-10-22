"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise, DownloadSimple } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { downloadBase64Xlsx } from "@/components/ui/export-button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { CONTROL_IMPORT_KIND_LABELS } from "@/lib/combustibles/control/imports/constants"
import type { ControlImportBatchRow } from "@/lib/combustibles/control/imports/service"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime, formatQty } from "@/lib/utils"
import { exportBatchRejectionsAction, revertControlImportBatchAction } from "./actions"

function StatusBadge({ status }: { status: ControlImportBatchRow["status"] }) {
  return status === "reverted" ? <Badge variant="neutral">Revertido</Badge> : <Badge variant="success">Importado</Badge>
}

function RowActions({ batch, canRevert, onRevert }: { batch: ControlImportBatchRow; canRevert: boolean; onRevert: (batch: ControlImportBatchRow) => void }) {
  const [downloading, setDownloading] = React.useState(false)

  async function downloadRejections() {
    setDownloading(true)
    try {
      const result = await exportBatchRejectionsAction(batch.id)
      if (result.ok && result.data) downloadBase64Xlsx(result.data.base64, result.data.filename)
      else toast.error(result.message ?? "No se pudo descargar el archivo")
    } catch {
      toast.error("No se pudo descargar el archivo")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {batch.rejectedRows > 0 ? (
        <Button variant="ghost" size="sm" onClick={downloadRejections} loading={downloading} aria-label={`Descargar rechazos de ${batch.fileName}`}>
          <DownloadSimple size={14} aria-hidden />Rechazos
        </Button>
      ) : null}
      {canRevert && batch.status === "imported" ? (
        <Button variant="ghost" size="sm" onClick={() => onRevert(batch)} aria-label={`Revertir el lote ${batch.fileName}`}>
          <ArrowCounterClockwise size={14} aria-hidden />Revertir
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Historial de lotes importados: quién importó qué, cuántas filas entraron,
 * cuántas actualizaron y cuántas se rechazaron, con descarga de los rechazos y
 * reversión (permiso `combustibles:revert`, que el servidor vuelve a exigir).
 */
export function ImportHistory({ batches, canRevert }: { batches: ControlImportBatchRow[]; canRevert: boolean }) {
  const router = useRouter()
  const [target, setTarget] = React.useState<ControlImportBatchRow | null>(null)
  const { pending, message, setMessage, run } = useOperation()

  function confirmRevert() {
    if (!target) return
    const batchId = target.id
    run(
      () => revertControlImportBatchAction({ batchId }),
      (result) => {
        toast.success(result.message ?? "Lote revertido")
        setTarget(null)
        router.refresh()
      },
    )
  }

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {batches.map((batch) => (
          <ResponsiveDataListCard
            key={batch.id}
            title={batch.fileName}
            description={`${CONTROL_IMPORT_KIND_LABELS[batch.kind]} · ${formatDateTime(batch.createdAt)}`}
            status={<StatusBadge status={batch.status} />}
            actions={<RowActions batch={batch} canRevert={canRevert} onRevert={setTarget} />}
          >
            <ResponsiveDataListField label="Importado por">{batch.importedByName ?? "Sin responsable"}</ResponsiveDataListField>
            <ResponsiveDataListField label="Filas nuevas / actualizadas">{formatQty(batch.insertedRows)} / {formatQty(batch.updatedRows)}</ResponsiveDataListField>
            <ResponsiveDataListField label="Rechazadas">{formatQty(batch.rejectedRows)}</ResponsiveDataListField>
          </ResponsiveDataListCard>
        ))}
      </div>

      <TableRoot className="hidden md:block" aria-label="Historial de importaciones del control">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Archivo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Importado por</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Nuevas</TableHead>
              <TableHead className="text-right">Actualizadas</TableHead>
              <TableHead className="text-right">Rechazadas</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell className="max-w-64 truncate font-medium" title={batch.fileName}>{batch.fileName}</TableCell>
                <TableCell>{CONTROL_IMPORT_KIND_LABELS[batch.kind]}</TableCell>
                <TableCell>{batch.importedByName ?? "Sin responsable"}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(batch.createdAt)}</TableCell>
                <TableCellNum>{formatQty(batch.insertedRows)}</TableCellNum>
                <TableCellNum>{formatQty(batch.updatedRows)}</TableCellNum>
                <TableCellNum>{formatQty(batch.rejectedRows)}</TableCellNum>
                <TableCell><StatusBadge status={batch.status} /></TableCell>
                <TableCell><RowActions batch={batch} canRevert={canRevert} onRevert={setTarget} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => { if (!open && !pending) { setTarget(null); setMessage("") } }}
        title="Revertir lote importado"
        description={target
          ? `Se eliminarán las ${formatQty(target.insertedRows)} filas que «${target.fileName}» creó. Las ${formatQty(target.updatedRows)} que solo actualizó conservan los valores nuevos. Queda registrado en la auditoría.`
          : ""}
        confirmLabel="Revertir lote"
        variant="destructive"
        loading={pending}
        error={message || undefined}
        onConfirm={confirmRevert}
      />
    </>
  )
}
