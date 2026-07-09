/** Estados eliminables: nunca ingresaron a compra/recepción */
export const DELETABLE_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "partially_approved",
  "rejected",
  "returned",
  "cancelled",
] as const

export type DeletableRequestStatus = typeof DELETABLE_REQUEST_STATUSES[number]

export function isRequestDeletable(status: string): status is DeletableRequestStatus {
  return (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(status)
}

/**
 * Estados que el propio solicitante puede eliminar SIN el permiso `requests:delete`
 * (B-1): solicitudes que no están en el pipeline activo de aprobación. Borrar una
 * solicitud `submitted`/`in_review`/`partially_approved` (que un aprobador está
 * revisando) requiere el permiso privilegiado.
 */
export const OWNER_DELETABLE_REQUEST_STATUSES = [
  "draft",
  "returned",
  "rejected",
  "cancelled",
] as const

export function isOwnerDeletable(status: string): boolean {
  return (OWNER_DELETABLE_REQUEST_STATUSES as readonly string[]).includes(status)
}
