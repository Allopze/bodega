"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { usePersistedViewMode } from "@/components/prevention/view-mode-toggle"
import { buildFolderOptionLabels } from "@/lib/services/prevention-documents/labels"
import type { DocumentRow, FolderRow, MenuState } from "./documentacion-view.types"
import { DRAG_MIME } from "./documentacion-view.types"
import {
  archiveSstDocumentAction,
  archiveSstDocumentFolderAction,
  moveSstDocumentAction,
  moveSstDocumentFolderAction,
  renameSstDocumentFolderAction,
  restoreSstDocumentFolderAction,
} from "./actions"

export interface DocumentacionViewState {
  pending: boolean
  moveDocumentId: string | null
  moveFolderId: string
  menu: MenuState
  viewerDocId: string | null
  dialogFolder: FolderRow | null
  folderAction: "rename" | "move" | null
  folderActionName: string
  folderActionParentId: string
  selectedFolders: Set<string>
  selectedDocuments: Set<string>
  bulkMoveOpen: boolean
  dragOverFolderId: string | null
  viewMode: "list" | "grid"
  selectedCount: number
  folderOptionLabels: { id: string; label: string }[]
  bulkDownloadHref: string
  filteredFolders: FolderRow[]
  filteredDocuments: DocumentRow[]
  isFiltering: boolean
  hasContent: boolean
}

export function useDocumentacionView(
  documents: DocumentRow[],
  folders: FolderRow[],
  folderOptions: { id: string; name: string; parentId: string | null }[],
  currentFolderId: string | null,
  searchParams: { q?: string; folder?: string; page?: string },
  canManage: boolean,
  canArchive: boolean,
  userId: string,
) {
  const router = useRouter()
  const { searchQuery } = useSafeShellHeader()

  const [pending, startTransition] = React.useTransition()
  const [moveDocumentId, setMoveDocumentId] = React.useState<string | null>(null)
  const [moveFolderId, setMoveFolderId] = React.useState<string>("")
  const [menu, setMenu] = React.useState<MenuState>(null)
  const [viewerDocId, setViewerDocId] = React.useState<string | null>(null)
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

  // Close context menu on Escape
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────

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

  const closeFolderAction = React.useCallback(() => {
    setFolderAction(null)
    setDialogFolder(null)
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

  const clearSelection = React.useCallback(() => {
    setSelectedFolders(new Set())
    setSelectedDocuments(new Set())
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
    const params = new URLSearchParams()
    const activeSearch = searchQuery.trim() || searchParams.q || ""
    if (activeSearch) params.set("q", activeSearch)
    if (folderId) params.set("folder", folderId)
    const query = params.toString()
    return `/prevencion/documentacion${query ? `?${query}` : ""}`
  }, [searchParams.q, searchQuery])

  // ── Filtering ────────────────────────────────────────────────────────────

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredFolders = React.useMemo(() => {
    if (!normalizedSearch) return folders
    return folders.filter((folder) => [folder.name, folder.worksiteName].some((value) => value?.toLowerCase().includes(normalizedSearch)))
  }, [folders, normalizedSearch])
  const filteredDocuments = React.useMemo(() => {
    if (!normalizedSearch) return documents
    return documents.filter((document) => [
      document.title,
      document.internalCode,
      document.fileName,
      document.worksiteName,
      document.responsibleName,
      document.uploaderName,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch)))
  }, [documents, normalizedSearch])
  const isFiltering = Boolean(searchParams.q || normalizedSearch)
  const hasContent = filteredFolders.length > 0 || filteredDocuments.length > 0

  // ── Drag handlers ────────────────────────────────────────────────────────

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

  return {
    // State
    pending, moveDocumentId, moveFolderId, menu, viewerDocId,
    dialogFolder, folderAction, folderActionName, folderActionParentId,
    selectedFolders, selectedDocuments, bulkMoveOpen, dragOverFolderId,
    viewMode, selectedCount, folderOptionLabels, bulkDownloadHref,
    filteredFolders, filteredDocuments, isFiltering, hasContent,
    // Setters
    setMoveDocumentId, setMoveFolderId, setMenu, setViewerDocId,
    setDialogFolder, setFolderAction, setFolderActionName, setFolderActionParentId,
    setSelectedFolders, setSelectedDocuments, setBulkMoveOpen, setDragOverFolderId,
    setViewMode,
    // Handlers
    moveDocument, openFolderAction, closeFolderAction,
    submitFolderRename, submitFolderMove, archiveFolder, restoreFolder,
    toggleFolderSelection, toggleDocumentSelection, clearSelection,
    archiveSelectedFolders, archiveSelectedDocuments, moveSelectedDocuments,
    openFolderMenu, openDocumentMenu, archiveDocument,
    handleDropOnFolder, folderHref,
    // Drag handlers
    onFolderDragStart, onDocumentDragStart, onFolderDragOver, onFolderDragLeave, onFolderDrop,
  }
}
