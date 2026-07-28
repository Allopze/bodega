/** Sólo un borrador sin decisiones puede borrarse físicamente. */
export const DELETABLE_REQUEST_STATUSES = [
  "draft",
] as const

export type DeletableRequestStatus = typeof DELETABLE_REQUEST_STATUSES[number]

export function isRequestDeletable(status: string): status is DeletableRequestStatus {
  return (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(status)
}

/**
 * El solicitante y quien tiene `requests:delete` comparten el mismo límite:
 * sólo borradores. El permiso elevado no autoriza destruir evidencia de aprobación.
 */
export const OWNER_DELETABLE_REQUEST_STATUSES = [
  "draft",
] as const

export function isOwnerDeletable(status: string): boolean {
  return (OWNER_DELETABLE_REQUEST_STATUSES as readonly string[]).includes(status)
}
