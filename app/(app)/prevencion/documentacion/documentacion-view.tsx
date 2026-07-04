"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DownloadSimple,
  DotsThreeVertical,
  FolderOpen,
} from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DocumentGrid, type GridDocument, type GridFolder } from "@/components/prevention/document-grid"
import { ViewModeToggle, usePersistedViewMode } from "@/components/prevention/view-mode-toggle"
import { cn } from "@/lib/utils"
import { buildFolderOptionLabels } from "@/lib/services/prevention-documents/labels"
import { getFileIcon } from "@/lib/prevention/file-icon"
import {
  archiveSstDocumentAction,
  archiveSstDocumentFolderAction,
  moveSstDocumentAction,
  moveSstDocumentFolderAction,
  renameSstDocumentFolderAction,
  restoreSstDocumentFolderAction,
} from "./actions"

interface DocumentRow {
  id: string
  title: string
  internalCode: string | null
  categorySlug: string
  status: string
  confidentiality: string
  worksiteId: string | null
  worksiteName?: string | null
  responsibleUserId: string | null
  responsibleName?: string | null
  uploaderName?: string | null
  expiresAt: string | null
  daysUntilExpiry?: number | null
  currentVersionId: string | null
  fileName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  requiresAcknowledgment: boolean
  updatedAt: string
}

interface FolderRow {
  id: string
  parentId: string | null
  name: string
  worksiteId: string | null
  worksiteName?: string | null
  archivedAt?: string | null
  updatedAt: string
}

interface FolderOption {
  id: string
  name: string
  parentId: string | null
}

interface BreadcrumbItem {
  label: string
  href?: string
}

interface Props {
  counters?: unknown
  expiring?: unknown[]
  documents: DocumentRow[]
  folders?: FolderRow[]
  folderOptions?: FolderOption[]
  breadcrumbs?: BreadcrumbItem[]
  currentFolderId?: string | null
  categories?: unknown[]
  types?: unknown[]
  searchParams: { q?: string; category?: string; status?: string; worksiteId?: string }
  total: number
  canManage: boolean
  canApprove?: boolean
  canAck?: boolean
  canArchive: boolean
  userId: string
}

type MenuState =
  | { kind: "folder"; folder: FolderRow; x: number; y: number }
  | { kind: "document"; doc: DocumentRow; x: number; y: number }
  | null

const DRAG_MIME = "application/x-sst-doc-item"

