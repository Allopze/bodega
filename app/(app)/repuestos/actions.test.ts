import { describe, expect, it, vi } from "vitest"

// ARQ-1: el factory quedó acotado a las 3 acciones de cotización — guardar
// borrador/enviar/cancelar viven en solicitudes/actions-module/, no aquí.
const mockCreateRequestActions = vi.hoisted(() => vi.fn(() => ({
  uploadQuotationAction: vi.fn(),
  deleteQuotationAction: vi.fn(),
  selectQuotationAction: vi.fn(),
})))

vi.mock("@/lib/requests/request-actions", () => ({
  createRequestActions: (config: unknown) =>
    (mockCreateRequestActions as unknown as (config: unknown) => unknown)(config),
}))

vi.mock("@/lib/services/repuestos", () => ({
  addQuotation: vi.fn(),
  deleteQuotation: vi.fn(),
  selectRepuestoQuotation: vi.fn(),
}))

describe("repuestos Server Actions wrapper", () => {
  it("configures permissions and route prefix for direct Server Action reachability", async () => {
    const actions = await import("./actions")

    expect(actions.uploadQuotationAction).toBeTypeOf("function")
    expect(actions.deleteQuotationAction).toBeTypeOf("function")
    expect(actions.selectQuotationAction).toBeTypeOf("function")
    expect(mockCreateRequestActions).toHaveBeenCalledWith(expect.objectContaining({
      routePrefix: "/solicitudes",
      permissions: {
        submit: "repuestos:submit",
        approve: "repuestos:approve",
      },
    }))
  })
})
