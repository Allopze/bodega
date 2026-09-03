"use client"

import * as React from "react"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { FileText } from "@phosphor-icons/react"

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

export function AssetDocuments({ assetId: _assetId, documents, canManage: _canManage }: AssetDocumentsProps) {
  if (documents.length === 0) {
    return (
      <EmptyState
        title="Sin documentos"
        description="Facturas, órdenes de compra y otros documentos asociados al activo aparecerán acá."
      />
    )
  }

  return (
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
  )
}
