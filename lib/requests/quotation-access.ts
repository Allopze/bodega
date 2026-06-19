import type { Session } from "next-auth"
import { canAccessWorksite } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"

interface QuotationAccessRequest {
  id: string
  requesterId: string
  worksiteId: string
}

interface QuotationAccessQuotation {
  id: string
  requestId: string
  uploadedBy: string | null
}

export function assertCanDeleteQuotation(input: {
  session: Session
  request: QuotationAccessRequest
  quotation: QuotationAccessQuotation
  expectedRequestId: string
  elevatedPermission: Permission
}): void {
  const { session, request, quotation, expectedRequestId, elevatedPermission } = input

  if (quotation.requestId !== expectedRequestId || request.id !== expectedRequestId) {
    throw new Error("La cotización no pertenece a la solicitud indicada")
  }

  if (!canAccessWorksite(session, request.worksiteId)) {
    throw new Error("No tienes acceso a la faena de esta solicitud")
  }

  const isRequester = request.requesterId === session.user.id
  const isUploader = quotation.uploadedBy === session.user.id
  const isElevated = session.user.permissions.includes(elevatedPermission)

  if (!isRequester && !isUploader && !isElevated) {
    throw new Error("Solo el solicitante, quien subió la cotización o un aprobador puede eliminarla")
  }
}
