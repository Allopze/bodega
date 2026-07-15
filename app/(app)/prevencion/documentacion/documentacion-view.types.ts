/**
 * Types for the SST Document Library view.
 */

export interface DocumentRow {
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
  canArchive: boolean
  userId: string
}

export type MenuState =
  | { kind: "folder"; folder: FolderRow; x: number; y: number }
  | { kind: "document"; doc: DocumentRow; x: number; y: number }
  | null

/** Custom MIME type used for drag-to-move between folders. */
export const DRAG_MIME = "application/x-sst-doc-item"
