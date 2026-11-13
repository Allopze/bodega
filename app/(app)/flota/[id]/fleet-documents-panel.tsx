"use client"

import * as React from "react"
import { useActionState, useTransition } from "react"
import { UploadSimple, Trash, FileText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { FileInput } from "@/components/ui/file-input"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { uploadFleetDocumentAction, deleteFleetDocumentAction } from "../actions"
import type { ActionState } from "@/lib/validation/operations"
import { FLEET_DOCUMENT_TYPES } from "@/lib/validation/fleet-documents"
import { MetaBadge } from "@/components/states/state-badge"

interface FleetDocument {
  id: string
  documentType: string
  fileName: string
  mimeType: string | null
  expiresAt: string | null
  status: string
  supersededAt: string | null
  createdAt: string
}

// La taxonomía es compartida con el servidor: el desplegable y la validación
// no pueden divergir (lib/validation/fleet-documents.ts).
const DOC_TYPES = FLEET_DOCUMENT_TYPES

export function FleetDocumentsPanel({
  vehicleId,
  documents,
  canManageDocuments,
}: {
  vehicleId: string
  documents: FleetDocument[]
  canManageDocuments: boolean
}) {
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(deleteFleetDocumentAction, { ok: false, message: "" })
  // Anular un SOAP o un seguro deja de regir y requiere motivo: el disparador es
  // un botón de icono, así que no envía nada hasta que se confirma.
  const [pendingDelete, setPendingDelete] = React.useState<FleetDocument | null>(null)
  const [, startTransition] = useTransition()

  React.useEffect(() => {
    if (deleteState.ok && deleteState.message) {
      toast.success(deleteState.message)
    } else if (deleteState.ok === false && deleteState.message) {
      toast.error(deleteState.message)
    }
  }, [deleteState])

  return (
    <>
      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <FileText size={14} className="shrink-0 text-[var(--color-text-subtle)]" />
                  <span title={document.fileName} className={`truncate font-medium ${document.status === "replaced" ? "text-[var(--color-text-muted)]" : ""}`}>{document.fileName}</span>
                  {/* Sin esto, una versión reemplazada se lee igual que la
                      vigente y su fecha parece el vencimiento del equipo. */}
                  {document.status === "replaced" && <MetaBadge meta={{ label: "Reemplazado", variant: "outline" }} />}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>{document.documentType}</span>
                  {document.expiresAt && <span>· {document.status === "replaced" ? "Vencía" : "Vence"}: {formatDate(document.expiresAt)}</span>}
                  {document.supersededAt && <span>· Reemplazado el {formatDate(document.supersededAt)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/flota/documentos/${document.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${document.fileName}`}>
                    <FileText size={14} aria-hidden />
                  </a>
                </Button>
                {canManageDocuments && <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Anular ${document.fileName}`}
                  disabled={deletePending}
                  onClick={() => setPendingDelete(document)}
                >
                  <Trash size={14} aria-hidden />
                </Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManageDocuments && <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => { if (!next) setPendingDelete(null) }}
        title="Anular documento"
        // FLO-003: se anula, no se borra. El archivo se conserva porque es el
        // respaldo que puede pedirse en una fiscalización.
        description={pendingDelete ? `«${pendingDelete.fileName}» dejará de regir para este vehículo. El archivo se conserva y la anulación queda registrada con tu nombre.` : ""}
        confirmLabel="Anular"
        variant="destructive"
        loading={deletePending}
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Por ejemplo: se cargó la póliza del vehículo equivocado."
        onConfirm={(reason) => {
          if (!pendingDelete) return
          const data = new FormData()
          data.set("documentId", pendingDelete.id)
          data.set("vehicleId", vehicleId)
          data.set("reason", reason)
          startTransition(() => deleteAction(data))
          setPendingDelete(null)
        }}
      />}

      {documents.length === 0 && (
        <p className="text-xs text-[var(--color-text-subtle)]">
          Sin archivos subidos.{canManageDocuments ? " Usa «Subir documento» para agregar el primero." : ""}
        </p>
      )}

    </>
  )
}

/**
 * «Subir documento»: el botón vive en la cabecera de la tarjeta «Documentos» y el
 * formulario en una hoja, no siempre abierto sobre la lista (regla A3). El
 * formulario se monta dentro de la hoja: al cerrarla se desmonta y el tipo, la
 * fecha y el archivo sin enviar no reaparecen.
 */
export function FleetDocumentUpload({ vehicleId }: { vehicleId: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UploadSimple size={14} aria-hidden />
        Subir documento
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <UploadForm vehicleId={vehicleId} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}

function UploadForm({ vehicleId, onDone, onCancel }: { vehicleId: string; onDone: () => void; onCancel: () => void }) {
  const [selectedType, setSelectedType] = React.useState("")
  const [expiresAt, setExpiresAt] = React.useState("")
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await uploadFleetDocumentAction(previous, formData)
      if (result.ok) {
        toast.success(result.message || "Documento subido")
        onDone()
      }
      return result
    },
    { ok: false, message: "" },
  )

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <SheetHeader>
        <div>
          <SheetTitle>Subir documento</SheetTitle>
          <SheetDescription>El archivo queda como respaldo del vehículo; si indicas un vencimiento, rige hasta que lo reemplaces.</SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody className="space-y-4">
        {state.message && !state.ok && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
        )}
        <Field label="Tipo" htmlFor="fleetDocumentType" required>
          <input type="hidden" name="documentType" value={selectedType} />
          <Select value={selectedType || undefined} onValueChange={setSelectedType}>
            <SelectTrigger id="fleetDocumentType" className="w-full"><SelectValue placeholder="Selecciona tipo" /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Vencimiento" htmlFor="fleetDocExpiresAt" helper="Opcional">
          <DatePicker
            id="fleetDocExpiresAt"
            name="expiresAt"
            value={expiresAt}
            onChange={setExpiresAt}
          />
        </Field>

        <Field label="Archivo" htmlFor="fleetDocFile" required helper="PDF, JPG o PNG">
          <FileInput
            id="fleetDocFile"
            name="file"
            accept="application/pdf,image/jpeg,image/png"
            required
          />
        </Field>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <SubmitButton label="Subir documento" loadingLabel="Subiendo..." disabled={!selectedType} />
      </SheetFooter>
    </form>
  )
}
