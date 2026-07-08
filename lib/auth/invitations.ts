export type InvitationStatus = "pending" | "accepted" | "cancelled" | "replaced" | "expired"

export interface InvitationLifecycleInput {
  acceptedAt: string | null
  cancelledAt: string | null
  replacedAt: string | null
  expiresAt: string
}

export function getInvitationStatus(
  invitation: InvitationLifecycleInput,
  now = new Date(),
): InvitationStatus {
  if (invitation.acceptedAt) return "accepted"
  if (invitation.cancelledAt) return "cancelled"
  if (invitation.replacedAt) return "replaced"
  if (new Date(invitation.expiresAt).getTime() < now.getTime()) return "expired"
  return "pending"
}

export function isInvitationUsable(invitation: InvitationLifecycleInput, now = new Date()): boolean {
  return getInvitationStatus(invitation, now) === "pending"
}

export function parseInvitationJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function buildInvitationUrl(baseUrl: string, token: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")

  return `${normalizedBaseUrl}/registro?token=${encodeURIComponent(token)}`
}
