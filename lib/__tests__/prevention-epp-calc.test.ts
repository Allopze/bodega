import { describe, expect, it } from "vitest"
import { computeEppCoverageGaps, requirementApplies, type EppDeliveryRow, type EppRequirementRow, type EppWorkerRow } from "@/lib/prevention/epp"

const worker = (over: Partial<EppWorkerRow> = {}): EppWorkerRow => ({
  id: "w1", firstName: "Ana", lastName: "Pérez", position: "operador", worksiteId: "ws-a", isActive: true, ...over,
})

const requirement = (over: Partial<EppRequirementRow> = {}): EppRequirementRow => ({
  id: "req1", eppTypeId: "casco", eppTypeLabel: "Protección de cabeza", scopeType: "global",
  scopeValue: null, worksiteId: null, enforcement: "blocking", reason: "DS 594 art. 53: EPP obligatorio por riesgo de golpe en la cabeza.",
  isActive: true, ...over,
})

describe("alcance del requisito de EPP", () => {
  it("un requisito global aplica a cualquier trabajador", () => {
    expect(requirementApplies(requirement({ scopeType: "global" }), worker())).toBe(true)
  })

  it("un requisito por faena sólo aplica a la faena declarada", () => {
    const req = requirement({ scopeType: "worksite", worksiteId: "ws-a" })
    expect(requirementApplies(req, worker({ worksiteId: "ws-a" }))).toBe(true)
    expect(requirementApplies(req, worker({ worksiteId: "ws-b" }))).toBe(false)
  })

  it("un requisito por cargo compara normalizado", () => {
    const req = requirement({ scopeType: "position", scopeValue: "Operador" })
    expect(requirementApplies(req, worker({ position: "operador" }))).toBe(true)
    expect(requirementApplies(req, worker({ position: "supervisor" }))).toBe(false)
  })

  it("un requisito por tarea nunca aplica por dotación estática", () => {
    expect(requirementApplies(requirement({ scopeType: "task", scopeValue: "izaje" }), worker())).toBe(false)
  })

  it("un requisito inactivo nunca aplica", () => {
    expect(requirementApplies(requirement({ isActive: false }), worker())).toBe(false)
  })
})

describe("cobertura de EPP", () => {
  it("sin ninguna entrega, reporta brecha 'nunca entregado'", () => {
    const gaps = computeEppCoverageGaps({ workers: [worker()], requirements: [requirement()], deliveries: [], asOf: "2026-07-20" })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ workerId: "w1", eppTypeId: "casco", gapType: "missing" })
  })

  it("una entrega vigente sin vencer no genera brecha", () => {
    const deliveries: EppDeliveryRow[] = [{ workerId: "w1", eppTypeId: "casco", deliveredAt: "2026-06-01", lifespanMonths: 12 }]
    expect(computeEppCoverageGaps({ workers: [worker()], requirements: [requirement()], deliveries, asOf: "2026-07-20" })).toEqual([])
  })

  it("una entrega cuya vida útil ya pasó genera brecha 'vencido'", () => {
    const deliveries: EppDeliveryRow[] = [{ workerId: "w1", eppTypeId: "casco", deliveredAt: "2024-01-01", lifespanMonths: 12 }]
    const gaps = computeEppCoverageGaps({ workers: [worker()], requirements: [requirement()], deliveries, asOf: "2026-07-20" })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ gapType: "expired", lastDeliveredAt: "2024-01-01" })
  })

  it("una familia sin vida útil declarada nunca vence, aunque la entrega sea antigua", () => {
    const deliveries: EppDeliveryRow[] = [{ workerId: "w1", eppTypeId: "casco", deliveredAt: "2020-01-01", lifespanMonths: null }]
    expect(computeEppCoverageGaps({ workers: [worker()], requirements: [requirement()], deliveries, asOf: "2026-07-20" })).toEqual([])
  })

  it("usa la entrega más reciente cuando hay varias del mismo tipo", () => {
    const deliveries: EppDeliveryRow[] = [
      { workerId: "w1", eppTypeId: "casco", deliveredAt: "2020-01-01", lifespanMonths: 12 },
      { workerId: "w1", eppTypeId: "casco", deliveredAt: "2026-06-01", lifespanMonths: 12 },
    ]
    expect(computeEppCoverageGaps({ workers: [worker()], requirements: [requirement()], deliveries, asOf: "2026-07-20" })).toEqual([])
  })

  it("un trabajador inactivo no genera brechas", () => {
    expect(computeEppCoverageGaps({ workers: [worker({ isActive: false })], requirements: [requirement()], deliveries: [], asOf: "2026-07-20" })).toEqual([])
  })

  it("un requisito por tarea nunca produce brecha estática, aunque no haya entrega", () => {
    const req = requirement({ scopeType: "task", scopeValue: "izaje" })
    expect(computeEppCoverageGaps({ workers: [worker()], requirements: [req], deliveries: [], asOf: "2026-07-20" })).toEqual([])
  })
})
