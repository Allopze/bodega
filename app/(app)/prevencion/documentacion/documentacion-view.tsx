"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DocumentGrid, type GridDocument, type GridFolder } from "@/components/prevention/document-grid"
import { ViewModeToggle } from "@/components/prevention/view-mode-toggle"
import { DocumentViewerModal } from "./document-viewer-modal"
import type { Props, FolderRow } from "./documentacion-view.types"
import { DRAG_MIME } from "./documentacion-view.types"
import { DocumentTableRow } from "./documentacion-view-table-row"
import { FolderTableRow } from "./documentacion-view-folder-row"
import {
  MoveDocumentDialog,
  BulkMoveDialog,
  ContextMenu,
  RenameFolderDialog,
  MoveFolderDialog,
} from "./documentacion-view-dialogs"
import { useDocumentacionView } from "./documentacion-view.hooks"
import { EXPIRY_FILTER_LABELS, parseExpiryFilter } from "./expiry-filter"

export function DocumentacionView(props: Props) {
  const router = useRouter()
  const {
    documents,
    counters,
    folders = [],
    folderOptions = [],
    currentFolderId = null,
    canManage,
    canArchive,
    userId,
  } = props

  const f = useDocumentacionView(documents, folders, folderOptions, currentFolderId, props.searchParams, canManage, canArchive, userId)

  const gridFolders: GridFolder[] = f.filteredFolders
  const gridDocuments: GridDocument[] = f.filteredDocuments.map((d) => ({
    id: d.id,
    title: d.title,
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    updatedAt: d.updatedAt,
  }))
  // La tira anunciaba cifras que el usuario no podía seguir: eran texto muerto.
  // Las que tienen un filtro equivalente pasan a ser enlaces con href real
  // —no botones— para que funcionen desde el primer pintado.
  const activeExpiry = parseExpiryFilter(props.searchParams.vence)
  const attentionItems: Array<{ text: string; href?: string }> = [
    counters?.pendingReview ? { text: `${counters.pendingReview} por revisar` } : null,
    counters?.observed ? { text: `${counters.observed} observados` } : null,
    counters?.ackPending ? { text: `${counters.ackPending} acuses pendientes` } : null,
    counters?.expiringSoon.within30
      ? { text: `${counters.expiringSoon.within30} vencen en 30 días`, href: "/prevencion/documentacion?vence=30" }
      : null,
  ].filter((item): item is { text: string; href?: string } => Boolean(item))

  return (
    <div className="space-y-5">
      {attentionItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-(--color-border) py-2 text-xs text-(--color-text-muted)" role="status">
          <span className="font-semibold text-(--color-text)">Atención documental</span>
          {attentionItems.map((item) => item.href
            ? <Link key={item.text} href={item.href} className="underline underline-offset-2 hover:text-(--color-text)">{item.text}</Link>
            : <span key={item.text}>{item.text}</span>)}
        </div>
      )}

      {activeExpiry && (
        // Filtro activo, removible y explicado: sin esto la lista aparece
        // recortada sin decir por qué ni cómo volver.
        <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-signal-tint px-2.5 font-medium text-signal-ink">
            {EXPIRY_FILTER_LABELS[activeExpiry]}
          </span>
          <Link href="/prevencion/documentacion" className="text-(--color-text-muted) underline underline-offset-2 hover:text-(--color-text)">
            Quitar filtro de vencimiento
          </Link>
        </div>
      )}
      <div className="flex justify-end">
        <ViewModeToggle userId={userId} value={f.viewMode} onChange={f.setViewMode} />
      </div>

      {!f.hasContent ? (
        <EmptyState
          title={f.isFiltering ? "Sin resultados" : "Carpeta vacía"}
          description={f.isFiltering ? "No hay carpetas ni documentos que coincidan con la búsqueda." : "Sube documentos o crea una carpeta para ordenar la documentación preventiva."}
        />
      ) : (
        <div className="space-y-3">
          {f.selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) bg-(--color-chrome) px-4 py-2">
              <span className="text-sm font-medium text-(--color-text)">{f.selectedCount} seleccionados</span>
              <div className="flex gap-2">
                {canArchive && f.selectedFolders.size > 0 && (
                  <Button type="button" size="sm" variant="secondary" onClick={f.archiveSelectedFolders} disabled={f.pending}>
                    Archivar carpetas seleccionadas
                  </Button>
                )}
                {canManage && f.selectedDocuments.size > 0 && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={f.bulkDownloadHref}>Descargar documentos seleccionados</Link>
                  </Button>
                )}
                {canManage && f.selectedDocuments.size > 0 && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => { f.setMoveFolderId(currentFolderId ?? ""); f.setBulkMoveOpen(true) }} disabled={f.pending}>
                    Mover documentos seleccionados
                  </Button>
                )}
                {canArchive && f.selectedDocuments.size > 0 && (
                  <Button type="button" size="sm" variant="secondary" onClick={f.archiveSelectedDocuments} disabled={f.pending}>
                    Archivar documentos seleccionados
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={f.clearSelection}>
                  Limpiar selección
                </Button>
              </div>
            </div>
          )}

          {f.viewMode === "list" ? (
            <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Sel.</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Actualizado</TableHead>
                    <TableHead>Tamaño</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {f.filteredFolders.map((folder) => (
                    <FolderTableRow
                      key={folder.id}
                      folder={folder}
                      canManage={canManage}
                      canArchive={canArchive}
                      selected={f.selectedFolders.has(folder.id)}
                      dragOver={f.dragOverFolderId === folder.id}
                      pending={f.pending}
                      folderHref={f.folderHref(folder.id)}
                      onToggleSelected={() => f.toggleFolderSelection(folder.id)}
                      onContextMenu={(event) => f.openFolderMenu(event, folder)}
                      onRestore={() => f.restoreFolder(folder)}
                      onArchive={() => f.archiveFolder(folder)}
                      onRename={() => f.openFolderAction(folder, "rename")}
                      onMove={() => f.openFolderAction(folder, "move")}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "folder", id: folder.id }))
                        event.dataTransfer.effectAllowed = "move"
                      }}
                      onDrop={(event) => f.handleDropOnFolder(event, folder)}
                      onDragOver={(event) => {
                        if (canManage && new Set(event.dataTransfer.types).has(DRAG_MIME)) {
                          event.preventDefault()
                          f.setDragOverFolderId(folder.id)
                        }
                      }}
                      onDragLeave={() => f.setDragOverFolderId((current: string | null) => (current === folder.id ? null : current))}
                    />
                  ))}
                  {f.filteredDocuments.map((d) => (
                    <DocumentTableRow
                      key={d.id}
                      document={d}
                      canManage={canManage}
                      selected={f.selectedDocuments.has(d.id)}
                      onToggleSelected={() => f.toggleDocumentSelection(d.id)}
                      onContextMenu={(event) => f.openDocumentMenu(event, d)}
                      onOpenDetail={() => f.setViewerDocId(d.id)}
                      onMove={() => {
                        f.setMoveDocumentId(d.id)
                        f.setMoveFolderId(currentFolderId ?? "")
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <DocumentGrid
              folders={gridFolders}
              documents={gridDocuments}
              selectedFolderIds={f.selectedFolders}
              selectedDocumentIds={f.selectedDocuments}
              toggleFolder={f.toggleFolderSelection}
              toggleDocument={f.toggleDocumentSelection}
              openFolder={(id) => router.push(f.folderHref(id))}
              openDocument={(id) => f.setViewerDocId(id)}
              onFolderContextMenu={(event, id) => { const folder = folders.find((x) => x.id === id); if (folder) f.openFolderMenu(event, folder) }}
              onDocumentContextMenu={(event, id) => { const doc = documents.find((x) => x.id === id); if (doc) f.openDocumentMenu(event, doc) }}
              onFolderAction={(event, id) => { const folder = folders.find((x) => x.id === id); if (folder) f.openFolderMenu(event, folder) }}
              onDocumentAction={(event, id) => { const doc = documents.find((x) => x.id === id); if (doc) f.openDocumentMenu(event, doc) }}
              onFolderDragStart={f.onFolderDragStart}
              onDocumentDragStart={f.onDocumentDragStart}
              onFolderDragOver={f.onFolderDragOver}
              onFolderDragLeave={f.onFolderDragLeave}
              onFolderDrop={f.onFolderDrop}
              dragOverFolderId={f.dragOverFolderId}
              canManage={canManage}
              canSelect
            />
          )}
        </div>
      )}

      <MoveDocumentDialog
        open={Boolean(f.moveDocumentId)}
        moveDocumentId={f.moveDocumentId}
        moveFolderId={f.moveFolderId}
        folderOptionLabels={f.folderOptionLabels}
        pending={f.pending}
        onMoveDocument={f.moveDocument}
        onClose={() => f.setMoveDocumentId(null)}
        onFolderChange={f.setMoveFolderId}
      />

      <BulkMoveDialog
        open={f.bulkMoveOpen}
        moveFolderId={f.moveFolderId}
        selectedCount={f.selectedDocuments.size}
        folderOptionLabels={f.folderOptionLabels}
        pending={f.pending}
        onSubmit={f.moveSelectedDocuments}
        onClose={() => f.setBulkMoveOpen(false)}
        onFolderChange={f.setMoveFolderId}
      />

      {f.menu && (
        <ContextMenu
          menu={f.menu}
          canManage={canManage}
          canArchive={canArchive}
          currentFolderId={currentFolderId}
          onClose={() => f.setMenu(null)}
          onFolderAction={(folder, action) => f.openFolderAction(folder as FolderRow, action)}
          onArchiveFolder={(folder) => f.archiveFolder(folder as FolderRow)}
          onViewDocumentDetail={(id) => f.setViewerDocId(id)}
          onDownloadDocument={() => {}}
          onMoveDocument={(id) => { f.setMoveDocumentId(id); f.setMoveFolderId(currentFolderId ?? "") }}
          onArchiveDocument={(id) => f.archiveDocument(id)}
        />
      )}

      <RenameFolderDialog
        open={f.folderAction === "rename"}
        folderActionName={f.folderActionName}
        pending={f.pending}
        onNameChange={f.setFolderActionName}
        onSubmit={f.submitFolderRename}
        onClose={f.closeFolderAction}
      />

      <MoveFolderDialog
        open={f.folderAction === "move"}
        folderActionParentId={f.folderActionParentId}
        dialogFolderId={f.dialogFolder?.id ?? null}
        folderOptionLabels={f.folderOptionLabels}
        pending={f.pending}
        onParentChange={f.setFolderActionParentId}
        onSubmit={f.submitFolderMove}
        onClose={f.closeFolderAction}
      />

      <DocumentViewerModal
        documentId={f.viewerDocId}
        open={f.viewerDocId !== null}
        onClose={() => f.setViewerDocId(null)}
      />
    </div>
  )
}
