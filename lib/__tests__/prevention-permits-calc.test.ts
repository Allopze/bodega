import { describe, expect, it } from "vitest"
import {
  assessPermitActivation,
  isPermitExpired,
  plannedDurationHours,
  PERMIT_TRANSITIONS,
  type PermitControlRow,
  type PermitCrewRow,
  type PermitIsolationRow,
  type PermitMeasurementRow,
  type PermitTypeSpec,
} from "@/lib/prevention/permits"

const NOW = "2026-07-19T12:00:00.000Z"

const type = (over: Partial<PermitTypeSpec> = {}): PermitTypeSpec => ({
  requiresIsolation: false,
  requiresMeasurement: false,
  requiresJsa: true,
  measurementValidityMinutes: null,
  maxDurationHours: 12,
  ...over,
})

const control = (over: Partial<PermitControlRow> = {}): PermitControlRow => ({
  id: "c-1",
  description: "Delimitación del área y señalización",
  isMandatory: true,
  verified: true,
  notApplicableReason: null,
  ...over,
})

const crew = (over: Partial<PermitCrewRow> = {}): PermitCrewRow => ({
  id: "cr-1",
  workerId: "w-1",
  label: "Pérez, Ana",
  ...over,
})

const isolation = (over: Partial<PermitIsolationRow> = {}): PermitIsolationRow => ({
  id: "i-1",
  equipmentTag: "MOT-101",
  appliedAt: "2026-07-19T11:00:00.000Z",
  verifiedZeroEnergy: true,
  removedAt: null,
  ...over,
})

const measurement = (over: Partial<PermitMeasurementRow> = {}): PermitMeasurementRow => ({
  parameter: "O2",
  withinRange: true,
  takenAt: "2026-07-19T11:50:00.000Z",
  ...over,
})

function assess(over: Partial<Parameters<typeof assessPermitActivation>[0]> = {}) {
  return assessPermitActivation({
    type: type(),
    controls: [control()],
    isolations: [],
    measurements: [],
    jsaStepCount: 3,
    crew: [crew()],
    crewWithoutCompetency: [],
    plannedEndAt: "2026-07-19T18:00:00.000Z",
    now: NOW,
    ...over,
  })
}

describe("habilitación de un permiso de trabajo", () => {
  it("habilita cuando todo está cumplido", () => {
    expect(assess()).toEqual({ allowed: true, blockers: [] })
  })

  it("bloquea si un control obligatorio no está verificado", () => {
    const result = assess({ controls: [control({ verified: false })] })
    expect(result.allowed).toBe(false)
    expect(result.blockers[0]?.kind).toBe("control_pending")
  })

  it("acepta un control obligatorio declarado no aplicable con motivo", () => {
    expect(assess({ controls: [control({ verified: false, notApplicableReason: "No hay energía eléctrica en el sector." })] }).allowed).toBe(true)
  })

  it("un control no obligatorio sin verificar no bloquea", () => {
    expect(assess({ controls: [control({ isMandatory: false, verified: false })] }).allowed).toBe(true)
  })

  it("reporta todos los bloqueadores a la vez, no sólo el primero", () => {
    const result = assess({
      controls: [control({ verified: false }), control({ id: "c-2", description: "Extintor disponible", verified: false })],
      jsaStepCount: 0,
      crew: [],
    })
    expect(result.blockers.length).toBeGreaterThanOrEqual(4)
    expect(new Set(result.blockers.map((b) => b.kind))).toEqual(new Set(["control_pending", "jsa_missing", "crew_empty"]))
  })

  it("exige AST cuando el tipo lo requiere", () => {
    expect(assess({ jsaStepCount: 0 }).blockers.some((b) => b.kind === "jsa_missing")).toBe(true)
    expect(assess({ type: type({ requiresJsa: false }), jsaStepCount: 0 }).allowed).toBe(true)
  })
})

describe("aislamiento de energías (LOTO)", () => {
  const isolationType = type({ requiresIsolation: true })

  it("bloquea si el tipo exige aislamiento y no hay ninguno", () => {
    expect(assess({ type: isolationType, isolations: [] }).blockers.some((b) => b.kind === "isolation_missing")).toBe(true)
  })

  it("bloquea un aislamiento registrado pero no aplicado", () => {
    const result = assess({ type: isolationType, isolations: [isolation({ appliedAt: null })] })
    expect(result.blockers.some((b) => b.kind === "isolation_missing")).toBe(true)
  })

  it("bloquea si no se verificó energía cero", () => {
    const result = assess({ type: isolationType, isolations: [isolation({ verifiedZeroEnergy: false })] })
    expect(result.blockers.some((b) => b.kind === "isolation_not_verified")).toBe(true)
  })

  it("un aislamiento ya retirado no cuenta como vigente", () => {
    const result = assess({ type: isolationType, isolations: [isolation({ removedAt: "2026-07-19T11:30:00.000Z" })] })
    expect(result.blockers.some((b) => b.kind === "isolation_missing")).toBe(true)
  })

  it("habilita con aislamiento aplicado y verificado", () => {
    expect(assess({ type: isolationType, isolations: [isolation()] }).allowed).toBe(true)
  })
})

