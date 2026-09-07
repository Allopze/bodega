"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { EmptyState } from "@/components/ui/empty-state"
import { FileInput } from "@/components/ui/file-input"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { FileText, UploadSimple } from "@phosphor-icons/react"

const MAX_FILE_MB = 25

interface DocumentRow {
  id: string
  fileName: string
  mimeType: string | null
  fileSize: number | null
  uploadedAt: string
  uploadedByName: string | null
}

interface AssetDocumentsProps {
  assetId: string
  documents: DocumentRow[]
  canManage: boolean
}

/**
 * Lista de documentos del activo, con carga vía `POST /api/ti/attachments`
 * (permiso `ti:manage_assets`, igual que la carga de fotos de asignaciones).
 * No hay borrado: `attachments` es append-only, igual que el historial del
 * activo — el copy del formulario avisa que la carga es permanente.
 */
export function AssetDocuments({ assetId, documents, canManage }: AssetDocumentsProps) {
  const router = useRouter()
  const [file, setFile] = React.useState<File | null>(null)
  const [uploading, setUploading] = React.useState(false)
  // `FileInput` no expone un reset imperativo (guarda el nombre en estado
  // interno): remontarlo con una `key` nueva es la única forma de limpiarlo.
  const [inputKey, setInputKey] = React.useState(0)

  async function upload() {
    if (!file) return
    // Corta acá el archivo demasiado grande: en faena el enlace es lento y
    // subir 40 MB para recibir un 400 del servidor cuesta minutos.
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`El archivo supera los ${MAX_FILE_MB} MB`)
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("entityType", "it_asset")
      form.append("entityId", assetId)
      const response = await fetch("/api/ti/attachments", { method: "POST", body: form })
      let payload: { id?: unknown; error?: string } = {}
      try {
        payload = await response.json() as { id?: unknown; error?: string }
      } catch {
        // Cuerpo vacío o no-JSON (p. ej. un 502 del proxy): el mensaje
        // genérico de abajo cubre el caso.
      }
      if (!response.ok) {
        toast.error(payload.error ?? "No se pudo subir el documento")
        return
      }
      toast.success("Documento adjuntado")
      setFile(null)
      setInputKey((k) => k + 1)
      router.refresh()
    } catch {
      toast.error("No se pudo subir el documento")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <EmptyState
          title="Sin documentos"
          description={
            canManage
              ? "Adjunta la factura, la orden de compra o el informe de servicio de este equipo."
              : "Acá aparecerán las facturas y órdenes de compra que se adjunten a este activo."
          }
        />
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a
                href={`/api/ti/attachments/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
                  <FileText size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text)]">{doc.fileName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Subido {formatDate(doc.uploadedAt)} por {doc.uploadedByName ?? "Sistema"}
                    {doc.fileSize != null && ` · ${Math.round(doc.fileSize / 1024)} KB`}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form
          onSubmit={(e) => { e.preventDefault(); void upload() }}
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-[var(--color-border)] p-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <Field
            label="Documento"
            htmlFor="ti-asset-doc-file"
            helper={`PDF, imagen, XML u Office. Máximo ${MAX_FILE_MB} MB. Las cargas son permanentes: no se pueden eliminar.`}
            className="flex-1"
          >
            <FileInput
              key={inputKey}
              id="ti-asset-doc-file"
              accept="application/pdf,image/jpeg,image/png,application/xml,.docx,.xlsx,.xls"
              onChange={setFile}
              disabled={uploading}
            />
          </Field>
          <Button type="submit" variant="secondary" size="sm" disabled={uploading || !file}>
            <UploadSimple size={14} className="mr-1.5" /> {uploading ? "Subiendo..." : "Subir documento"}
          </Button>
        </form>
      )}
    </div>
  )
}
