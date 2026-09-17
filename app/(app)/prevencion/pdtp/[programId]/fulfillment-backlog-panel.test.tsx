/**
 * `FulfillmentBacklogPanel` es un server component `async` que consulta la
 * base directamente (`countPdtpFulfillmentBacklog`), así que no se monta acá.
 * Lo que se cubre es `shouldOfferPdtpRevision`, la decisión pura que dispara
 * "Crear revisión v+1" cuando el contenido vigente ya no coincide con lo
 * firmado (QA 2026-09-16 P1(b)): tabla de verdad completa sobre sus tres
 * condiciones.
 */

import { describe, expect, it } from "vitest"
import { shouldOfferPdtpRevision } from "./fulfillment-backlog-panel"

const allTrue = { digestDrift: true, programStatus: "active", canManageProgram: true }

describe("shouldOfferPdtpRevision", () => {
  it("ofrece la revisión cuando las tres condiciones se cumplen", () => {
    expect(shouldOfferPdtpRevision(allTrue)).toBe(true)
  })

  it("no ofrece la revisión sin desvío de huella", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, digestDrift: false })).toBe(false)
  })

  it("no ofrece la revisión si el programa no está activo (borrador o en revisión: el editor sigue disponible)", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, programStatus: "draft" })).toBe(false)
    expect(shouldOfferPdtpRevision({ ...allTrue, programStatus: "in_review" })).toBe(false)
  })

  it("no ofrece la revisión a quien no puede gestionar el programa", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, canManageProgram: false })).toBe(false)
  })
})
