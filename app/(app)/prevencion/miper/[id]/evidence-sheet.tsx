"use client"

import * as React from "react"
import { Paperclip } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { miperEvidenceHref } from "@/lib/prevention/miper/evidence-url"
import type { ProgramEvidenceView } from "@/lib/services/miper/program-queries"
import { formatDateTime } from "@/lib/utils"
import { addOccurrenceEvidenceAction, uploadProgramEvidenceAction, withdrawOccurrenceEvidenceAction } from "../actions"

/** Tipos que admite la evidencia del programa (§7.6): PDF, JPEG, PNG, Word y Excel. */
export const PROGRAM_EVIDENCE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"

/** La evidencia de un registro, tal como la lee el servidor (C3). */
export type OccurrenceEvidenceView = ProgramEvidenceView

/**
 * El rótulo con el que se nombra una evidencia: el nombre **original** —el que la
 * persona eligió al subir el archivo— viaja en `description` (es lo que manda el
 * diálogo de registro y el alta de esta ficha); `fileName` es el nombre interno
 * de almacenamiento, opaco para quien subió (`-nuSB8kSegyEGNhkvRzj.png`). Sin
 * original —evidencia anterior a este rótulo— se cae al interno sin romperse, y
 * cuando hay original el interno queda como dato secundario, nunca al revés.
 */
function evidenceLabel(item: OccurrenceEvidenceView) {
  return item.description?.trim() || item.fileName
}

/**
 * Subida de un archivo de evidencia.
 *
 * El archivo se sube **al elegirlo** y no al enviar el formulario: así el error
 * —tipo real del archivo o tamaño— aparece en su propio campo y no arrastra el
 * registro de la ocurrencia que lo acompaña. Es el mismo contrato de
 * `EvidenceField` (el archivo se sube con `fetch` y viaja la ruta `storage/…`),
 * servido por una Server Action en vez de una ruta de API: la evidencia del
 * programa no tiene endpoint propio, y crearlo quedaba fuera del alcance de la
 * pestaña.
 */
export function EvidenceUploadField({
  label,
  helper,
  value,
  onChange,
  disabled,
}: {
  label: string
  helper?: string
  /** Ruta `storage/…` ya subida, la que viaja al servicio. */
  value: string
  onChange: (path: string, fileName: string) => void
  disabled?: boolean
}) {
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [uploadedName, setUploadedName] = React.useState("")
  const uploaded = value.startsWith("storage/")

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.set("file", file)
      const result = await uploadProgramEvidenceAction(body)
      const path = result.data?.path
      if (!result.ok || typeof path !== "string") {
        setError(result.message ?? "No se pudo subir el archivo.")
        return
      }
      setUploadedName(file.name)
      onChange(path, file.name)
    } catch {
      setError("No se pudo subir el archivo.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <Field label={label} hint={helper} error={error ?? undefined}>
        {/* El input de archivo se anuncia como «Seleccionar archivo»: `FileInput`
            no acepta `aria-label` y su nombre accesible es el del botón. */}
        <FileInput
          accept={PROGRAM_EVIDENCE_ACCEPT}
          disabled={disabled || uploading}
          onChange={handleFile}
        />
      </Field>
      {uploading && <p className="text-xs text-[var(--color-text-muted)]">Subiendo…</p>}
      {uploaded && !uploading && (
        <p className="text-xs text-[var(--color-success-ink)]">{uploadedName ? `Archivo subido: ${uploadedName}` : "Archivo subido y adjunto."}</p>
      )}
    </div>
  )
}

/**
 * Evidencia del registro vigente de una ocurrencia (§7.6).
 *
 * Retirar una evidencia **no borra el archivo**: queda marcado con su motivo
 * porque de él puede depender una fiscalización. Agregar sólo se ofrece mientras
 * el registro no esté anulado —sobre un registro anulado no hay acto que
 * respaldar—.
 */
