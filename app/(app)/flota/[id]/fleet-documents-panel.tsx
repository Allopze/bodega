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
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { uploadFleetDocumentAction, deleteFleetDocumentAction } from "../actions"
import type { ActionState } from "@/lib/validation/operations"
import { FLEET_DOCUMENT_TYPES } from "@/lib/validation/fleet-documents"
import { Badge } from "@/components/ui/badge"

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
  const [uploadState, uploadAction, uploadPending] = useActionState<ActionState, FormData>(uploadFleetDocumentAction, { ok: false, message: "" })
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(deleteFleetDocumentAction, { ok: false, message: "" })
  const [selectedType, setSelectedType] = React.useState("")
  const [expiresAt, setExpiresAt] = React.useState("")
  // Borrar un SOAP o un seguro es irreversible y el disparador era un botón de
  // icono que enviaba el form al primer clic, sin confirmación.
  const [pendingDelete, setPendingDelete] = React.useState<FleetDocument | null>(null)
  const [, startTransition] = useTransition()

  React.useEffect(() => {
    if (uploadState.ok && uploadState.message) {
      toast.success(uploadState.message)
    } else if (uploadState.ok === false && uploadState.message) {
      toast.error(uploadState.message)
    }
  }, [uploadState])

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
        <div className="mb-4 space-y-2">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <FileText size={14} className="shrink-0 text-[var(--color-text-subtle)]" />
                  <span title={document.fileName} className={`truncate font-medium ${document.status === "replaced" ? "text-[var(--color-text-muted)]" : ""}`}>{document.fileName}</span>
                  {/* Sin esto, una versión reemplazada se lee igual que la
                      vigente y su fecha parece el vencimiento del equipo. */}
                  {document.status === "replaced" && <Badge variant="outline">Reemplazado</Badge>}
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
                  aria-label={`Eliminar ${document.fileName}`}
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
        title="Eliminar documento"
        description={pendingDelete ? `Se eliminará «${pendingDelete.fileName}» del vehículo. Esta acción no se puede deshacer.` : ""}
        confirmLabel="Eliminar"
        variant="destructive"
        loading={deletePending}
        onConfirm={() => {
          if (!pendingDelete) return
          const data = new FormData()
          data.set("documentId", pendingDelete.id)
          data.set("vehicleId", vehicleId)
          startTransition(() => deleteAction(data))
          setPendingDelete(null)
        }}
      />}

      {documents.length === 0 && (
        <p className="mb-4 text-xs text-[var(--color-text-subtle)]">Sin documentos registrados.</p>
      )}

      {canManageDocuments && <form action={uploadAction} className="flex flex-col gap-3">
        <input type="hidden" name="vehicleId" value={vehicleId} />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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

          <Field label="Archivo" htmlFor="fleetDocFile" required>
            <FileInput
              id="fleetDocFile"
              name="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="secondary" size="sm" disabled={uploadPending || !selectedType}>
            <UploadSimple size={14} />
            {uploadPending ? "Subiendo..." : "Subir documento"}
          </Button>
        </div>
      </form>}
    </>
  )
}
