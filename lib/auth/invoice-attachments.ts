import type { Session } from "next-auth"

const INVOICE_ATTACHMENT_VIEW_ROLES = new Set(["jefa_chome", "secretaria", "prevencionista"])

export function canViewInvoiceAttachments(session: Session | null): boolean {
  return session?.user.roles?.some((role) => INVOICE_ATTACHMENT_VIEW_ROLES.has(role)) ?? false
}
