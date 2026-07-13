import { describe, expect, it } from "vitest"
import { taePublicSubmissionSchema } from "./fuel-tae"

function submission(overrides: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: "client-submission-123",
    worksiteId: "ws-1",
    loadingPointId: "point-1",
    vehicleId: "vehicle-1",
    productId: "fuel-diesel",
    equipmentCode: "KA-90",
    plate: "AAAA-11",
    loadedAt: "2026-07-12T12:00:00.000Z",
    driverName: "Persona Conductora",
    supervisorName: "Persona Supervisora",
    manualIdentity: true,
    meterType: "odometer",
    meterReading: 1234,
    liters: 80,
    removedSealNumber: "S-1",
    installedSealNumber: "S-2",
    ...overrides,
  }
}

describe("taePublicSubmissionSchema product", () => {
  it("requires a canonical product id", () => {
    expect(taePublicSubmissionSchema.safeParse(submission({ productId: "" })).success).toBe(false)
  })

  it("accepts the selected compatible product as part of the offline payload", () => {
    const result = taePublicSubmissionSchema.safeParse(submission())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.productId).toBe("fuel-diesel")
  })
})
