import { describe, it, expect } from "vitest"
import {
  assertProposalTransition,
  computeProposalTotals,
  ProposalTransitionError,
  type TransitionContext,
} from "../proposal-rules"
import { periodsToCheck, daysSincePeriodEnd, shiftPeriod } from "../pending"

const ALL_PERMISSIONS = [
  "billing:create_proposal",
  "billing:review_proposal",
  "billing:approve_proposal",
] as const

function context(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    currentStatus: "draft",
    transition: "submit",
    permissions: ALL_PERMISSIONS,
    actorUserId: "preparador",
    submittedBy: null,
    createdBy: "preparador",
    missingDocuments: null,
    ...overrides,
  }
}

describe("máquina de estados de propuestas", () => {
  it("recorre el flujo completo", () => {
    expect(assertProposalTransition(context({ currentStatus: "draft", transition: "submit" }))).toBe("in_review")
    expect(assertProposalTransition(context({
      currentStatus: "in_review", transition: "approve", actorUserId: "aprobador", submittedBy: "preparador",
    }))).toBe("approved")
    expect(assertProposalTransition(context({
      currentStatus: "approved", transition: "mark_ready", actorUserId: "aprobador",
    }))).toBe("ready")
  })

  it("rechaza una transición desde un estado que no la admite", () => {
    expect(() => assertProposalTransition(context({ currentStatus: "draft", transition: "approve" })))
      .toThrow(/No se puede aprobar/i)
    expect(() => assertProposalTransition(context({ currentStatus: "ready", transition: "submit" })))
      .toThrow(ProposalTransitionError)
    // No hay salto de borrador directo a lista para facturar.
    expect(() => assertProposalTransition(context({ currentStatus: "draft", transition: "mark_ready" })))
      .toThrow(ProposalTransitionError)
  })

  it("exige el permiso específico de cada transición", () => {
    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "approve",
      actorUserId: "otro", submittedBy: "preparador",
      permissions: ["billing:create_proposal", "billing:review_proposal"],
    }))).toThrow(/permisos/i)

    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "observe",
      permissions: ["billing:create_proposal"], reason: "Falta el respaldo",
    }))).toThrow(/permisos/i)
  })

  it("impide que quien preparó apruebe su propia propuesta", () => {
    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "approve",
      actorUserId: "preparador", submittedBy: "preparador",
    }))).toThrow(/persona distinta/i)

    // Y tampoco puede rechazarla.
    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "reject",
      actorUserId: "preparador", submittedBy: "preparador", reason: "No corresponde",
    }))).toThrow(/persona distinta/i)

    // Otra persona sí.
    expect(assertProposalTransition(context({
      currentStatus: "in_review", transition: "approve",
      actorUserId: "aprobador", submittedBy: "preparador",
    }))).toBe("approved")
  })

  it("cae al creador cuando nadie la envió a revisión formalmente", () => {
    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "approve",
      actorUserId: "preparador", submittedBy: null, createdBy: "preparador",
    }))).toThrow(/persona distinta/i)
  })

  it("exige motivo para observar o rechazar", () => {
    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "observe", actorUserId: "revisor",
    }))).toThrow(/motivo/i)

    expect(() => assertProposalTransition(context({
      currentStatus: "in_review", transition: "observe", actorUserId: "revisor", reason: "   ",
    }))).toThrow(/motivo/i)

    expect(assertProposalTransition(context({
      currentStatus: "in_review", transition: "observe", actorUserId: "revisor",
      reason: "Falta el acta de recepción del cliente",
    }))).toBe("observed")
  })

  it("no permite marcar lista una propuesta con documentos faltantes", () => {
    expect(() => assertProposalTransition(context({
      currentStatus: "approved", transition: "mark_ready",
      actorUserId: "aprobador", missingDocuments: "Falta el HES del cliente",
    }))).toThrow(/documentos faltantes/i)
  })

  it("permite reabrir una observada o rechazada, no una aprobada", () => {
    expect(assertProposalTransition(context({ currentStatus: "observed", transition: "reopen" }))).toBe("draft")
    expect(assertProposalTransition(context({ currentStatus: "rejected", transition: "reopen" }))).toBe("draft")
    expect(() => assertProposalTransition(context({ currentStatus: "approved", transition: "reopen" })))
      .toThrow(ProposalTransitionError)
  })

  it("no permite anular una propuesta ya relacionada con factura", () => {
    expect(() => assertProposalTransition(context({ currentStatus: "invoiced", transition: "cancel" })))
      .toThrow(ProposalTransitionError)
  })
})

