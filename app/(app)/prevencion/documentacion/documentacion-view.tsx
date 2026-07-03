"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  DownloadSimple,
  DotsThreeVertical,
  FileArrowUp,
  FilePlus,
  FileText,
  FolderPlus,
  FolderOpen,
  MagnifyingGlass,
} from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DashboardCounters, ExpiringDocument, SstDocumentStatus } from "@/lib/services/prevention-documents-library"
import { buildFolderOptionLabels } from "@/lib/services/prevention-documents-library"
import {
  archiveSstDocumentAction,
  createAndUploadSstDocumentAction,
  createSstDocumentFolderAction,
  archiveSstDocumentFolderAction,
  moveSstDocumentAction,
  moveSstDocumentFolderAction,
  renameSstDocumentFolderAction,
  restoreSstDocumentFolderAction,
} from "./actions"

interface CategoryRow {
  slug: string
  name: string
  description: string | null
  sortOrder: number
}

interface TypeRow {
  id: string
  categorySlug: string
  code: string
  name: string
}

interface DocumentRow {
  id: string
  title: string
  internalCode: string | null
  categorySlug: string
  status: string
  confidentiality: string
  worksiteId: string | null
  worksiteName: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  uploaderName: string | null
  expiresAt: string | null
  daysUntilExpiry: number | null
  currentVersionId: string | null
  requiresAcknowledgment: boolean
  updatedAt: string
}

interface FolderRow {
  id: string
  parentId: string | null
  name: string
  worksiteId: string | null
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
  counters: DashboardCounters
  expiring: Array<ExpiringDocument & { worksiteName: string | null; responsibleName: string | null }>
  documents: DocumentRow[]
  folders?: FolderRow[]
  folderOptions?: FolderOption[]
  breadcrumbs?: BreadcrumbItem[]
  currentFolderId?: string | null
  categories: CategoryRow[]
  types: TypeRow[]
  searchParams: { q?: string; category?: string; status?: string; worksiteId?: string }
  total: number
  canManage: boolean
  canApprove: boolean
  canAck: boolean
  canArchive: boolean
}

const STATUS_LABELS: Record<SstDocumentStatus, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "primary" | "signal" | "outline"> = {
  borrador: "default",
  en_revision: "info",
  observado: "warning",
  aprobado: "info",
  vigente: "success",
  vencido: "danger",
  reemplazado: "outline",
  archivado: "outline",
}

