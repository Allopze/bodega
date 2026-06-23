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