describe("computeProposalTotals", () => {
  it("calcula neto, IVA y total con aritmética exacta", () => {
    const totals = computeProposalTotals([
      { description: "Aseo industrial", quantity: 1, unitPrice: 4200000 },
    ])
    expect(totals.net).toBe(4200000)
    expect(totals.tax).toBe(798000)
    expect(totals.total).toBe(4998000)
    expect(totals.exempt).toBe(0)
  })

  it("suma varias líneas sin deriva de punto flotante", () => {
    const totals = computeProposalTotals([
      { description: "A", quantity: 3, unitPrice: 0.1 },
      { description: "B", quantity: 1, unitPrice: 0.2 },
    ])
    expect(totals.net).toBe(0.5)
  })

  it("no aplica IVA sobre los ítems exentos", () => {
    const totals = computeProposalTotals([
      { description: "Servicio afecto", quantity: 1, unitPrice: 1000000 },
      { description: "Traslado exento", quantity: 1, unitPrice: 150000, isExempt: true },
    ])
    expect(totals.exempt).toBe(150000)
    expect(totals.tax).toBe(190000)                 // 19 % solo sobre 1.000.000
    expect(totals.net).toBe(1150000)
    expect(totals.total).toBe(1340000)
  })

  it("multiplica cantidad por precio unitario", () => {
    const totals = computeProposalTotals([
      { description: "Horas hombre", quantity: 176, unitPrice: 12500 },
    ])
    expect(totals.net).toBe(2200000)
  })

  it("una propuesta sin ítems da todo en cero, no NaN", () => {
    expect(computeProposalTotals([])).toEqual({ net: 0, tax: 0, total: 0, exempt: 0 })
  })
})

describe("detección de períodos pendientes", () => {
  it("no incluye el mes en curso: un contrato mensual se cobra cuando el mes cerró", () => {
    const periods = periodsToCheck("2026-01-01", null, "2026-08")
    expect(periods).not.toContain("2026-08")
    expect(periods.at(-1)).toBe("2026-07")
  })

  it("arranca en el inicio del contrato, no antes", () => {
    const periods = periodsToCheck("2026-05-15", null, "2026-08")
    expect(periods).toEqual(["2026-05", "2026-06", "2026-07"])
  })

  it("no pasa del término del contrato", () => {
    const periods = periodsToCheck("2026-01-01", "2026-06-30", "2026-08")
    expect(periods.at(-1)).toBe("2026-06")
  })

  it("acota la ventana hacia atrás para no revisar años enteros", () => {
    const periods = periodsToCheck("2020-01-01", null, "2026-08")
    expect(periods.length).toBeLessThanOrEqual(7)
    expect(periods[0]).toBe("2026-02")
  })

  it("devuelve vacío si el contrato empieza después del último mes cerrado", () => {
    expect(periodsToCheck("2026-09-01", null, "2026-08")).toEqual([])
  })

  it("cruza el cambio de año", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12")
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01")
    expect(periodsToCheck("2025-11-01", null, "2026-01")).toEqual(["2025-11", "2025-12"])
  })

  it("mide la antigüedad desde que el período cerró", () => {
    expect(daysSincePeriodEnd("2026-07", "2026-08-05")).toBe(5)
    expect(daysSincePeriodEnd("2026-06", "2026-08-05")).toBe(36)
    // Un período que aún no cierra da negativo.
    expect(daysSincePeriodEnd("2026-08", "2026-08-05")).toBeLessThan(0)
  })
})