export function DocumentacionView(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    counters,
    documents,
    folders = [],
    folderOptions = [],
    breadcrumbs = [{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }],
    currentFolderId = null,
    categories,
    searchParams: incoming,
    total,
    canManage,
    canArchive,
  } = props

  const [q, setQ] = React.useState(incoming.q ?? "")
  const [status, setStatus] = React.useState(incoming.status ?? "")
  const [pending, startTransition] = React.useTransition()
  const [folderName, setFolderName] = React.useState("")
  const [moveDocumentId, setMoveDocumentId] = React.useState<string | null>(null)
  const [moveFolderId, setMoveFolderId] = React.useState<string>("")
  const [contextFolder, setContextFolder] = React.useState<FolderRow | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = React.useState({ x: 0, y: 0 })
  const [folderAction, setFolderAction] = React.useState<"rename" | "move" | null>(null)
  const [folderActionName, setFolderActionName] = React.useState("")
  const [folderActionParentId, setFolderActionParentId] = React.useState("")
  const [selectedFolders, setSelectedFolders] = React.useState<Set<string>>(() => new Set())
  const [selectedDocuments, setSelectedDocuments] = React.useState<Set<string>>(() => new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = React.useState(false)
  const [droppedFiles, setDroppedFiles] = React.useState<File[]>([])

  const activeCategory = incoming.category && incoming.category !== "all" ? incoming.category : null
  const activeCategoryRow = activeCategory ? categories.find((c) => c.slug === activeCategory) : null
  const selectedCount = selectedFolders.size + selectedDocuments.size
  const newDocumentHref = `/prevencion/documentacion/nuevo${currentFolderId ? `?folder=${encodeURIComponent(currentFolderId)}` : ""}`
  const folderOptionLabels = React.useMemo(() => buildFolderOptionLabels(folderOptions), [folderOptions])
  const bulkDownloadHref = selectedDocuments.size > 0
    ? `/api/prevencion/documentacion/bulk-download?ids=${encodeURIComponent(Array.from(selectedDocuments).join(","))}`
    : "#"

  React.useEffect(() => {
    const closeContextMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextFolder(null)
    }
    document.addEventListener("keydown", closeContextMenu)
    return () => document.removeEventListener("keydown", closeContextMenu)
  }, [])

  const applyFilters = React.useCallback((next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (next.q !== undefined) { if (next.q) sp.set("q", next.q); else sp.delete("q") }
    if (next.status !== undefined) { if (next.status) sp.set("status", next.status); else sp.delete("status") }
    router.push(`/prevencion/documentacion?${sp.toString()}`)
  }, [router, searchParams])

  const createFolder = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = folderName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await createSstDocumentFolderAction({ name, parentId: currentFolderId })
      if (result.ok) {
        setFolderName("")
        router.refresh()
      }
    })
  }, [currentFolderId, folderName, router])

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
    setContextFolder(folder)
    setFolderAction(action)
    setFolderActionName(folder.name)
    setFolderActionParentId(folder.parentId ?? "")
  }, [])

  const submitFolderRename = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!contextFolder) return
    const name = folderActionName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await renameSstDocumentFolderAction({ id: contextFolder.id, name })
      if (result.ok) {
        setFolderAction(null)
        setContextFolder(null)
        router.refresh()
      }
    })
  }, [contextFolder, folderActionName, router])

  const submitFolderMove = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!contextFolder) return
    startTransition(async () => {
      const result = await moveSstDocumentFolderAction({ id: contextFolder.id, parentId: folderActionParentId || null })
      if (result.ok) {
        setFolderAction(null)
        setContextFolder(null)
        router.refresh()
      }
    })
  }, [contextFolder, folderActionParentId, router])

  const archiveFolder = React.useCallback((folder: FolderRow) => {
    startTransition(async () => {
      const result = await archiveSstDocumentFolderAction({ id: folder.id })
      if (result.ok) {
        setContextFolder(null)
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

  const openContextMenu = React.useCallback((event: React.MouseEvent, folder: FolderRow) => {
    event.preventDefault()
    setContextFolder(folder)
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
  }, [])

  const folderHref = React.useCallback((folderId: string | null) => {
    if (!folderId) return "/prevencion/documentacion"
    return `/prevencion/documentacion?folder=${encodeURIComponent(folderId)}`
  }, [])

  const hasContent = folders.length > 0 || documents.length > 0

  const Toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) bg-(--color-chrome) px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <StatChip label="Total" value={counters.total} />
        <StatChip label="Vigentes" value={counters.byStatus.vigente} tone="success" />
        <StatChip label="En revisión" value={counters.byStatus.en_revision} tone="info" />
        <StatChip label="Observados" value={counters.byStatus.observado} tone="warning" />
        <StatChip label="Vencidos" value={counters.byStatus.vencido} tone="danger" />
        <StatChip label="Próximos ≤30 d" value={counters.expiringSoon.within30} tone="warning" />
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary" size="sm">
                <FolderPlus size={16} className="mr-1" />
                Nueva carpeta
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={createFolder}>
                <DialogHeader>
                  <DialogTitle>Nueva carpeta</DialogTitle>
                  <DialogDescription>Se creará dentro de la ubicación actual.</DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  placeholder="Nombre de carpeta"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
                <DialogFooter>
                  <Button type="submit" disabled={pending || !folderName.trim()}>
                    Crear carpeta
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button asChild size="sm">
            <Link href={newDocumentHref}>
              <FileArrowUp size={16} className="mr-1" />
              Subir archivo
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/prevencion/documentacion/papelera">Papelera</Link>
          </Button>
        </div>
      )}
    </div>
  )

  if (!activeCategory) {
    return (
      <div className="space-y-5">
        <InlineBreadcrumbs items={breadcrumbs} />
        {Toolbar}

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); applyFilters({ q, status }) }}
        >
          <div className="relative min-w-[200px] flex-1">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" size={16} />
            <Input
              className="pl-9"
              placeholder="Buscar en documentación..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="secondary">Filtrar</Button>
        </form>

        {!hasContent ? (
          <>
            {canManage && (
              <DocumentDropzone
                categories={categories}
                currentFolderId={currentFolderId}
                droppedFiles={droppedFiles}
                href={newDocumentHref}
                onCreated={(documentId) => router.push(`/prevencion/documentacion/${documentId}`)}
                onFiles={setDroppedFiles}
              />
            )}
            <EmptyState
              title="Carpeta vacía"
              description="Sube documentos o crea una carpeta para ordenar la documentación preventiva."
            />
          </>
        ) : (
          <div className="space-y-3">
            {canManage && (
              <DocumentDropzone
                categories={categories}
                currentFolderId={currentFolderId}
                droppedFiles={droppedFiles}
                href={newDocumentHref}
                onCreated={(documentId) => router.push(`/prevencion/documentacion/${documentId}`)}
                onFiles={setDroppedFiles}
              />
            )}
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
            <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Sel.</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Faena</TableHead>
                    <TableHead>Responsable</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {folders.map((folder) => (
                    <TableRow key={folder.id} onContextMenu={(event) => openContextMenu(event, folder)}>
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
                          onContextMenu={(event) => openContextMenu(event, folder)}
                          className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline"
                        >
                          <FolderOpen size={18} weight="duotone" className="text-(--color-primary)" />
                          {folder.name}
                        </Link>
                      </TableCell>
                      <TableCell><Badge variant="outline">Carpeta</Badge></TableCell>
                      <TableCell className="text-xs">{folder.worksiteId ?? "Global"}</TableCell>
                      <TableCell className="text-xs">—</TableCell>
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
                  {documents.map((d) => (
                    <DocumentTableRow
                      key={d.id}
                      document={d}
                      canManage={canManage}
                      selected={selectedDocuments.has(d.id)}
                      onToggleSelected={() => toggleDocumentSelection(d.id)}
                      onMove={() => {
                        setMoveDocumentId(d.id)
                        setMoveFolderId(currentFolderId ?? "")
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
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

        {contextFolder && (
          <div
            role="menu"
            aria-label="Acciones contextuales"
            className="fixed z-50 min-w-56 rounded-md border border-(--color-border) bg-(--color-surface) p-1.5 shadow-(--shadow-md)"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <Link role="menuitem" href={folderHref(contextFolder.id)} className="block rounded px-2.5 py-2 text-sm hover:bg-(--color-surface-2)">Abrir</Link>
            {canManage && (
              <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => openFolderAction(contextFolder, "rename")}>
                Renombrar carpeta
              </button>
            )}
            {canManage && (
              <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => openFolderAction(contextFolder, "move")}>
                Mover carpeta
              </button>
            )}
            {canArchive && (
              <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-surface-2)" onClick={() => archiveFolder(contextFolder)}>
                Archivar carpeta
              </button>
            )}
            <button type="button" role="menuitem" className="block w-full rounded px-2.5 py-2 text-left text-sm hover:bg-(--color-surface-2)" onClick={() => setContextFolder(null)}>
              Cerrar menú
            </button>
          </div>
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
                    .filter((folder) => folder.id !== contextFolder?.id)
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
  }

  // ── Document list (category selected) ────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/prevencion/documentacion"
          data-pressable
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--color-text-subtle) transition-[background-color] duration-(--duration-fast) hover:bg-(--color-chrome-hover) hover:text-(--color-text)"
        >
          <ArrowLeft size={18} />
        </Link>
        <FolderOpen size={20} weight="duotone" className="text-(--color-primary)" />
        <h2 className="text-lg font-semibold text-(--color-text)">{activeCategoryRow?.name ?? activeCategory}</h2>
        {canManage && (
          <div className="ml-auto">
            <Button asChild size="sm">
              <Link href="/prevencion/documentacion/nuevo">
                <FilePlus size={14} className="mr-1" />
                Nuevo documento
              </Link>
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); applyFilters({ q, status }) }}
      >
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" size={16} />
          <Input
            className="pl-9"
            placeholder="Título, código..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {(q || (status && status !== "all")) && (
          <Button type="button" variant="ghost" onClick={() => { setQ(""); setStatus(""); applyFilters({ q: "", status: "" }) }}>
            Limpiar
          </Button>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-(--color-text-subtle)">
            {total} documento{total === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <EmptyState
              title="No hay documentos"
              description="Esta carpeta está vacía o no coincide con los filtros."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => {
                  const tone = STATUS_TONES[d.status] ?? "default"
                  const days = d.daysUntilExpiry
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <Link href={`/prevencion/documentacion/${d.id}`} className="font-medium text-(--color-text) hover:underline">
                            {d.title}
                          </Link>
                          {d.internalCode && (
                            <span className="text-xs text-(--color-text-subtle)">{d.internalCode}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={tone}>{STATUS_LABELS[d.status as SstDocumentStatus] ?? d.status}</Badge></TableCell>
                      <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {d.expiresAt ? (
                          <Tooltip content={`${d.expiresAt}${days !== null ? ` · ${days} día(s)` : ""}`}>
                            <span className={cn(
                              days !== null && days < 0 && "font-semibold text-(--color-danger)",
                              days !== null && days >= 0 && days <= 30 && "text-(--color-warning)",
                            )}>
                              {d.expiresAt}
                            </span>
                          </Tooltip>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/prevencion/documentacion/${d.id}`}>Ver</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InlineBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Ruta de carpeta" className="flex flex-wrap items-center gap-1.5">
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span className="text-xs text-(--color-text-faint)">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-xs text-(--color-text-muted) hover:text-(--color-text)">
              {item.label}
            </Link>
          ) : (
            <span className="text-xs font-medium text-(--color-text-subtle)">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}

function DocumentDropzone({
  categories,
  currentFolderId,
  droppedFiles,
  href,
  onCreated,
  onFiles,
}: {
  categories: CategoryRow[]
  currentFolderId: string | null
  droppedFiles: File[]
  href: string
  onCreated: (documentId: string) => void
  onFiles: (files: File[]) => void
}) {
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [quickTitle, setQuickTitle] = React.useState("")
  const [quickCategory, setQuickCategory] = React.useState(categories[0]?.slug ?? "")
  const [pending, startTransition] = React.useTransition()
  const count = droppedFiles.length
  const firstFile = droppedFiles[0] ?? null

  React.useEffect(() => {
    if (!firstFile) return
    setQuickTitle(firstFile.name.replace(/\.[^.]+$/, ""))
  }, [firstFile])

  const submitQuickUpload = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!firstFile || !quickTitle.trim() || !quickCategory) return
    const formData = new FormData()
    formData.set("file", firstFile)
    formData.set("title", quickTitle.trim())
    formData.set("categorySlug", quickCategory)
    formData.set("confidentiality", "publico_interno")
    if (currentFolderId) formData.set("folderId", currentFolderId)
    startTransition(async () => {
      const result = await createAndUploadSstDocumentAction(formData)
      if (result.ok && result.data?.id) {
        onCreated(result.data.id)
        onFiles([])
        setQuickOpen(false)
      }
    })
  }, [currentFolderId, firstFile, onCreated, onFiles, quickCategory, quickTitle])

  return (
    <div
      aria-label="Zona para subir documentos"
      className="rounded-lg border border-dashed border-(--color-border) bg-(--color-surface) px-4 py-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--color-text)">Arrastra archivos a esta carpeta</p>
          <p className="text-xs text-(--color-text-subtle)">
            {count > 0
              ? `${count} archivo${count === 1 ? "" : "s"} listo${count === 1 ? "" : "s"} para registrar`
              : "El registro mantiene categoría, responsable, vigencia y control de versiones."}
          </p>
        </div>
        {count > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={href}>Crear documento con este archivo</Link>
            </Button>
            {firstFile && categories.length > 0 && (
              <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
                <DialogTrigger asChild>
                  <Button type="button" size="sm" variant="secondary">
                    Registrar y subir archivo directo
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={submitQuickUpload}>
                    <DialogHeader>
                      <DialogTitle>Registro rápido</DialogTitle>
                      <DialogDescription>Crea el documento y sube este archivo como primera versión.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <label htmlFor="quick-doc-title" className="block text-sm font-medium text-(--color-text)">Título rápido</label>
                      <Input
                        id="quick-doc-title"
                        value={quickTitle}
                        onChange={(event) => setQuickTitle(event.target.value)}
                      />
                      <label htmlFor="quick-doc-category" className="block text-sm font-medium text-(--color-text)">Categoría rápida</label>
                      <Select value={quickCategory} onValueChange={setQuickCategory}>
                        <SelectTrigger id="quick-doc-category"><SelectValue placeholder="Categoría" /></SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.slug} value={category.slug}>{category.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={pending || !quickTitle.trim() || !quickCategory}>
                        Crear documento y subir archivo
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentTableRow({
  document: d,
  canManage,
  selected,
  onToggleSelected,
  onMove,
}: {
  document: DocumentRow
  canManage: boolean
  selected: boolean
  onToggleSelected: () => void
  onMove: () => void
}) {
  const tone = STATUS_TONES[d.status] ?? "default"
  const days = d.daysUntilExpiry
  return (
    <TableRow>
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
          <Link href={`/prevencion/documentacion/${d.id}`} className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline">
            <FileText size={18} className="text-(--color-text-subtle)" />
            {d.title}
          </Link>
          {d.internalCode && (
            <span className="text-xs text-(--color-text-subtle)">{d.internalCode}</span>
          )}
        </div>
      </TableCell>
      <TableCell><Badge variant={tone}>{STATUS_LABELS[d.status as SstDocumentStatus] ?? d.status}</Badge></TableCell>
      <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
      <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
      <TableCell className="text-xs">
        {d.expiresAt ? (
          <Tooltip content={`${d.expiresAt}${days !== null ? ` · ${days} día(s)` : ""}`}>
            <span className={cn(
              days !== null && days < 0 && "font-semibold text-(--color-danger)",
              days !== null && days >= 0 && days <= 30 && "text-(--color-warning)",
            )}>
              {d.expiresAt}
            </span>
          </Tooltip>
        ) : "—"}
      </TableCell>
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
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onMove}>Mover</DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href={`/prevencion/documentacion/${d.id}`}>Subir nueva versión</Link></DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "success" | "info" | "warning" | "danger" }) {
  return (
    <span className="flex items-center gap-1.5 text-(--color-text-subtle)">
      <span className="text-xs">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        tone === "success" && "text-(--color-success)",
        tone === "info" && "text-(--color-info)",
        tone === "warning" && "text-(--color-warning)",
        tone === "danger" && "text-(--color-danger)",
        !tone && "text-(--color-text)",
      )}>
        {value}
      </span>
    </span>
  )
}
