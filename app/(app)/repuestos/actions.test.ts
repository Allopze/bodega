import { describe, expect, it, vi } from "vitest"

// ARQ-1: el factory quedó acotado a las 3 acciones de cotización — guardar
// borrador/enviar/cancelar viven en solicitudes/actions-module/, no aquí.
const mockCreateRequestActions = vi.hoisted(() => vi.fn(() => ({
  uploadQuotationAction: vi.fn(),
  deleteQuotationAction: vi.fn(),
  selectQuotationAction: vi.fn(),
  approveWithoutQuotationAction: vi.fn(),
})))

vi.mock("@/lib/requests/request-actions", () => ({
  createRequestActions: (config: unknown) =>
    (mockCreateRequestActions as unknown as (config: unknown) => unknown)(config),
}))

vi.mock("@/lib/services/repuestos", () => ({
  addQuotation: vi.fn(),
  deleteQuotation: vi.fn(),
  selectRepuestoQuotation: vi.fn(),
  approveRepuestoWithoutQuotation: vi.fn(),
}))

describe("repuestos Server Actions wrapper", () => {
  it("configures permissions and route prefix for direct Server Action reachability", async () => {
    const actions = await import("./actions")

    expect(actions.uploadQuotationAction).toBeTypeOf("function")
    expect(actions.deleteQuotationAction).toBeTypeOf("function")
    expect(actions.selectQuotationAction).toBeTypeOf("function")
    expect(actions.approveWithoutQuotationAction).toBeTypeOf("function")
    expect(mockCreateRequestActions).toHaveBeenCalledWith(expect.objectContaining({
      routePrefix: "/solicitudes",
      permissions: {
        submit: "repuestos:submit",
        approve: "repuestos:approve",
      },
    }))
  })

  it("cablea la aprobación sin cotización con su servicio y su esquema", async () => {
    await import("./actions")
    const { approveRepuestoWithoutQuotation } = await import("@/lib/services/repuestos")
    const config = (mockCreateRequestActions.mock.calls as unknown as unknown[][]).at(-1)![0] as {
      services: { approveWithoutQuotation: unknown }
      schemas: { approveWithoutQuotation: { safeParse: (value: unknown) => { success: boolean; data?: unknown } } }
    }

    expect(config.services.approveWithoutQuotation).toBe(approveRepuestoWithoutQuotation)
    expect(config.schemas.approveWithoutQuotation.safeParse({ requestId: "req-1", justification: "  Bajo costo  " }))
      .toEqual({ success: true, data: { requestId: "req-1", justification: "Bajo costo" } })
    expect(config.schemas.approveWithoutQuotation.safeParse({ requestId: "req-1", justification: "" }).success).toBe(true)
    expect(config.schemas.approveWithoutQuotation.safeParse({ requestId: "req-1" }).success).toBe(true)
    expect(config.schemas.approveWithoutQuotation.safeParse({ requestId: "" }).success).toBe(false)
    expect(config.schemas.approveWithoutQuotation.safeParse({ requestId: "req-1", justification: "x".repeat(1001) }).success).toBe(false)
  })
})
