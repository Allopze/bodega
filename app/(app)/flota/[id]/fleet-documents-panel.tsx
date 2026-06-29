"use client"

import * as React from "react"
import { useActionState } from "react"
import { UploadSimple, Trash, FileText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
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
      <h2 className="mb-3 text-sm font-semibold">Documentos</h2>

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
            <select
              id="fleetDocumentType"
              name="documentType"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              required
              className="flex h-9 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
            >
              <option value="" disabled>Selecciona tipo</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Vencimiento" htmlFor="fleetDocExpiresAt" helper="Opcional">
            <Input
              id="fleetDocExpiresAt"
              name="expiresAt"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>

          <Field label="Archivo" htmlFor="fleetDocFile" required>
            <Input
              id="fleetDocFile"
              name="file"
              type="file"
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
