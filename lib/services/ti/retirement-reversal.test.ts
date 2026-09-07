import { describe, expect, it } from "vitest"
import { retirementReverseBlocker, type RetirementReversalState } from "./constants"

/**
 * Tabla de casos para `retirementReverseBlocker`. Es el test de mayor valor
 * del bloque de reversión de bajas: prueba la regla completa (7 predicados)
 * en milisegundos, sin PGlite.
 */
describe("retirementReverseBlocker", () => {
  const base: RetirementReversalState = {
    reason: "venta",
    reversedAt: null,
    previousStatus: "disponible",
    closedAssignmentId: null,
    assetStatus: "dado_de_baja",
    assetDeletedAt: null,
    hasLaterRetirement: false,
    hasLaterMovement: false,
    hasOpenAssignment: false,
  }

  it("caso feliz: null cuando nada bloquea", () => {
    expect(retirementReverseBlocker(base)).toBeNull()
  })

  it("C0: ya revertida", () => {
    expect(retirementReverseBlocker({ ...base, reversedAt: "2026-09-01T10:00:00Z" }))
      .toMatch(/ya fue revertida/)
  })

  it("C1: activo eliminado lógicamente", () => {
    expect(retirementReverseBlocker({ ...base, assetDeletedAt: "2026-09-01T10:00:00Z" }))
      .toMatch(/eliminado del inventario/)
  })

  it("C2: baja anterior a esta función (sin previousStatus)", () => {
    expect(retirementReverseBlocker({ ...base, previousStatus: null }))
      .toMatch(/anterior a esta función/)
  })

  it("C3: el estado actual del activo ya no coincide con el que dejó la baja", () => {
    expect(retirementReverseBlocker({ ...base, assetStatus: "disponible" }))
      .toMatch(/ya fue sobrescrito/)
  })

  it("C3: pérdida y robo comparan contra su propio estado terminal", () => {
    expect(retirementReverseBlocker({ ...base, reason: "perdida", assetStatus: "perdido" })).toBeNull()
    expect(retirementReverseBlocker({ ...base, reason: "robo", assetStatus: "robado" })).toBeNull()
    expect(retirementReverseBlocker({ ...base, reason: "perdida", assetStatus: "dado_de_baja" }))
      .toMatch(/ya fue sobrescrito/)
  })

  it("C4: existe una baja posterior para el mismo activo", () => {
    expect(retirementReverseBlocker({ ...base, hasLaterRetirement: true }))
      .toMatch(/baja posterior/)
  })

  it("C5: existe un movimiento posterior en la línea de tiempo", () => {
    expect(retirementReverseBlocker({ ...base, hasLaterMovement: true }))
      .toMatch(/movimientos posteriores/)
  })

  it("C6: el activo tiene una asignación abierta ahora mismo", () => {
    expect(retirementReverseBlocker({ ...base, hasOpenAssignment: true }))
      .toMatch(/asignación abierta/)
  })

  it("evalúa los predicados en orden: el primero que bloquea es el mensaje devuelto", () => {
    // reversedAt (C0) y assetDeletedAt (C1) están ambos presentes: C0 gana.
    const blocked = retirementReverseBlocker({
      ...base, reversedAt: "2026-09-01T10:00:00Z", assetDeletedAt: "2026-09-01T10:00:00Z",
    })
    expect(blocked).toMatch(/ya fue revertida/)
  })
})
