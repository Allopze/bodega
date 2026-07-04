"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { DocumentGrid, type GridDocument, type GridFolder } from "@/components/prevention/document-grid"
import { ViewModeToggle, usePersistedViewMode } from "@/components/prevention/view-mode-toggle"
import { getFileIcon } from "@/lib/prevention/file-icon"
import { toast } from "@/lib/toast"
import { restoreSstDocumentAction, restoreSstDocumentFolderAction } from "../actions"

interface ArchivedFolder {
  id: string
  name: string
  worksiteName: string | null
  archivedAt: string | null
  parentId: string | null
  updatedAt: string
}

interface ArchivedDocument {
  id: string
  title: string
  internalCode: string | null
  worksiteName: string | null
  fileName?: string | null
  mimeType?: string | null
  updatedAt: string
}

interface Props {
  folders: ArchivedFolder[]
  documents: ArchivedDocument[]
  canRestore: boolean
  userId: string
}

export function PapeleraView({ folders, documents, canRestore, userId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [viewMode, setViewMode] = usePersistedViewMode(userId)

  const restoreFolder = React.useCallback((id: string, name: string) => {
    startTransition(async () => {
      const res = await restoreSstDocumentFolderAction({ id })
      if (res.ok) {
        toast.success(`Carpeta "${name}" restaurada.`)
        router.refresh()
      } else {
        toast.error(res.message ?? "No se pudo restaurar la carpeta.")
      }
    })
  }, [router])

  const restoreDocument = React.useCallback((documentId: string, title: string) => {
    startTransition(async () => {
      const res = await restoreSstDocumentAction({ documentId })
      if (res.ok) {
        toast.success(`Documento "${title}" restaurado como borrador.`)
        router.refresh()
      } else {
        toast.error(res.message ?? "No se pudo restaurar el documento.")
      }
    })
  }, [router])

  const isEmpty = folders.length === 0 && documents.length === 0

  if (isEmpty) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-(--color-text-subtle)">
            Elementos archivados. Restaurar una carpeta la devuelve a su ubicación; restaurar un documento lo deja como borrador.
          </p>
          <div className="flex items-center gap-2">
            <ViewModeToggle userId={userId} value={viewMode} onChange={setViewMode} />
            <Button asChild size="sm" variant="secondary">
              <Link href="/prevencion/documentacion">Volver a documentación</Link>
            </Button>
          </div>
        </div>
        <EmptyState title="Papelera vacía" description="No hay carpetas ni documentos archivados." />
      </div>
    )
  }

  const gridFolders: GridFolder[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    worksiteId: null,
    updatedAt: f.updatedAt,
    archivedAt: f.archivedAt,
  }))
  const gridDocuments: GridDocument[] = documents.map((d) => ({
    id: d.id,
    title: d.title,
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    updatedAt: d.updatedAt,
  }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-(--color-text-subtle)">
          Elementos archivados. Restaurar una carpeta la devuelve a su ubicación; restaurar un documento lo deja como borrador.
        </p>
        <div className="flex items-center gap-2">
          <ViewModeToggle userId={userId} value={viewMode} onChange={setViewMode} />
          <Button asChild size="sm" variant="secondary">
            <Link href="/prevencion/documentacion">Volver a documentación</Link>
          </Button>
        </div>
      </div>

      {viewMode === "list" ? (
        <div className="space-y-4">
          {folders.length > 0 && (
            <RestoreSection title={`Carpetas archivadas (${folders.length})`}>
              <ul role="list" className="divide-y divide-(--color-border)">
                {folders.map((folder) => {
                  const meta = getFileIcon({ mimeType: null, fileName: null })
                  return (
                    <li key={folder.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span aria-hidden className="text-(--color-text-subtle)"><meta.Icon size={18} /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-(--color-text)">{folder.name}</p>
                          <p className="truncate text-xs text-(--color-text-subtle)">{folder.worksiteName ?? "Global"}</p>
                        </div>
                      </div>
                      {canRestore && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={`Restaurar carpeta ${folder.name}`}
                          onClick={() => restoreFolder(folder.id, folder.name)}
                          disabled={pending}
                        >
                          <ArrowCounterClockwise size={14} className="mr-1" />
                          Restaurar
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </RestoreSection>
          )}

          {documents.length > 0 && (
            <RestoreSection title={`Documentos archivados (${documents.length})`}>
              <ul role="list" className="divide-y divide-(--color-border)">
                {documents.map((d) => {
                  const meta = getFileIcon({ mimeType: d.mimeType ?? null, fileName: d.fileName ?? null })
                  const DocIcon = meta.Icon
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span aria-hidden style={{ color: meta.color }}><DocIcon size={18} weight="duotone" /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-(--color-text)">{d.title}</p>
                          {d.internalCode && <p className="truncate text-xs text-(--color-text-subtle)">{d.internalCode}</p>}
                        </div>
                      </div>
                      {canRestore && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={`Restaurar documento ${d.title}`}
                          onClick={() => restoreDocument(d.id, d.title)}
                          disabled={pending}
                        >
                          <ArrowCounterClockwise size={14} className="mr-1" />
                          Restaurar
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </RestoreSection>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {folders.length > 0 && (
            <RestoreSection title={`Carpetas archivadas (${folders.length})`}>
              <DocumentGrid
                folders={gridFolders}
                documents={[]}
                selectedFolderIds={new Set()}
                selectedDocumentIds={new Set()}
                toggleFolder={() => undefined}
                toggleDocument={() => undefined}
                openFolder={() => undefined}
                openDocument={() => undefined}
                onFolderContextMenu={(_, id) => {
                  const f = folders.find((x) => x.id === id)
                  if (f && canRestore) restoreFolder(id, f.name)
                }}
                onDocumentContextMenu={() => undefined}
                onFolderAction={(_, id) => {
                  const f = folders.find((x) => x.id === id)
                  if (f && canRestore) restoreFolder(id, f.name)
                }}
                onDocumentAction={() => undefined}
                canManage={false}
                canSelect={false}
              />
            </RestoreSection>
          )}

          {documents.length > 0 && (
            <RestoreSection title={`Documentos archivados (${documents.length})`}>
              <DocumentGrid
                folders={[]}
                documents={gridDocuments}
                selectedFolderIds={new Set()}
                selectedDocumentIds={new Set()}
                toggleFolder={() => undefined}
                toggleDocument={() => undefined}
                openFolder={() => undefined}
                openDocument={() => undefined}
                onFolderContextMenu={() => undefined}
                onDocumentContextMenu={(_, id) => {
                  const d = documents.find((x) => x.id === id)
                  if (d && canRestore) restoreDocument(id, d.title)
                }}
                onFolderAction={() => undefined}
                onDocumentAction={(_, id) => {
                  const d = documents.find((x) => x.id === id)
                  if (d && canRestore) restoreDocument(id, d.title)
                }}
                canManage={false}
                canSelect={false}
              />
            </RestoreSection>
          )}
        </div>
      )}
    </div>
  )
}

function RestoreSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) shadow-[var(--shadow-card)]">
      <header className="border-b border-(--color-border) px-5 py-3">
        <h2 className="text-sm font-medium text-(--color-text-subtle)">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
