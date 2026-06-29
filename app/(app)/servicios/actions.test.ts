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

vi.mock("@/lib/services/servicios", () => ({
  persistServiceDraft: vi.fn(),
  addServiceQuotation: vi.fn(),
  deleteServiceQuotation: vi.fn(),
  submitServiceRequest: vi.fn(),
  selectServiceQuotation: vi.fn(),
  cancelServiceRequest: vi.fn(),
}))

describe("servicios Server Actions wrapper", () => {
  it("configures permissions and route prefix for direct Server Action reachability", async () => {
    const actions = await import("./actions")

    expect(actions.saveDraftAction).toBeTypeOf("function")
    expect(mockCreateRequestActions).toHaveBeenCalledWith(expect.objectContaining({
      moduleName: "servicios",
      routePrefix: "/servicios",
      permissions: {
        create: "servicios:create",
        submit: "servicios:submit",
        approve: "servicios:approve",
      },
    }))
  })
})
