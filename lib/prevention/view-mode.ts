export type DocumentViewMode = "list" | "grid"

const STORAGE_PREFIX = "sst.documents.viewMode."

function isDocumentViewMode(value: string | null): value is DocumentViewMode {
  return value === "list" || value === "grid"
}

/** Per-user key so two users on the same browser keep their own preference. */
export function documentViewModeKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export function getStoredViewMode(userId: string): DocumentViewMode {
  if (typeof window === "undefined") return "list"
  try {
    const raw = window.localStorage.getItem(documentViewModeKey(userId))
    return isDocumentViewMode(raw) ? raw : "list"
  } catch {
    // Storage can be disabled (private mode, quota errors, sandboxed iframes).
    return "list"
  }
}

export function setStoredViewMode(userId: string, mode: DocumentViewMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(documentViewModeKey(userId), mode)
  } catch {
    // Ignore — read will fall back to "list" next time.
  }
}
