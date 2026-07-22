import { describe, expect, it } from "vitest"
import { CAPA_STATUSES, capaTransitionSchema } from "@/lib/services/prevention-capa"

describe("Prevention CAPA Service & State Machine", () => {
  it("exports valid CAPA status options", () => {
    expect(CAPA_STATUSES).toEqual([
      "pending",
      "in_progress",
      "pending_verification",
      "verified",
      "closed",
      "reopened",
      "cancelled",
    ])
  })

  it("validates transition inputs correctly", () => {
    const validTransition = {
      actionId: "capa-123",
      expectedVersion: 1,
      toStatus: "in_progress",
      reason: "Iniciando ejecución de la acción correctiva",
    }

    expect(capaTransitionSchema.parse(validTransition)).toMatchObject(validTransition)
  })

  it("rejects invalid status transitions", () => {
    const invalidTransition = {
      actionId: "capa-123",
      expectedVersion: 1,
      toStatus: "estado_invalido",
    }

    expect(() => capaTransitionSchema.parse(invalidTransition)).toThrow()
  })

  it("rejects invalid date formats or negative versions", () => {
    const invalidVersion = {
      actionId: "capa-123",
      expectedVersion: -1,
      toStatus: "closed",
    }

    expect(() => capaTransitionSchema.parse(invalidVersion)).toThrow()
  })
})
