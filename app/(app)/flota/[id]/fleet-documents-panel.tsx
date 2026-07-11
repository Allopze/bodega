"use client"

import * as React from "react"
import { useActionState } from "react"
import { UploadSimple, Trash, FileText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { FileInput } from "@/components/ui/file-input"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { uploadFleetDocumentAction, deleteFleetDocumentAction } from "../actions"
import type { ActionState } from "@/lib/validation/operations"

interface FleetDocument {
  id: string
  documentType: string
  fileName: string
  mimeType: string | null
  expiresAt: string | null
  createdAt: string
}

const DOC_TYPES = [
  "SOAP",
  "Revisión técnica",
  "Permiso de circulación",
  "Seguro",
  "Padrón",
  "Certificado de emisiones",
  "Manual del vehículo",
  "Otro",
]

export function FleetDocumentsPanel({
  vehicleId,
  documents,
}: {
  vehicleId: string
  documents: FleetDocument[]
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState<ActionState, FormData>(uploadFleetDocumentAction, { ok: false, message: "" })
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(deleteFleetDocumentAction, { ok: false, message: "" })
  const [selectedType, setSelectedType] = React.useState("")
  const [expiresAt, setExpiresAt] = React.useState("")

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
      <h3 className="mb-3 text-sm font-semibold">Documentos del vehículo</h3>

      {documents.length > 0 && (
        <div className="mb-4 space-y-2">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <FileText size={14} className="shrink-0 text-[var(--color-text-subtle)]" />
                  <span className="truncate font-medium">{document.fileName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>{document.documentType}</span>
                  {document.expiresAt && <span>· Vence: {formatDate(document.expiresAt)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/flota/documentos/${document.id}`} target="_blank" rel="noopener noreferrer">
                    <FileText size={14} />
                  </a>
                </Button>
                <form action={deleteAction}>
                  <input type="hidden" name="documentId" value={document.id} />
                  <input type="hidden" name="vehicleId" value={vehicleId} />
                  <Button type="submit" variant="ghost" size="sm" disabled={deletePending}>
                    <Trash size={14} />
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {documents.length === 0 && (
        <p className="mb-4 text-xs text-[var(--color-text-subtle)]">Sin documentos registrados.</p>
      )}

      <form action={uploadAction} className="flex flex-col gap-3">
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
      </form>
    </>
  )
}