export function DocumentacionView(props: Props) {
  const router = useRouter()
  const {
    documents,
    folders = [],
    folderOptions = [],
    currentFolderId = null,
    canManage,
    canArchive,
    userId,
  } = props

  const { searchQuery } = useSafeShellHeader()
  const [pending, startTransition] = React.useTransition()
  const [moveDocumentId, setMoveDocumentId] = React.useState<string | null>(null)
  const [moveFolderId, setMoveFolderId] = React.useState<string>("")
  const [menu, setMenu] = React.useState<MenuState>(null)
  const [dialogFolder, setDialogFolder] = React.useState<FolderRow | null>(null)
  const [folderAction, setFolderAction] = React.useState<"rename" | "move" | null>(null)
  const [folderActionName, setFolderActionName] = React.useState("")
  const [folderActionParentId, setFolderActionParentId] = React.useState("")
  const [selectedFolders, setSelectedFolders] = React.useState<Set<string>>(() => new Set())
  const [selectedDocuments, setSelectedDocuments] = React.useState<Set<string>>(() => new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = React.useState(false)
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null)
  const [viewMode, setViewMode] = usePersistedViewMode(userId)

  const selectedCount = selectedFolders.size + selectedDocuments.size
  const folderOptionLabels = React.useMemo(() => buildFolderOptionLabels(folderOptions), [folderOptions])
  const bulkDownloadHref = selectedDocuments.size > 0
    ? `/api/prevencion/documentacion/bulk-download?ids=${encodeURIComponent(Array.from(selectedDocuments).join(","))}`
    : "#"

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [])

  const moveDocument = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!moveDocumentId) return
    startTransition(async () => {
      const result = await moveSstDocumentAction({ id: moveDocumentId, folderId: moveFolderId || null })
      if (result.ok) {
        setMoveDocumentId(null)
        setMoveFolderId("")
        router.refresh()
      }
    })
  }, [moveDocumentId, moveFolderId, router])

  const openFolderAction = React.useCallback((folder: FolderRow, action: "rename" | "move") => {
    setMenu(null)
    setDialogFolder(folder)
    setFolderAction(action)
    setFolderActionName(folder.name)
    setFolderActionParentId(folder.parentId ?? "")
  }, [])

  const submitFolderRename = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialogFolder) return
    const name = folderActionName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await renameSstDocumentFolderAction({ id: dialogFolder.id, name })
      if (result.ok) {
        setFolderAction(null)
        setDialogFolder(null)
        router.refresh()
      }
    })
  }, [dialogFolder, folderActionName, router])

  const submitFolderMove = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialogFolder) return
    startTransition(async () => {
      const result = await moveSstDocumentFolderAction({ id: dialogFolder.id, parentId: folderActionParentId || null })
      if (result.ok) {
        setFolderAction(null)
        setDialogFolder(null)
        router.refresh()
      }
    })
  }, [dialogFolder, folderActionParentId, router])

  const archiveFolder = React.useCallback((folder: FolderRow) => {
    startTransition(async () => {
      const result = await archiveSstDocumentFolderAction({ id: folder.id })
      if (result.ok) {
        setMenu(null)
        router.refresh()
      }
    })
  }, [router])

  const restoreFolder = React.useCallback((folder: FolderRow) => {
    startTransition(async () => {
      const result = await restoreSstDocumentFolderAction({ id: folder.id })
      if (result.ok) router.refresh()
    })
  }, [router])

  const toggleFolderSelection = React.useCallback((folderId: string) => {
    setSelectedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const toggleDocumentSelection = React.useCallback((documentId: string) => {
    setSelectedDocuments((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }, [])

  const archiveSelectedFolders = React.useCallback(() => {
    const ids = Array.from(selectedFolders)
    if (ids.length === 0) return
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => archiveSstDocumentFolderAction({ id })))
      if (results.every((result) => result.ok)) {
        setSelectedFolders(new Set())
        router.refresh()
      }
    })
  }, [router, selectedFolders])

  const archiveSelectedDocuments = React.useCallback(() => {
    const ids = Array.from(selectedDocuments)
    if (ids.length === 0) return
    startTransition(async () => {
      const results = await Promise.all(ids.map((documentId) => archiveSstDocumentAction({ documentId })))
      if (results.every((result) => result.ok)) {
        setSelectedDocuments(new Set())
        router.refresh()
      }
    })
  }, [router, selectedDocuments])

  const moveSelectedDocuments = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const ids = Array.from(selectedDocuments)
    if (ids.length === 0) return
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => moveSstDocumentAction({ id, folderId: moveFolderId || null })))
      if (results.every((result) => result.ok)) {
        setBulkMoveOpen(false)
        setMoveFolderId("")
        setSelectedDocuments(new Set())
        router.refresh()
      }
    })
  }, [moveFolderId, router, selectedDocuments])

  const openFolderMenu = React.useCallback((event: React.MouseEvent, folder: FolderRow) => {
    event.preventDefault()
    setMenu({ kind: "folder", folder, x: event.clientX, y: event.clientY })
  }, [])

  const openDocumentMenu = React.useCallback((event: React.MouseEvent, doc: DocumentRow) => {
    event.preventDefault()
    setMenu({ kind: "document", doc, x: event.clientX, y: event.clientY })
  }, [])

  const archiveDocument = React.useCallback((documentId: string) => {
    startTransition(async () => {
      const result = await archiveSstDocumentAction({ documentId })
      if (result.ok) {
        setMenu(null)
        router.refresh()
      }
    })
  }, [router])

  // Drag-to-move estilo Google Drive: soltar un documento o carpeta sobre otra
  // carpeta lo mueve dentro. El payload viaja en un MIME propio para no chocar
  // con la subida de archivos del sistema operativo (que usa dataTransfer.files).
  const handleDropOnFolder = React.useCallback((event: React.DragEvent, folder: FolderRow) => {
    const raw = event.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    event.preventDefault()
    setDragOverFolderId(null)
    let payload: { kind: "folder" | "document"; id: string }
    try { payload = JSON.parse(raw) as typeof payload } catch { return }
    if (payload.kind === "document") {
      startTransition(async () => {
        const result = await moveSstDocumentAction({ id: payload.id, folderId: folder.id })
        if (result.ok) router.refresh()
      })
    } else if (payload.kind === "folder" && payload.id !== folder.id) {
      startTransition(async () => {
        const result = await moveSstDocumentFolderAction({ id: payload.id, parentId: folder.id })
        if (result.ok) router.refresh()
      })
    }
  }, [router])

  const folderHref = React.useCallback((folderId: string | null) => {
    if (!folderId) return "/prevencion/documentacion"
    return `/prevencion/documentacion?folder=${encodeURIComponent(folderId)}`
  }, [])

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("es-CL")
  const matchesSearch = React.useCallback((values: Array<string | null | undefined>) => {
    if (!normalizedSearchQuery) return true
    return values.some((value) => value?.toLocaleLowerCase("es-CL").includes(normalizedSearchQuery))
  }, [normalizedSearchQuery])
  const filteredFolders = React.useMemo(() => (
    folders.filter((folder) => matchesSearch([folder.name, folder.worksiteName]))
  ), [folders, matchesSearch])
  const filteredDocuments = React.useMemo(() => (
    documents.filter((document) => matchesSearch([
      document.title,
      document.fileName,
      document.internalCode,
      document.worksiteName,
      document.uploaderName,
    ]))
  ), [documents, matchesSearch])
  const isFiltering = normalizedSearchQuery.length > 0
  const hasContent = filteredFolders.length > 0 || filteredDocuments.length > 0

  const gridFolders: GridFolder[] = filteredFolders
  const gridDocuments: GridDocument[] = filteredDocuments.map((d) => ({
    id: d.id,
    title: d.title,
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    updatedAt: d.updatedAt,
  }))

  const onFolderDragStart = React.useCallback((event: React.DragEvent, folderId: string) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "folder", id: folderId }))
    event.dataTransfer.effectAllowed = "move"
  }, [])
  const onDocumentDragStart = React.useCallback((event: React.DragEvent, documentId: string) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "document", id: documentId }))
    event.dataTransfer.effectAllowed = "move"
  }, [])
  const onFolderDragOver = React.useCallback((event: React.DragEvent, folderId: string) => {
    if (canManage && event.dataTransfer.types.includes(DRAG_MIME)) {
      event.preventDefault()
      setDragOverFolderId(folderId)
    }
  }, [canManage])
  const onFolderDragLeave = React.useCallback((_event: React.DragEvent, folderId: string) => {
    setDragOverFolderId((current) => (current === folderId ? null : current))
  }, [])
  const onFolderDrop = React.useCallback((event: React.DragEvent, folderId: string) => {
    const folder = folders.find((f) => f.id === folderId)
    if (folder) handleDropOnFolder(event, folder)
  }, [folders, handleDropOnFolder])

  return (
      <div className="space-y-5">
        <div className="flex justify-end">
          <ViewModeToggle userId={userId} value={viewMode} onChange={setViewMode} />
        </div>

        {!hasContent ? (
          <>
            <EmptyState
              title={isFiltering ? "Sin resultados" : "Carpeta vacía"}
              description={isFiltering ? "No hay carpetas ni documentos que coincidan con la búsqueda del header." : "Sube documentos o crea una carpeta para ordenar la documentación preventiva."}
            />
          </>
        ) : (
          <div className="space-y-3">
            {selectedCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) bg-(--color-chrome) px-4 py-2">
                <span className="text-sm font-medium text-(--color-text)">{selectedCount} seleccionados</span>
                <div className="flex gap-2">
                  {canArchive && selectedFolders.size > 0 && (
                    <Button type="button" size="sm" variant="secondary" onClick={archiveSelectedFolders} disabled={pending}>
                      Archivar carpetas seleccionadas
                    </Button>
                  )}
                  {canManage && selectedDocuments.size > 0 && (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={bulkDownloadHref}>
                        Descargar documentos seleccionados
                      </Link>
                    </Button>
                  )}
                  {canManage && selectedDocuments.size > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setMoveFolderId(currentFolderId ?? "")
                        setBulkMoveOpen(true)
                      }}
                      disabled={pending}
                    >
                      Mover documentos seleccionados
                    </Button>
                  )}
                  {canArchive && selectedDocuments.size > 0 && (
                    <Button type="button" size="sm" variant="secondary" onClick={archiveSelectedDocuments} disabled={pending}>
                      Archivar documentos seleccionados
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedFolders(new Set())
                      setSelectedDocuments(new Set())
                    }}
                  >
                    Limpiar selección
                  </Button>
                </div>
              </div>
            )}
            {viewMode === "list" ? (
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
                    {filteredFolders.map((folder) => (
                      <TableRow
                        key={folder.id}
                        draggable={canManage}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "folder", id: folder.id }))
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onDragOver={(event) => {
                          if (canManage && event.dataTransfer.types.includes(DRAG_MIME)) {
                            event.preventDefault()
                            setDragOverFolderId(folder.id)
                          }
                        }}
                        onDragLeave={() => setDragOverFolderId((current) => (current === folder.id ? null : current))}
                        onDrop={(event) => handleDropOnFolder(event, folder)}
                        onContextMenu={(event) => openFolderMenu(event, folder)}
                        className={cn(dragOverFolderId === folder.id && "bg-(--color-surface-2) outline outline-2 -outline-offset-2 outline-(--color-primary)")}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar carpeta ${folder.name}`}
                            checked={selectedFolders.has(folder.id)}
                            onChange={() => toggleFolderSelection(folder.id)}
                            className="h-4 w-4 accent-[var(--color-primary)]"
                          />
                        </TableCell>
                        <TableCell>
                          <Link
                            href={folderHref(folder.id)}
                            draggable={false}
                            onContextMenu={(event) => openFolderMenu(event, folder)}
                            aria-label={`Carpeta ${folder.name}`}
                            className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline"
                          >
                            <FolderOpen size={18} weight="duotone" className="text-(--color-primary)" aria-hidden />
                            {folder.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-(--color-text-subtle)">Carpeta</TableCell>
                        <TableCell className="text-xs text-(--color-text-subtle)">{formatDate(folder.updatedAt)}</TableCell>
                        <TableCell className="text-xs">—</TableCell>
                        <TableCell className="text-right">
                          {folder.archivedAt && canArchive ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              aria-label={`Restaurar carpeta ${folder.name}`}
                              onClick={() => restoreFolder(folder)}
                              disabled={pending}
                            >
                              Restaurar
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="icon" variant="ghost" aria-label={`Acciones de ${folder.name}`}>
                                  <DotsThreeVertical size={16} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild><Link href={folderHref(folder.id)}>Abrir</Link></DropdownMenuItem>
                                {canManage && <DropdownMenuItem onSelect={() => openFolderAction(folder, "rename")}>Renombrar</DropdownMenuItem>}
                                {canManage && <DropdownMenuItem onSelect={() => openFolderAction(folder, "move")}>Mover</DropdownMenuItem>}
                                {canArchive && <DropdownMenuItem onSelect={() => archiveFolder(folder)} className="text-(--color-danger)">Archivar</DropdownMenuItem>}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredDocuments.map((d) => (
                      <DocumentTableRow
                        key={d.id}
                        document={d}
                        canManage={canManage}
                        selected={selectedDocuments.has(d.id)}
                        onToggleSelected={() => toggleDocumentSelection(d.id)}
                        onContextMenu={(event) => openDocumentMenu(event, d)}
                        onMove={() => {
                          setMoveDocumentId(d.id)
                          setMoveFolderId(currentFolderId ?? "")
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
                selectedFolderIds={selectedFolders}
                selectedDocumentIds={selectedDocuments}
                toggleFolder={toggleFolderSelection}
                toggleDocument={toggleDocumentSelection}
                openFolder={(id) => router.push(folderHref(id))}
                openDocument={(id) => router.push(`/prevencion/documentacion/${id}`)}
                onFolderContextMenu={openFolderMenuForGrid}
                onDocumentContextMenu={openDocumentMenuForGrid}
                onFolderAction={openFolderMenuForGrid}
                onDocumentAction={openDocumentMenuForGrid}
                onFolderDragStart={onFolderDragStart}
                onDocumentDragStart={onDocumentDragStart}
                onFolderDragOver={onFolderDragOver}
                onFolderDragLeave={onFolderDragLeave}
                onFolderDrop={onFolderDrop}
                dragOverFolderId={dragOverFolderId}
                canManage={canManage}
                canSelect
              />
            )}
          </div>
        )}

        <Dialog open={Boolean(moveDocumentId)} onOpenChange={(open) => { if (!open) setMoveDocumentId(null) }}>
          <DialogContent>
            <form onSubmit={moveDocument}>
              <DialogHeader>
                <DialogTitle>Mover documento</DialogTitle>
                <DialogDescription>Selecciona la carpeta de destino.</DialogDescription>
              </DialogHeader>
              <Select value={moveFolderId || "root"} onValueChange={(value) => setMoveFolderId(value === "root" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Documentación</SelectItem>
                  {folderOptionLabels.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button type="submit" disabled={pending}>Mover</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
          <DialogContent>
            <form onSubmit={moveSelectedDocuments}>
              <DialogHeader>
                <DialogTitle>Mover documentos seleccionados</DialogTitle>
                <DialogDescription>Selecciona la carpeta de destino para {selectedDocuments.size} documento{selectedDocuments.size === 1 ? "" : "s"}.</DialogDescription>
              </DialogHeader>
              <Select value={moveFolderId || "root"} onValueChange={(value) => setMoveFolderId(value === "root" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Documentación</SelectItem>
                  {folderOptionLabels.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button type="submit" disabled={pending || selectedDocuments.size === 0}>Mover documentos a destino</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {menu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenu(null)}
              onContextMenu={(event) => { event.preventDefault(); setMenu(null) }}
            />
            <div
              role="menu"
              aria-label="Acciones"
              className="fixed z-50 min-w-56 rounded-md border border-(--color-border) bg-(--color-surface) p-1.5 shadow-(--shadow-md)"
              style={{
                left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240),
                top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 220),
              }}
            >
              {menu.kind === "folder" && (
                <Link role="menuitem" href={folderHref(menu.folder.id)} className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)" onClick={() => setMenu(null)}>Abrir</Link>
              )}
              {menu.kind === "folder" && canManage && (
                <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => openFolderAction(menu.folder, "rename")}>Renombrar</button>
              )}
              {menu.kind === "folder" && canManage && (
                <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => openFolderAction(menu.folder, "move")}>Mover</button>
              )}
              {menu.kind === "folder" && canArchive && (
                <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-surface-2)" onClick={() => archiveFolder(menu.folder)}>Archivar</button>
              )}
              {menu.kind === "document" && (
                <Link role="menuitem" href={`/prevencion/documentacion/${menu.doc.id}`} className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)" onClick={() => setMenu(null)}>Ver detalle</Link>
              )}
              {menu.kind === "document" && (
                <Link role="menuitem" href={`/api/prevencion/documentacion/${menu.doc.id}`} target="_blank" className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)" onClick={() => setMenu(null)}>Vista previa</Link>
              )}
              {menu.kind === "document" && (
                <Link role="menuitem" href={`/api/prevencion/documentacion/${menu.doc.id}?download=1`} className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)" onClick={() => setMenu(null)}>Descargar</Link>
              )}
              {menu.kind === "document" && canManage && (
                <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => { const id = menu.doc.id; setMenu(null); setMoveDocumentId(id); setMoveFolderId(currentFolderId ?? "") }}>Mover</button>
              )}
              {menu.kind === "document" && canArchive && (
                <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-surface-2)" onClick={() => archiveDocument(menu.doc.id)}>Archivar</button>
              )}
            </div>
          </>
        )}

        <Dialog open={folderAction === "rename"} onOpenChange={(open) => { if (!open) setFolderAction(null) }}>
          <DialogContent>
            <form onSubmit={submitFolderRename}>
              <DialogHeader>
                <DialogTitle>Renombrar carpeta</DialogTitle>
                <DialogDescription>Actualiza el nombre visible en la biblioteca.</DialogDescription>
              </DialogHeader>
              <label htmlFor="folder-action-name" className="mb-1 block text-sm font-medium text-(--color-text)">Nombre de carpeta</label>
              <Input
                id="folder-action-name"
                value={folderActionName}
                onChange={(event) => setFolderActionName(event.target.value)}
              />
              <DialogFooter>
                <Button type="submit" disabled={pending || !folderActionName.trim()}>Guardar nombre</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={folderAction === "move"} onOpenChange={(open) => { if (!open) setFolderAction(null) }}>
          <DialogContent>
            <form onSubmit={submitFolderMove}>
              <DialogHeader>
                <DialogTitle>Mover carpeta</DialogTitle>
                <DialogDescription>Selecciona una carpeta padre o vuelve a la raíz.</DialogDescription>
              </DialogHeader>
              <Select value={folderActionParentId || "root"} onValueChange={(value) => setFolderActionParentId(value === "root" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Documentación</SelectItem>
                  {folderOptionLabels
                    .filter((folder) => folder.id !== dialogFolder?.id)
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
      </div>
    )

  function openFolderMenuForGrid(event: React.MouseEvent, folderId: string) {
    const folder = folders.find((f) => f.id === folderId)
    if (folder) openFolderMenu(event, folder)
  }
  function openDocumentMenuForGrid(event: React.MouseEvent, documentId: string) {
    const doc = documents.find((d) => d.id === documentId)
    if (doc) openDocumentMenu(event, doc)
  }
}

function DocumentTableRow({
  document: d,
  canManage,
  selected,
  onToggleSelected,
  onContextMenu,
  onMove,
}: {
  document: DocumentRow
  canManage: boolean
  selected: boolean
  onToggleSelected: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onMove: () => void
}) {
  const fileMeta = getFileIcon({ mimeType: d.mimeType ?? null, fileName: d.fileName ?? null })
  const FileIcon = fileMeta.Icon
  return (
    <TableRow
      draggable={canManage}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "document", id: d.id }))
        event.dataTransfer.effectAllowed = "move"
      }}
      onContextMenu={onContextMenu}
    >
      <TableCell>
        <input
          type="checkbox"
          aria-label={`Seleccionar documento ${d.title}`}
          checked={selected}
          onChange={onToggleSelected}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <Link href={`/prevencion/documentacion/${d.id}`} draggable={false} className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline">
            <FileIcon size={18} weight="duotone" style={{ color: fileMeta.color }} />
            {d.title}
          </Link>
          {d.fileName && d.fileName !== d.title && (
            <span className="text-xs text-(--color-text-subtle)">{d.fileName}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{fileMeta.label}</TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{formatDate(d.updatedAt)}</TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{formatFileSize(d.fileSize)}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/api/prevencion/documentacion/${d.id}?download=1`}>
              <DownloadSimple size={14} className="mr-1" />
              Descargar
            </Link>
          </Button>
          {canManage && (
            <Button type="button" size="sm" variant="ghost" onClick={onMove}>
              Mover
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" aria-label={`Acciones de ${d.title}`}>
                <DotsThreeVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link href={`/prevencion/documentacion/${d.id}`}>Ver detalle</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/api/prevencion/documentacion/${d.id}`} target="_blank">Vista previa</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/api/prevencion/documentacion/${d.id}?download=1`}>Descargar</Link></DropdownMenuItem>
              {canManage && <DropdownMenuSeparator />}
              {canManage && <DropdownMenuItem onSelect={onMove}>Mover</DropdownMenuItem>}
              {canManage && <DropdownMenuItem asChild><Link href={`/prevencion/documentacion/${d.id}`}>Subir nueva versión</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

function formatFileSize(size: number | null | undefined) {
  if (!size) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  return value.slice(0, 10)
}
