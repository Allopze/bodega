"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowCounterClockwise, DownloadSimple } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { downloadBase64Xlsx } from "@/components/ui/export-button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { exportBatchRejectionsAction } from "../control/importar/actions"
import type { ImportedFileRow } from "./imported-files"
import { cardSourceLabel, IMPORTED_FILE_KIND_LABELS, IMPORTED_FILE_STATUS_LABELS } from "./imported-file-kinds"
import { RevertFileDialog, type RevertTarget } from "./revert-file"

function StatusBadge({ status }: { status: ImportedFileRow["status"] }) {
  return <MetaBadge meta={{ label: IMPORTED_FILE_STATUS_LABELS[status], variant: status === "revertido" ? "neutral" : "success" }} />
}

/** «1.228 nuevas · 12 rechazadas»: lo que trajo el archivo, en una frase corta. */
export function fileResult(row: Pick<ImportedFileRow, "newRows" | "updatedRows" | "rejectedRows">): string {
  const parts: string[] = []
  if (row.newRows !== null) parts.push(`${formatQty(row.newRows)} ${row.newRows === 1 ? "nueva" : "nuevas"}`)
  if (row.updatedRows) parts.push(`${formatQty(row.updatedRows)} ${row.updatedRows === 1 ? "actualizada" : "actualizadas"}`)
  if (row.rejectedRows) parts.push(`${formatQty(row.rejectedRows)} ${row.rejectedRows === 1 ? "rechazada" : "rechazadas"}`)
  return parts.length ? parts.join(" · ") : "—"
}

function periodOf(row: Pick<ImportedFileRow, "period">): string | null {
  return row.period ? `${formatDate(row.period.from)} a ${formatDate(row.period.to)}` : null
}

function RowActions({ row, onRevert }: { row: ImportedFileRow; onRevert: (row: ImportedFileRow) => void }) {
  const [downloading, setDownloading] = React.useState(false)
  // Las importaciones del control no tienen ficha: los rechazos se bajan desde la lista.
  const inline = row.href === null

  async function downloadRejections() {
    setDownloading(true)
    try {
      const result = await exportBatchRejectionsAction(row.id)
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
      {row.href ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={row.href} aria-label={`Ver el detalle de ${row.fileName}`}>Ver</Link>
        </Button>
      ) : null}
      {inline && (row.rejectedRows ?? 0) > 0 ? (
        <Button variant="ghost" size="sm" onClick={downloadRejections} loading={downloading} aria-label={`Descargar los rechazos de ${row.fileName}`}>
          <DownloadSimple size={14} aria-hidden />Rechazos
        </Button>
      ) : null}
      {row.canRevert ? (
        <Button variant="ghost" size="sm" onClick={() => onRevert(row)} aria-label={`Revertir ${row.fileName}`}>
          <ArrowCounterClockwise size={14} aria-hidden />Revertir
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Lista de archivos importados. «Revertir» pide confirmación (acto irreversible)
 * y la acción vuelve a exigir el permiso en el servidor. Las dos representaciones
 * (tarjetas en móvil, tabla en escritorio) conviven en el DOM, como en el resto de
 * las listas del módulo.
 */
export function ImportedFilesTable({ rows, caption = "Archivos importados" }: { rows: ImportedFileRow[]; caption?: string }) {
  const [target, setTarget] = React.useState<RevertTarget | null>(null)
  const revert = (row: ImportedFileRow) => setTarget({ kind: row.kind, id: row.id, fileName: row.fileName, newRows: row.newRows, updatedRows: row.updatedRows })

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <ResponsiveDataListCard
            key={row.key}
            title={row.fileName}
            description={`${IMPORTED_FILE_KIND_LABELS[row.kind]} · ${formatDateTime(row.createdAt)}`}
            status={<StatusBadge status={row.status} />}
            actions={<RowActions row={row} onRevert={revert} />}
          >
            <ResponsiveDataListField label="Resultado">{fileResult(row)}</ResponsiveDataListField>
            <ResponsiveDataListField label="Quién">{row.importedBy ?? "Sin responsable"}</ResponsiveDataListField>
            {periodOf(row) ? <ResponsiveDataListField label="Período">{periodOf(row)}</ResponsiveDataListField> : null}
            {row.worksite ? <ResponsiveDataListField label="Faena">{row.worksite}</ResponsiveDataListField> : null}
          </ResponsiveDataListCard>
        ))}
      </div>

      <TableRoot className="hidden md:block" aria-label={caption}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuándo</TableHead>
              <TableHead>Qué era</TableHead>
              <TableHead>Archivo</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Quién</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell>
                  <span className="block">{IMPORTED_FILE_KIND_LABELS[row.kind]}</span>
                  {row.kind === "tarjeta" && cardSourceLabel(row.source) ? <span className="block text-xs text-[var(--color-text-muted)]">{cardSourceLabel(row.source)}{row.worksite ? ` · ${row.worksite}` : ""}</span> : null}
                  {periodOf(row) && row.kind !== "tarjeta" ? <span className="block text-xs text-[var(--color-text-muted)]">{periodOf(row)}</span> : null}
                </TableCell>
                <TableCell className="max-w-64 truncate font-medium" title={row.fileName}>{row.fileName}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fileResult(row)}</TableCell>
                <TableCell>{row.importedBy ?? "Sin responsable"}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell><RowActions row={row} onRevert={revert} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>

      <RevertFileDialog target={target} onClose={() => setTarget(null)} />
    </>
  )
}
