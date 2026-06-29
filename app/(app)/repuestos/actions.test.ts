import { describe, expect, it, vi } from "vitest"

const mockCreateRequestActions = vi.hoisted(() => vi.fn(() => ({
  saveDraftAction: vi.fn(),
  submitRequestAction: vi.fn(),
  uploadQuotationAction: vi.fn(),
  deleteQuotationAction: vi.fn(),
  selectQuotationAction: vi.fn(),
  cancelRequestAction: vi.fn(),
})))

vi.mock("@/lib/requests/request-actions", () => ({
  createRequestActions: (config: unknown) =>
    (mockCreateRequestActions as unknown as (config: unknown) => unknown)(config),
}))

vi.mock("@/lib/services/repuestos", () => ({
  persistRepuestoDraft: vi.fn(),
  addQuotation: vi.fn(),
  deleteQuotation: vi.fn(),
  submitRepuestoRequest: vi.fn(),
  selectRepuestoQuotation: vi.fn(),
  cancelRepuestoRequest: vi.fn(),
}))

describe("repuestos Server Actions wrapper", () => {
  it("configures permissions and route prefix for direct Server Action reachability", async () => {
    const actions = await import("./actions")

    expect(actions.saveDraftAction).toBeTypeOf("function")
    expect(mockCreateRequestActions).toHaveBeenCalledWith(expect.objectContaining({
      moduleName: "repuestos",
      routePrefix: "/solicitudes",
      permissions: {
        create: "repuestos:create",
        submit: "repuestos:submit",
        approve: "repuestos:approve",
      },
    }))
  })
})