describe("mediciones de atmósfera", () => {
  const measured = type({ requiresMeasurement: true, measurementValidityMinutes: 30 })

  it("bloquea si el tipo exige medición y no hay ninguna", () => {
    expect(assess({ type: measured, measurements: [] }).blockers.some((b) => b.kind === "measurement_missing")).toBe(true)
  })

  it("bloquea una medición fuera de rango", () => {
    const result = assess({ type: measured, measurements: [measurement({ withinRange: false })] })
    expect(result.blockers.some((b) => b.kind === "measurement_out_of_range")).toBe(true)
  })

  it("bloquea una medición vencida aunque esté dentro de rango", () => {
    const result = assess({ type: measured, measurements: [measurement({ takenAt: "2026-07-19T10:00:00.000Z" })] })
    expect(result.blockers.some((b) => b.kind === "measurement_stale")).toBe(true)
  })

  it("una relectura reciente dentro de rango reemplaza a una anterior fuera de rango", () => {
    const result = assess({
      type: measured,
      measurements: [
        measurement({ withinRange: false, takenAt: "2026-07-19T11:00:00.000Z" }),
        measurement({ withinRange: true, takenAt: "2026-07-19T11:55:00.000Z" }),
      ],
    })
    expect(result.allowed).toBe(true)
  })

  it("una lectura antigua dentro de rango no revive por una nueva fuera de rango", () => {
    const result = assess({
      type: measured,
      measurements: [
        measurement({ withinRange: true, takenAt: "2026-07-19T11:55:00.000Z" }),
        measurement({ withinRange: false, takenAt: "2026-07-19T11:58:00.000Z" }),
      ],
    })
    expect(result.blockers.some((b) => b.kind === "measurement_out_of_range")).toBe(true)
  })

  it("evalúa cada parámetro por separado", () => {
    const result = assess({
      type: measured,
      measurements: [measurement({ parameter: "O2" }), measurement({ parameter: "H2S", withinRange: false })],
    })
    expect(result.blockers.filter((b) => b.kind === "measurement_out_of_range")).toHaveLength(1)
  })
})

describe("habilitación de la cuadrilla", () => {
  it("bloquea si alguien no tiene la competencia exigida", () => {
    const member = crew({ label: "Soto, Bruno" })
    const result = assess({ crew: [crew(), member], crewWithoutCompetency: [member] })
    expect(result.allowed).toBe(false)
    expect(result.blockers[0]?.detail).toContain("Soto, Bruno")
  })
})

describe("vigencia del permiso", () => {
  it("bloquea la activación si la ventana ya venció", () => {
    const result = assess({ plannedEndAt: "2026-07-19T09:00:00.000Z" })
    expect(result.blockers.some((b) => b.kind === "window_expired")).toBe(true)
  })

  it("un permiso vigente con ventana vencida se considera expirado", () => {
    expect(isPermitExpired({ status: "active", plannedEndAt: "2026-07-19T09:00:00.000Z", extendedUntilAt: null }, NOW)).toBe(true)
  })

  it("una extensión vigente mantiene habilitado el permiso", () => {
    expect(isPermitExpired({ status: "active", plannedEndAt: "2026-07-19T09:00:00.000Z", extendedUntilAt: "2026-07-19T20:00:00.000Z" }, NOW)).toBe(false)
  })

  it("un permiso cerrado no se evalúa por vigencia", () => {
    expect(isPermitExpired({ status: "closed", plannedEndAt: "2026-07-19T09:00:00.000Z", extendedUntilAt: null }, NOW)).toBe(false)
  })

  it("calcula la duración planificada en horas", () => {
    expect(plannedDurationHours("2026-07-19T08:00:00.000Z", "2026-07-19T20:00:00.000Z")).toBe(12)
  })
})

describe("máquina de estados", () => {
  it("no permite saltar de borrador a vigente", () => {
    expect(PERMIT_TRANSITIONS.draft).not.toContain("active")
  })

  it("un permiso cerrado, rechazado o cancelado es terminal", () => {
    expect(PERMIT_TRANSITIONS.closed).toEqual([])
    expect(PERMIT_TRANSITIONS.rejected).toEqual([])
    expect(PERMIT_TRANSITIONS.cancelled).toEqual([])
  })

  it("un permiso suspendido puede reanudarse o cerrarse", () => {
    expect(PERMIT_TRANSITIONS.suspended).toEqual(expect.arrayContaining(["active", "closed"]))
  })
})
