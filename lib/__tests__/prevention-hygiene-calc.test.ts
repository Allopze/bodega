import { describe, expect, it } from "vitest"
import {
  assessMeasurement,
  deriveSurveillanceObligation,
  nextSurveillanceDate,
  summarizeExposureAnonymized,
  MIN_ANONYMOUS_GROUP_SIZE,
} from "@/lib/prevention/hygiene"
import { exposureMeasurementSchema } from "@/lib/validation/prevention-module/hygiene"
import { todayInChile } from "@/lib/utils"

const agent = { permissibleLimit: 100, actionLevelFactor: 0.5 }

describe("comparación de una medición contra el límite", () => {
  it("bajo el nivel de acción no obliga a vigilancia", () => {
    const result = assessMeasurement(40, agent)
    expect(result).toMatchObject({ outcome: "below_action", actionLevel: 50, triggersSurveillance: false })
  })

  it("alcanzar el nivel de acción ya obliga a vigilancia", () => {
    // Se entra a vigilancia en el nivel de acción, no al superar el límite.
    expect(assessMeasurement(50, agent)).toMatchObject({ outcome: "above_action", triggersSurveillance: true })
  })

  it("sobre el límite permisible obliga a vigilancia", () => {
    expect(assessMeasurement(120, agent)).toMatchObject({ outcome: "above_limit", triggersSurveillance: true })
  })

  it("un agente sin límite declarado no se reporta como conforme", () => {
    const result = assessMeasurement(999, { permissibleLimit: null, actionLevelFactor: 0.5 })
    expect(result.outcome).toBe("not_comparable")
    expect(result.outcome).not.toBe("below_action")
    expect(result.actionLevel).toBeNull()
  })

  it("respeta un factor de nivel de acción distinto", () => {
    const result = assessMeasurement(25, { permissibleLimit: 100, actionLevelFactor: 0.2 })
    expect(result).toMatchObject({ outcome: "above_action", actionLevel: 20 })
  })

  it("un valor cero está bajo el nivel de acción", () => {
    expect(assessMeasurement(0, agent).outcome).toBe("below_action")
  })
})

describe("obligación de vigilancia del grupo", () => {
  it("sin mediciones no hay obligación", () => {
    expect(deriveSurveillanceObligation([])).toMatchObject({ required: false })
  })

  it("la última medición sobre el límite obliga", () => {
    const result = deriveSurveillanceObligation([
      { measuredOn: "2026-01-10", outcome: "below_action" },
      { measuredOn: "2026-06-10", outcome: "above_limit" },
    ])
    expect(result.required).toBe(true)
    expect(result.basis).toContain("2026-06-10")
  })

  it("manda la medición más reciente aunque no sea la última en la lista", () => {
    const result = deriveSurveillanceObligation([
      { measuredOn: "2026-06-10", outcome: "above_limit" },
      { measuredOn: "2026-01-10", outcome: "below_action" },
    ])
    expect(result.required).toBe(true)
  })

  it("una campaña posterior bajo el nivel de acción libera, pero deja constancia de la excedencia previa", () => {
    const result = deriveSurveillanceObligation([
      { measuredOn: "2026-01-10", outcome: "above_limit" },
      { measuredOn: "2026-06-10", outcome: "below_action" },
    ])
    expect(result.required).toBe(false)
    expect(result.basis).toContain("excedencias previas")
  })

  it("sin excedencias previas el fundamento no las menciona", () => {
    const result = deriveSurveillanceObligation([{ measuredOn: "2026-06-10", outcome: "below_action" }])
    expect(result.required).toBe(false)
    expect(result.basis).not.toContain("excedencias previas")
  })

  it("una medición no comparable mantiene la vigilancia si hubo excedencias antes", () => {
    expect(deriveSurveillanceObligation([
      { measuredOn: "2026-01-10", outcome: "above_action" },
      { measuredOn: "2026-06-10", outcome: "not_comparable" },
    ]).required).toBe(true)
    expect(deriveSurveillanceObligation([
      { measuredOn: "2026-06-10", outcome: "not_comparable" },
    ]).required).toBe(false)
  })
})

