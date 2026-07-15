"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowSquareOut, SpinnerGap, X, ArrowLeft, Warning } from "@phosphor-icons/react"
import { Dialog, DialogOverlay, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { getDocumentDetailAction } from "./actions"
import { DocumentDetailView } from "./[id]/document-detail-view"
import type { DetailViewProps } from "./[id]/document-detail.helpers"

type DocData = Awaited<ReturnType<typeof getDocumentDetailAction>>

interface Props {
  documentId: string | null
  open: boolean
  onClose: () => void
}

function isOk(data: DocData): data is NonNullable<DocData> & { error: undefined } {
  return !("error" in data && typeof data.error === "string" && data.error)
}

export function DocumentViewerModal({ documentId, open, onClose }: Props) {
  const [data, setData] = useState<DocData | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open && documentId) {
      setData(null)
      startTransition(async () => {
        const result = await getDocumentDetailAction(documentId)
        setData(result)
      })
    }
    if (!open) setData(null)
  }, [open, documentId])

  const ok = data && isOk(data) ? data : null
  const docTitle = ok ? ok.bundle.doc.title : "Documento"
  const errorMsg = data && "error" in data && typeof data.error === "string" ? data.error : null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogOverlay className="z-[70]" />
      <DialogContent
        className={cn(
          "fixed inset-0 z-[71]",
          "w-full h-full max-w-none max-h-none rounded-none",
          "translate-x-0 translate-y-0",
          "p-0 flex flex-col",
          "bg-(--color-surface)",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={onClose}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-(--color-border) px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-(--radius-md) h-8 w-8 text-(--color-text-subtle) hover:text-(--color-text) hover:bg-(--color-surface-2) transition-colors"
            aria-label="Cerrar"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-(--color-text)">
              {isPending ? "Cargando..." : docTitle}
            </h2>
          </div>
          <Link
            href={`/prevencion/documentacion/${documentId}`}
            className="flex shrink-0 items-center gap-1.5 rounded-(--radius-md) px-3 py-1.5 text-xs font-medium text-(--color-text-subtle) hover:text-(--color-text) hover:bg-(--color-surface-2) transition-colors"
            onClick={onClose}
          >
            <ArrowSquareOut size={14} />
            Abrir en página completa
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-(--radius-md) h-8 w-8 text-(--color-text-subtle) hover:text-(--color-text) hover:bg-(--color-surface-2) transition-colors"
            aria-label="Cerrar"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isPending && (
            <div className="flex items-center justify-center py-20">
              <SpinnerGap size={32} weight="bold" className="animate-spin text-(--color-text-muted)" />
            </div>
          )}

          {!isPending && errorMsg && (
            <div className="flex flex-col items-center gap-3 py-20 text-(--color-text-muted)">
              <Warning size={32} weight="duotone" />
              <p className="text-sm">{errorMsg}</p>
              <button
                type="button"
                className="rounded-(--radius-md) bg-(--color-surface-2) px-3 py-1.5 text-xs font-medium text-(--color-text) hover:bg-(--color-surface-3) transition-colors"
                onClick={() => {
                  if (documentId) {
                    setData(null)
                    startTransition(async () => {
                      const result = await getDocumentDetailAction(documentId)
                      setData(result)
                    })
                  }
                }}
              >
                Reintentar
              </button>
            </div>
          )}

          {!isPending && ok && (
            <DocumentDetailView
              key={documentId}
              bundle={ok.bundle}
              userMap={ok.userMap}
              worksiteMap={ok.worksiteMap}
              linkEnrichment={{} as DetailViewProps["linkEnrichment"]}
              canManage={ok.canManage}
              canArchive={ok.canArchive}
              currentUserId={ok.currentUserId}
              currentUserName={ok.currentUserName}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
