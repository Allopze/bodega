/**
 * Types for the SST Document Library view.
 */

export interface DocumentRow {
  id: string
  title: string
  internalCode: string | null
  categorySlug: string
  /** Tipo documental; sin tipo el documento no acredita nada del programa preventivo. */
  typeId?: string | null
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

export interface FolderRow {
  id: string
  parentId: string | null
  name: string
  worksiteId: string | null
  worksiteName?: string | null
  archivedAt?: string | null
  updatedAt: string
}

export interface FolderOption {
  id: string
  name: string
  parentId: string | null
}

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface Props {
  counters?: {
    pendingReview: number
    observed: number
    ackPending: number
    expiringSoon: { within7: number; within15: number; within30: number }
  }
  expiring?: unknown[]
  documents: DocumentRow[]
  folders?: FolderRow[]
  folderOptions?: FolderOption[]
  breadcrumbs?: BreadcrumbItem[]
  currentFolderId?: string | null
  searchParams: { q?: string; folder?: string; page?: string; vence?: string }
  total: number
  canManage: boolean
  canArchive: boolean
  userId: string
}

export type MenuState =
  | { kind: "folder"; folder: FolderRow; x: number; y: number }
  | { kind: "document"; doc: DocumentRow; x: number; y: number }
  | null

/** Custom MIME type used for drag-to-move between folders. */
export const DRAG_MIME = "application/x-sst-doc-item"