describe("periodicidad", () => {
  it("calcula la próxima fecha según la periodicidad", () => {
    expect(nextSurveillanceDate("2026-07-19", 12)).toBe("2027-07-19")
    expect(nextSurveillanceDate("2026-07-19", 6)).toBe("2027-01-19")
  })

  it("conserva el último día válido del mes destino", () => {
    expect(nextSurveillanceDate("2026-01-31", 1)).toBe("2026-02-28")
  })
})

describe("agregación anonimizada", () => {
  const group = (over: Partial<Parameters<typeof summarizeExposureAnonymized>[0][number]> = {}) => ({
    groupId: "g1",
    groupName: "Operadores línea de clasificación",
    agentName: "Sílice",
    exposedCount: 10,
    attendedCount: 8,
    latestOutcome: "above_action",
    ...over,
  })

  it("publica la tasa de asistencia de un grupo suficientemente grande", () => {
    const [summary] = summarizeExposureAnonymized([group()])
    expect(summary).toMatchObject({ attendanceRate: 80, suppressed: false })
  })

  // En un grupo de dos, "50 % asistió" identifica a una persona concreta y su
  // vínculo con un programa de vigilancia, que es dato de salud.
  it("suprime la tasa en grupos demasiado pequeños para no reidentificar", () => {
    const [summary] = summarizeExposureAnonymized([group({ exposedCount: 2, attendedCount: 1 })])
    expect(summary).toMatchObject({ attendanceRate: null, suppressed: true })
  })

  it("el umbral de supresión es el declarado", () => {
    const below = summarizeExposureAnonymized([group({ exposedCount: MIN_ANONYMOUS_GROUP_SIZE - 1, attendedCount: 1 })])
    const at = summarizeExposureAnonymized([group({ exposedCount: MIN_ANONYMOUS_GROUP_SIZE, attendedCount: 1 })])
    expect(below[0]?.suppressed).toBe(true)
    expect(at[0]?.suppressed).toBe(false)
  })

  it("conserva el conteo de expuestos y el resultado del agente aunque suprima la tasa", () => {
    const [summary] = summarizeExposureAnonymized([group({ exposedCount: 3, attendedCount: 2 })])
    expect(summary).toMatchObject({ exposedCount: 3, latestOutcome: "above_action", attendanceRate: null })
  })

  it("un grupo sin expuestos no divide por cero", () => {
    const [summary] = summarizeExposureAnonymized([group({ exposedCount: 0, attendedCount: 0 })])
    expect(summary?.attendanceRate).toBeNull()
  })
})

describe("validación de entrada de una medición de exposición", () => {
  const base = {
    groupId: "grp-1",
    measuredOn: "2026-07-19",
    value: 50,
    method: "Muestreo de aire personal",
    equipmentTag: "BOMBA-01",
    evidencePath: "storage/hygiene-evidence/informe.pdf",
  }

  it("acepta una medición sin fecha de calibración declarada", () => {
    expect(() => exposureMeasurementSchema.parse(base)).not.toThrow()
  })

  /* El folio del laboratorio no reemplaza al informe: es un número escrito a
   * mano, y con eso se acreditaba la N°45. */
  it("no acepta una medición sin el informe de laboratorio", () => {
    const { evidencePath: _omitido, ...sinInforme } = base
    expect(() => exposureMeasurementSchema.parse(sinInforme)).toThrow()
    expect(() => exposureMeasurementSchema.parse({ ...sinInforme, reportReference: "Folio 12345" })).toThrow()
  })

  it("acepta la fecha de calibración de hoy en hora de Chile", () => {
    expect(() => exposureMeasurementSchema.parse({ ...base, calibrationDate: todayInChile() })).not.toThrow()
  })

  it("rechaza una calibración con fecha futura", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    expect(() => exposureMeasurementSchema.parse({ ...base, calibrationDate: future }))
      .toThrow(/no puede estar en el futuro/i)
  })
})
