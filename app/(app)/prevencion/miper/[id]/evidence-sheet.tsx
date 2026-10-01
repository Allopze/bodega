"use client"

import * as React from "react"
import { Paperclip } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Input } from "@/components/ui/input"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatDateTime } from "@/lib/utils"
import { addOccurrenceEvidenceAction, uploadProgramEvidenceAction, withdrawOccurrenceEvidenceAction } from "../actions"

/** Tipos que admite la evidencia del programa (§7.6): PDF, JPEG, PNG, Word y Excel. */
export const PROGRAM_EVIDENCE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"

export type OccurrenceEvidenceView = {
  id: string
  evidenceUploadId: string
  fileName: string
  description: string | null
  uploadedAt: string
  uploadedByName: string | null
  withdrawnAt: string | null
  withdrawReason: string | null
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Registro vigente de la ocurrencia; `null` mientras no haya ninguno. */
  record: { id: string; outcome: string; effectiveOn: string | null; voidedAt: string | null; evidence: OccurrenceEvidenceView[] } | null
  /** Fecha de vencimiento de la ocurrencia, para el título. */
  occurrenceLabel: string
  canExecute: boolean
  onChanged: () => void
}) {
  const [withdrawTarget, setWithdrawTarget] = React.useState<OccurrenceEvidenceView | null>(null)
  const [path, setPath] = React.useState("")
  const [description, setDescription] = React.useState("")
  const operation = useOperation()

  function handleOpenChange(value: boolean) {
    if (value) {
      setPath("")
      setDescription("")
      operation.setMessage("")
    }
    onOpenChange(value)
  }

  const evidence = record?.evidence ?? []
  const canAdd = canExecute && Boolean(record) && !record?.voidedAt

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <div>
            <SheetTitle>Evidencia de la ocurrencia</SheetTitle>
            <SheetDescription>
              {occurrenceLabel}
              {record ? ` · registro ${record.outcome === "done" ? "«Se hizo»" : "«No se hizo»"}` : " · sin registro"}
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody className="space-y-5">
          {evidence.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Este registro todavía no tiene evidencia adjunta.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((item) => (
                <li key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <Paperclip size={14} aria-hidden />
                        <span className="truncate">{item.fileName}</span>
                      </p>
                      {item.description && <p className="text-xs text-[var(--color-text-subtle)]">{item.description}</p>}
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
                    <div className="flex items-center gap-2">
                      <MetaBadge meta={item.withdrawnAt ? { label: "Retirada", variant: "outline" } : { label: "Vigente", variant: "success" }} />
                      {canExecute && !item.withdrawnAt && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Retirar la evidencia ${item.fileName}`}
                          onClick={() => setWithdrawTarget(item)}
                        >
                          Retirar
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
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
                onChange={(next) => setPath(next)}
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
                  () => addOccurrenceEvidenceAction({ recordId: record!.id, evidenceUploadId: path, description: description || null }),
                  () => { setPath(""); setDescription(""); onChanged() },
                )}
              >
                Agregar evidencia
              </Button>
            </div>
          )}

          <p className="text-xs text-[var(--color-text-subtle)]">
            Retirar una evidencia no borra el archivo: queda guardado y marcado con el motivo, porque de él puede depender una fiscalización.
          </p>
        </SheetBody>
      </SheetContent>

      <ConfirmDialog
        open={withdrawTarget !== null}
        onOpenChange={(value) => { if (!value) setWithdrawTarget(null) }}
        title="Retirar la evidencia"
        description={withdrawTarget ? `${withdrawTarget.fileName} deja de respaldar este registro. El archivo no se borra.` : ""}
        confirmLabel="Retirar evidencia"
        variant="warning"
        reasonLabel="Motivo del retiro"
        reasonPlaceholder="Por qué se retira la evidencia (al menos 10 caracteres)"
        onConfirm={(reason) => operation.run(
          () => withdrawOccurrenceEvidenceAction({ evidenceId: withdrawTarget!.id, reason }),
          () => { setWithdrawTarget(null); onChanged() },
        )}
      />
    </Sheet>
  )
}
