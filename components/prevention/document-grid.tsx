"use client"

import * as React from "react"
import { getFileIcon, type FileIconDescriptor } from "@/lib/prevention/file-icon"
import { cn } from "@/lib/utils"
import { DocumentTile, type DocumentTileProps } from "./document-tile"

export type GridFolder = {
  id: string
  parentId: string | null
  name: string
  worksiteId: string | null
  updatedAt: string
  archivedAt?: string | null
}

export type GridDocument = {
  id: string
  title: string
  fileName?: string | null
  mimeType?: string | null
  updatedAt: string
}

export type DocumentGridProps = {
  folders: GridFolder[]
  documents: GridDocument[]
  selectedFolderIds: Set<string>
  selectedDocumentIds: Set<string>
  toggleFolder: (id: string) => void
  toggleDocument: (id: string) => void
  openFolder: (id: string) => void
  openDocument: (id: string) => void
  onFolderContextMenu: (event: React.MouseEvent, id: string) => void
  onDocumentContextMenu: (event: React.MouseEvent, id: string) => void
  onFolderAction: (event: React.MouseEvent, id: string) => void
  onDocumentAction: (event: React.MouseEvent, id: string) => void
  /** Called by the grid after onOpen's onClick already fired, to set up drag. */
  onFolderDragStart?: (event: React.DragEvent, id: string) => void
  onDocumentDragStart?: (event: React.DragEvent, id: string) => void
  onFolderDrop?: (event: React.DragEvent, id: string) => void
  onFolderDragOver?: (event: React.DragEvent, id: string) => void
  onFolderDragLeave?: (event: React.DragEvent, id: string) => void
  dragOverFolderId?: string | null
  canManage: boolean
  canSelect: boolean
  className?: string
  /** Custom icon resolver for documents; defaults to getFileIcon(). */
  resolveDocumentIcon?: (doc: GridDocument) => FileIconDescriptor
}

/**
 * Two-state grid view of folders + documents in the current scope.
 * Folders come first (matches the previous list ordering); both kinds
 * share a tile shape and grid layout.
 */
export function DocumentGrid(props: DocumentGridProps) {
  const {
    folders,
    documents,
    selectedFolderIds,
    selectedDocumentIds,
    toggleFolder,
    toggleDocument,
    openFolder,
    openDocument,
    onFolderContextMenu,
    onDocumentContextMenu,
    onFolderAction,
    onDocumentAction,
    onFolderDragStart,
    onDocumentDragStart,
    onFolderDrop,
    onFolderDragOver,
    onFolderDragLeave,
    dragOverFolderId,
    canManage,
    canSelect,
    className,
    resolveDocumentIcon = (doc) => getFileIcon({ mimeType: doc.mimeType ?? null, fileName: doc.fileName ?? null }),
  } = props

  const selectionActive = selectedFolderIds.size + selectedDocumentIds.size > 0

  return (
    <ul
      role="list"
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
        className,
      )}
    >
      {folders.map((folder) => {
        const tileProps: DocumentTileProps = {
          kind: "folder",
          name: folder.name,
          selected: selectedFolderIds.has(folder.id),
          selectionActive,
          canSelect,
          onSelect: () => toggleFolder(folder.id),
          onOpen: () => openFolder(folder.id),
          onContextMenu: (event) => onFolderContextMenu(event, folder.id),
          onAction: (event) => onFolderAction(event, folder.id),
          draggable: canManage,
          onDragStart: onFolderDragStart ? (event) => onFolderDragStart(event, folder.id) : undefined,
          dragOver: dragOverFolderId === folder.id,
          onDragOver: onFolderDragOver ? (event) => onFolderDragOver(event, folder.id) : undefined,
          onDragLeave: onFolderDragLeave ? (event) => onFolderDragLeave(event, folder.id) : undefined,
          onDrop: onFolderDrop ? (event) => onFolderDrop(event, folder.id) : undefined,
        }
        return (
          <li key={`folder-${folder.id}`}>
            <DocumentTile {...tileProps} />
          </li>
        )
      })}
      {documents.map((doc) => {
        const fileMeta = resolveDocumentIcon(doc)
        const tileProps: DocumentTileProps = {
          kind: "document",
          name: doc.title,
          selected: selectedDocumentIds.has(doc.id),
          selectionActive,
          canSelect,
          onSelect: () => toggleDocument(doc.id),
          onOpen: () => openDocument(doc.id),
          onContextMenu: (event) => onDocumentContextMenu(event, doc.id),
          onAction: (event) => onDocumentAction(event, doc.id),
          draggable: canManage,
          onDragStart: onDocumentDragStart ? (event) => onDocumentDragStart(event, doc.id) : undefined,
          fileMeta,
        }
        return (
          <li key={`doc-${doc.id}`}>
            <DocumentTile {...tileProps} />
          </li>
        )
      })}
    </ul>
  )
}
