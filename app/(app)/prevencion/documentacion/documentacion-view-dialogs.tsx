"use client"

import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MenuState } from "./documentacion-view.types"
import { pluralize } from "@/lib/utils"

/** Dialog to move a single document. */
export function MoveDocumentDialog({
  open,
  moveDocumentId,
  moveFolderId,
  folderOptionLabels,
  pending,
  onMoveDocument,
  onClose,
  onFolderChange,
}: {
  open: boolean
  moveDocumentId: string | null
  moveFolderId: string
  folderOptionLabels: { id: string; label: string }[]
  pending: boolean
  onMoveDocument: (event: React.FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onFolderChange: (value: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <form onSubmit={onMoveDocument}>
          <DialogHeader>
            <DialogTitle>Mover documento</DialogTitle>
            <DialogDescription>Selecciona la carpeta de destino.</DialogDescription>
          </DialogHeader>
          <Select value={moveFolderId || "root"} onValueChange={(value) => onFolderChange(value === "root" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Documentación</SelectItem>
              {folderOptionLabels.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={pending || !moveDocumentId}>Mover</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog to move multiple selected documents. */
export function BulkMoveDialog({
  open,
  moveFolderId,
  selectedCount,
  folderOptionLabels,
  pending,
  onSubmit,
  onClose,
  onFolderChange,
}: {
  open: boolean
  moveFolderId: string
  selectedCount: number
  folderOptionLabels: { id: string; label: string }[]
  pending: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onFolderChange: (value: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Mover documentos seleccionados</DialogTitle>
            <DialogDescription>Selecciona la carpeta de destino para {pluralize(selectedCount, "documento")}.</DialogDescription>
          </DialogHeader>
          <Select value={moveFolderId || "root"} onValueChange={(value) => onFolderChange(value === "root" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Documentación</SelectItem>
              {folderOptionLabels.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={pending || selectedCount === 0}>Mover documentos a destino</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Context menu for folders and documents. */
export function ContextMenu({
  menu,
  canManage,
  canArchive,
  currentFolderId: _currentFolderId,
  onClose,
  onFolderAction,
  onArchiveFolder,
  onViewDocumentDetail,
  onDownloadDocument: _onDownloadDocument,
  onMoveDocument,
  onArchiveDocument,
}: {
  menu: MenuState
  canManage: boolean
  canArchive: boolean
  currentFolderId: string | null
  onClose: () => void
  onFolderAction: (folder: { id: string; name: string; parentId: string | null }, action: "rename" | "move") => void
  onArchiveFolder: (folder: { id: string }) => void
  onViewDocumentDetail: (documentId: string) => void
  onDownloadDocument: (documentId: string) => void
  onMoveDocument: (documentId: string) => void
  onArchiveDocument: (documentId: string) => void
}) {
  if (!menu) return null
  const x = Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240)
  const y = Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 220)

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => { event.preventDefault(); onClose() }}
      />
      <div
        role="menu"
        aria-label="Acciones"
        className="fixed z-50 min-w-56 rounded-md border border-(--color-border) bg-(--color-surface) p-1.5 shadow-(--shadow-md)"
        style={{ left: x, top: y }}
      >
        {menu.kind === "folder" && (
          <>
            <Link
              role="menuitem"
              href={menu.folder.parentId ? `/prevencion/documentacion?folder=${encodeURIComponent(menu.folder.id)}` : "/prevencion/documentacion"}
              className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)"
              onClick={onClose}
            >
              Abrir
            </Link>
            {canManage && (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)"
                onClick={() => { onFolderAction(menu.folder, "rename"); onClose() }}
              >
                Renombrar
              </button>
            )}
            {canManage && (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)"
                onClick={() => { onFolderAction(menu.folder, "move"); onClose() }}
              >
                Mover
              </button>
            )}
            {canArchive && (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded px-2.5 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-surface-2)"
                onClick={() => { onArchiveFolder(menu.folder); onClose() }}
              >
                Archivar
              </button>
            )}
          </>
        )}
        {menu.kind === "document" && (
          <>
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)"
              onClick={() => { onViewDocumentDetail(menu.doc.id); onClose() }}
            >
              Ver detalle
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)"
              onClick={() => { onViewDocumentDetail(menu.doc.id); onClose() }}
            >
              Vista previa
            </button>
            <Link
              role="menuitem"
              href={`/api/prevencion/documentacion/${menu.doc.id}?download=1`}
              className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)"
              onClick={onClose}
            >
              Descargar
            </Link>
            {canManage && (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)"
                onClick={() => { onMoveDocument(menu.doc.id); onClose() }}
              >
                Mover
              </button>
            )}
            {canArchive && (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded px-2.5 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-surface-2)"
                onClick={() => { onArchiveDocument(menu.doc.id); onClose() }}
              >
                Archivar
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

/** Dialog to rename a folder. */
export function RenameFolderDialog({
  open,
  folderActionName,
  pending,
  onNameChange,
  onSubmit,
  onClose,
}: {
  open: boolean
  folderActionName: string
  pending: boolean
  onNameChange: (name: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Renombrar carpeta</DialogTitle>
            <DialogDescription>Actualiza el nombre visible en la biblioteca.</DialogDescription>
          </DialogHeader>
          <label htmlFor="folder-action-name" className="mb-1 block text-sm font-medium text-(--color-text)">Nombre de carpeta</label>
          <Input
            id="folder-action-name"
            value={folderActionName}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={pending || !folderActionName.trim()}>Guardar nombre</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog to move a folder to another parent. */
export function MoveFolderDialog({
  open,
  folderActionParentId,
  dialogFolderId,
  folderOptionLabels,
  pending,
  onParentChange,
  onSubmit,
  onClose,
}: {
  open: boolean
  folderActionParentId: string
  dialogFolderId: string | null
  folderOptionLabels: { id: string; label: string }[]
  pending: boolean
  onParentChange: (parentId: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Mover carpeta</DialogTitle>
            <DialogDescription>Selecciona una carpeta padre o vuelve a la raíz.</DialogDescription>
          </DialogHeader>
          <Select value={folderActionParentId || "root"} onValueChange={(value) => onParentChange(value === "root" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Documentación</SelectItem>
              {folderOptionLabels
                .filter((folder) => folder.id !== dialogFolderId)
                .map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={pending}>Mover carpeta a destino</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
