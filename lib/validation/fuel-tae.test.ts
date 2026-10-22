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
    supplyMediumId: "fsm-tae",
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

describe("taePublicSubmissionSchema campos nuevos", () => {
  it("exige el medio de suministro", () => {
    expect(taePublicSubmissionSchema.safeParse(submission({ supplyMediumId: "" })).success).toBe(false)
  })

  it("no confía en una hora enviada por el cliente: la ignora y deja `offline` en falso", () => {
    const result = taePublicSubmissionSchema.safeParse(submission({ loadedAt: "2020-01-01T00:00:00.000Z" }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty("loadedAt")
      expect(result.data.offline).toBe(false)
      expect(result.data.capturedAt ?? null).toBeNull()
    }
  })

  it("acepta la hora de captura de un envío desde la cola", () => {
    const result = taePublicSubmissionSchema.safeParse(submission({ offline: true, capturedAt: "2026-07-12T12:00:00.000Z" }))
    expect(result.success).toBe(true)
  })

  it("una lectura sobre el tope responde en español, no con el mensaje crudo de zod", () => {
    const result = taePublicSubmissionSchema.safeParse(submission({ meterReading: 1_761_000_000 }))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe("La lectura no puede superar 9.999.999. Revisa que no tenga dígitos de más.")
  })

  it("ya no topa los litros en 2.000: la capacidad del equipo se valida en el servicio", () => {
    expect(taePublicSubmissionSchema.safeParse(submission({ liters: 4500 })).success).toBe(true)
    expect(taePublicSubmissionSchema.safeParse(submission({ liters: 0 })).success).toBe(false)
  })

  it("deja los sellos de relleno y el motivo sin sello al servicio (responde 422, no 400)", () => {
    expect(taePublicSubmissionSchema.safeParse(submission({ removedSealNumber: "777777", installedSealNumber: "" })).success).toBe(true)
  })
})
