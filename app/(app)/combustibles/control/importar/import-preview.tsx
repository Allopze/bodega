"use client"

import { CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { CONTROL_IMPORT_KIND_LABELS, type ControlImportKind } from "@/lib/combustibles/control/imports/constants"
import type { ControlImportPreview, ControlImportResult } from "@/lib/combustibles/control/imports/service"
import { formatDate, formatQty } from "@/lib/utils"
import { ImportErrorList } from "../../importar/import-wizard-primitives"

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <dd className="text-xl font-semibold tabular-nums text-[var(--color-text)]">{formatQty(value)}</dd>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
    </div>
  )
}

export function ImportPreviewStep({ preview, pending, message, onBack, onConfirm }: {
  preview: ControlImportPreview
  pending: boolean
  message: string
  onBack: () => void
  onConfirm: () => void
}) {
  const blocked = preview.alreadyImported !== null
  const nothingToImport = preview.validRows === 0
  const sourceLabel = preview.kind === "telemetry" ? "Fuente" : "Medio"
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-4 border-y border-[var(--color-border)] py-3">
        <Figure value={preview.toInsert} label="Filas nuevas" />
        <Figure value={preview.toUpdate} label="Actualizan registros existentes" />
        <Figure value={preview.rejected.length} label="Rechazadas" />
      </dl>
      <p className="text-sm text-[var(--color-text-muted)]">
        {sourceLabel}: <span className="font-medium text-[var(--color-text)]">{preview.targetLabel}</span>
        {preview.periodFrom && preview.periodTo ? <> · Período: {formatDate(preview.periodFrom)} a {formatDate(preview.periodTo)}</> : null}
        {preview.kind === "telemetry" ? <> · {formatQty(preview.distinctVehicles)} equipos</> : <> · {formatQty(Math.round(preview.totalLiters))} L</>}
        {" · "}{formatQty(preview.totalRows)} filas leídas
      </p>

      {blocked ? (
        <Callout tone="danger" role="alert" icon={<WarningCircle size={16} />} title="Este archivo ya fue importado">
          El contenido es idéntico al del lote {preview.alreadyImported!.batchId}. No se importa dos veces: si fue un error, revierte ese lote desde el historial y vuelve a subirlo.
        </Callout>
      ) : null}
      {!blocked && preview.toUpdate > 0 ? (
        <Callout tone="info" icon={<CheckCircle size={16} />}>
          {formatQty(preview.toUpdate)} {preview.toUpdate === 1 ? "fila coincide" : "filas coinciden"} con registros ya cargados: se actualizarán con los valores del archivo, no se duplican.
        </Callout>
      ) : null}

      {preview.sample.length > 0 ? (
        <div>
          <p className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Primeras filas válidas</p>
          <TableRoot aria-label="Primeras filas válidas del archivo">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.sampleHeaders.map((header) => <TableHead key={header}>{header}</TableHead>)}
                  <TableHead>Qué pasará</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sample.map((row) => (
                  <TableRow key={row.rowIndex}>
                    {row.cells.map((cell, index) => <TableCell key={index} className="tabular-nums">{cell}</TableCell>)}
                    <TableCell>{row.action === "update" ? <Badge variant="info">Actualiza</Badge> : <Badge variant="success">Nueva</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </div>
      ) : null}

      <ImportErrorList
        errors={preview.rejected}
        filename={`rechazos-${preview.kind === "telemetry" ? "telemetria" : "entradas"}.xlsx`}
        title={`${formatQty(preview.rejected.length)} filas rechazadas (no se importarán):`}
      />
      {nothingToImport && !blocked ? (
        <p role="alert" className="text-sm text-[var(--color-danger-ink)]">Ninguna fila es válida. Corrige el archivo con la lista de rechazos y vuelve a subirlo.</p>
      ) : null}
      {message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p> : null}

      <DialogFooter>
        <Button variant="secondary" onClick={onBack} disabled={pending}>Volver</Button>
        <Button onClick={onConfirm} loading={pending} disabled={blocked || nothingToImport}>
          Confirmar importación ({formatQty(preview.validRows)} filas)
        </Button>
      </DialogFooter>
    </div>
  )
}

export function ImportDone({ kind, result, onAnother, onClose }: {
  kind: ControlImportKind
  result: ControlImportResult
  onAnother: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="success" icon={<CheckCircle size={16} />} title={`${CONTROL_IMPORT_KIND_LABELS[kind]}: lote ${result.batchId}`}>
        {formatQty(result.inserted)} {result.inserted === 1 ? "fila nueva" : "filas nuevas"}, {formatQty(result.updated)} {result.updated === 1 ? "actualizada" : "actualizadas"}
        {result.rejectedCount > 0 ? `, ${formatQty(result.rejectedCount)} rechazadas` : ""}.
      </Callout>
      <ImportErrorList
        errors={result.rejected}
        filename={`rechazos-${kind === "telemetry" ? "telemetria" : "entradas"}.xlsx`}
        title={`${formatQty(result.rejectedCount)} filas rechazadas:`}
        maxVisible={20}
      />
      <p className="text-xs text-[var(--color-text-muted)]">Las filas rechazadas quedan guardadas con su motivo: puedes descargarlas desde el historial.</p>
      <DialogFooter>
        <Button variant="secondary" onClick={onAnother}>Importar otro archivo</Button>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogFooter>
    </div>
  )
}
