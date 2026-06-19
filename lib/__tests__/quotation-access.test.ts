import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { assertCanDeleteQuotation } from "@/lib/requests/quotation-access"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    user: {
      id: "user-1",
      name: "User",
      email: "user@test.cl",
      roles: ["solicitante_faena"],
      permissions: ["repuestos:submit"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: null,
      isActive: true,
      ...overrides,
    },
    expires: "2030-01-01T00:00:00.000Z",
  }
}

const request = {
  id: "req-1",
  requesterId: "user-1",
  worksiteId: "ws-1",
}

const quotation = {
  id: "quote-1",
  requestId: "req-1",
  uploadedBy: "user-1",
}

describe("assertCanDeleteQuotation", () => {
  it("rejects a quotation when the posted request id does not match its parent request", () => {
    expect(() => assertCanDeleteQuotation({
      session: makeSession(),
      request,
      quotation,
      expectedRequestId: "req-other",
      elevatedPermission: "repuestos:approve",
    })).toThrow("La cotización no pertenece a la solicitud indicada")
  })

  it("rejects deletion outside the user's visible worksites", () => {
    expect(() => assertCanDeleteQuotation({
      session: makeSession({ worksiteIds: ["ws-other"] }),
      request,
      quotation,
      expectedRequestId: "req-1",
      elevatedPermission: "repuestos:approve",
    })).toThrow("No tienes acceso a la faena de esta solicitud")
  })

  it("rejects users who are neither request owner, quotation uploader, nor elevated approver", () => {
    expect(() => assertCanDeleteQuotation({
      session: makeSession({ id: "user-2" }),
      request,
      quotation,
      expectedRequestId: "req-1",
      elevatedPermission: "repuestos:approve",
    })).toThrow("Solo el solicitante, quien subió la cotización o un aprobador puede eliminarla")
  })

  it("allows the request owner, quotation uploader, or an elevated approver", () => {
    expect(() => assertCanDeleteQuotation({
      session: makeSession({ id: "user-1" }),
      request,
      quotation: { ...quotation, uploadedBy: "user-2" },
      expectedRequestId: "req-1",
      elevatedPermission: "repuestos:approve",
    })).not.toThrow()

    expect(() => assertCanDeleteQuotation({
      session: makeSession({ id: "user-2" }),
      request: { ...request, requesterId: "user-3" },
      quotation: { ...quotation, uploadedBy: "user-2" },
      expectedRequestId: "req-1",
      elevatedPermission: "repuestos:approve",
    })).not.toThrow()

    expect(() => assertCanDeleteQuotation({
      session: makeSession({ id: "approver-1", permissions: ["repuestos:approve"] }),
      request,
      quotation,
      expectedRequestId: "req-1",
      elevatedPermission: "repuestos:approve",
    })).not.toThrow()
  })
})