export function EvidenceSheet({
  open,
  onOpenChange,
  record,
  occurrenceLabel,
  canExecute,
  onChanged,
  matrixId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Registro vigente de la ocurrencia; `null` mientras no haya ninguno. */
  record: { id: string; outcome: string; effectiveOn: string | null; voidedAt: string | null; evidence: OccurrenceEvidenceView[] } | null
  /** Fecha de vencimiento de la ocurrencia, para el título. */
  occurrenceLabel: string
  canExecute: boolean
  onChanged: () => void
  /** La MIPER: las acciones revalidan su página leyéndolo del input crudo. */
  matrixId?: string
}) {
  const [withdrawTarget, setWithdrawTarget] = React.useState<OccurrenceEvidenceView | null>(null)
  const [path, setPath] = React.useState("")
  const [description, setDescription] = React.useState("")
  /* El nombre con el que la persona subió el archivo: es el rótulo que después
   * muestra la ficha, así que se conserva aunque describa el archivo por escrito
   * —el único campo donde puede viajar es `description`—. */
  const [originalName, setOriginalName] = React.useState("")
  const operation = useOperation()
  const withdrawOperation = useOperation({ feedback: "toast" })

  function handleOpenChange(value: boolean) {
    if (value) {
      setPath("")
      setDescription("")
      setOriginalName("")
      operation.setMessage("")
    }
    onOpenChange(value)
  }

  const evidence = record?.evidence ?? []
  const canAdd = canExecute && Boolean(record) && !record?.voidedAt
  const matrixInput = matrixId ? { matrixId } : {}

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[min(90dvh,60rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Evidencia de la ocurrencia</DialogTitle>
          <DialogDescription>
            {occurrenceLabel}
            {record ? ` · registro ${record.outcome === "done" ? "«Se hizo»" : "«No se hizo»"}` : " · sin registro"}
            {record?.voidedAt ? " · anulado" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {evidence.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Este registro todavía no tiene evidencia adjunta.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((item) => {
                const label = evidenceLabel(item)
                const openHref = item.inlineSafe ? miperEvidenceHref(item.evidenceUploadId) : null
                const downloadHref = miperEvidenceHref(item.evidenceUploadId, { download: true })
                return (
                  <li key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Paperclip size={14} aria-hidden />
                          <span className="truncate" title={label}>{label}</span>
                        </p>
                        {item.description?.trim() && (
                          <p className="text-xs text-[var(--color-text-subtle)]">Archivo almacenado: {item.fileName}</p>
                        )}
                        <p className="text-xs text-[var(--color-text-subtle)]">
                          Subida {formatDateTime(item.uploadedAt)}
                          {item.uploadedByName ? ` por ${item.uploadedByName}` : ""}
                        </p>
                        {item.withdrawnAt && (
                          <p className="mt-1 text-xs text-[var(--color-warning-ink)]">
                            Retirada {formatDateTime(item.withdrawnAt)}: {item.withdrawReason}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <MetaBadge meta={item.withdrawnAt ? { label: "Retirada", variant: "outline" } : { label: "Vigente", variant: "success" }} />
                        {openHref && (
                          <a
                            href={openHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Abrir ${label}`}
                            className="text-sm font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
                          >
                            Abrir
                          </a>
                        )}
                        {downloadHref && (
                          <a
                            href={downloadHref}
                            aria-label={`Descargar ${label}`}
                            className="text-sm font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
                          >
                            Descargar
                          </a>
                        )}
                        {canExecute && !item.withdrawnAt && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Retirar la evidencia ${label}`}
                            onClick={() => setWithdrawTarget(item)}
                          >
                            Retirar
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {canAdd && (
            <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
              <p className="text-sm font-medium">Agregar evidencia</p>
              <EvidenceUploadField
                label="Archivo de la evidencia"
                helper="PDF, JPEG, PNG, Word o Excel, hasta 25 MB."
                value={path}
                disabled={operation.pending}
                onChange={(next, name) => { setPath(next); setOriginalName(name) }}
              />
              <Field label="Descripción" hint="Opcional. Qué muestra el archivo.">
                <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} />
              </Field>
              {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
              <Button
                type="button"
                size="sm"
                disabled={operation.pending || !path}
                onClick={() => operation.run(
                  // Sin descripción escrita, el rótulo es el nombre original del
                  // archivo: es el mismo contrato que el diálogo de registro.
                  () => addOccurrenceEvidenceAction({
                    ...matrixInput,
                    recordId: record!.id,
                    evidenceUploadId: path,
                    description: description.trim() || originalName.trim() || null,
                  }),
                  () => { setPath(""); setDescription(""); setOriginalName(""); onChanged() },
                )}
              >
                Agregar evidencia
              </Button>
            </div>
          )}

          <p className="text-xs text-[var(--color-text-subtle)]">
            Retirar una evidencia no borra el archivo: queda guardado y marcado con el motivo, porque de él puede depender una fiscalización.
          </p>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={withdrawTarget !== null}
        onOpenChange={(value) => { if (!value) setWithdrawTarget(null) }}
        title="Retirar la evidencia"
        description={withdrawTarget ? `${evidenceLabel(withdrawTarget)} deja de respaldar este registro. El archivo no se borra.` : ""}
        confirmLabel="Retirar evidencia"
        variant="warning"
        loading={withdrawOperation.pending}
        reasonLabel="Motivo del retiro"
        reasonPlaceholder="Por qué se retira la evidencia (al menos 10 caracteres)"
        onConfirm={(reason) => withdrawOperation.run(
          () => withdrawOccurrenceEvidenceAction({ ...matrixInput, evidenceId: withdrawTarget!.id, reason }),
          () => { setWithdrawTarget(null); onChanged() },
        )}
      />
    </Dialog>
  )
}
