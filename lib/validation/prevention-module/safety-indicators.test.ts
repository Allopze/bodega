import { describe, expect, it } from "vitest"
import { safetyIndicatorDenominatorSchema } from "./safety-indicators"

const BASE = {
  worksiteId: "ws-1",
  year: 2026,
  month: 1,
  workerCount: 120,
  workedHours: 19_200,
  sourceType: "rrhh",
  sourceReference: "Nómina RR.HH. enero 2026",
  evidenceReference: "Folio 4471",
  evidenceChecksumSha256: null,
  reconciliationStatus: "matched",
  reconciliationNotes: null,
  submitForReview: false,
  expectedVersion: null,
  correctionReason: null,
}

function fieldErrors(input: Record<string, unknown>) {
  const result = safetyIndicatorDenominatorSchema.safeParse(input)
  return result.success ? null : result.error.flatten().fieldErrors
}

describe("safetyIndicatorDenominatorSchema — notas de conciliación", () => {
  /**
   * `pending` es el valor POR DEFECTO del formulario, así que el estado inicial
   * de la pantalla caía en esta rama y el mensaje describía una diferencia o
   * excepción que no existían.
   */
  it("explica la nota faltante según el estado, no con un texto único", () => {
    expect(fieldErrors({ ...BASE, reconciliationStatus: "pending" })?.reconciliationNotes)
      .toEqual(["Explica por qué la conciliación sigue pendiente."])
    expect(fieldErrors({ ...BASE, reconciliationStatus: "difference" })?.reconciliationNotes)
      .toEqual(["Documenta la diferencia encontrada."])
    expect(fieldErrors({ ...BASE, reconciliationStatus: "exception" })?.reconciliationNotes)
      .toEqual(["Documenta la excepción aceptada."])
  })

  it("no exige nota cuando la conciliación cuadra", () => {
    expect(fieldErrors(BASE)).toBeNull()
  })

  it("pide el mínimo de la nota en español", () => {
    expect(fieldErrors({ ...BASE, reconciliationStatus: "difference", reconciliationNotes: "abcd" })?.reconciliationNotes)
      .toEqual(["Usa al menos 5 caracteres."])
  })
})

describe("safetyIndicatorDenominatorSchema — envío a revisión", () => {
  /**
   * `approveSafetyIndicatorDenominator` rechaza aprobar con la conciliación en
   * `pending`. Permitir el envío dejaba el registro en un callejón sin salida:
   * el aprobador no podía aprobarlo ni editarlo.
   */
  it("no deja enviar a revisión con la conciliación pendiente", () => {
    const errors = fieldErrors({
      ...BASE,
      reconciliationStatus: "pending",
      reconciliationNotes: "Aún sin cuadrar con la nómina",
      submitForReview: true,
    })
    expect(errors?.reconciliationStatus?.[0]).toMatch(/Resuelve la conciliación antes de enviar a revisión/)
  })

  it("deja enviar a revisión con la conciliación resuelta", () => {
    expect(fieldErrors({ ...BASE, submitForReview: true })).toBeNull()
    expect(fieldErrors({
      ...BASE,
      reconciliationStatus: "exception",
      reconciliationNotes: "Excepción autorizada por gerencia",
      submitForReview: true,
    })).toBeNull()
  })
})

describe("safetyIndicatorDenominatorSchema — SHA-256 de evidencia", () => {
  /** `certutil -hashfile <archivo> SHA256` en Windows devuelve MAYÚSCULAS. */
  it("acepta el hash en mayúsculas y lo normaliza a minúsculas", () => {
    const result = safetyIndicatorDenominatorSchema.safeParse({ ...BASE, evidenceChecksumSha256: "A1B2".repeat(16) })
    expect(result.success).toBe(true)
    expect(result.success && result.data.evidenceChecksumSha256).toBe("a1b2".repeat(16))
  })

  it("tolera espacios alrededor", () => {
    const result = safetyIndicatorDenominatorSchema.safeParse({ ...BASE, evidenceChecksumSha256: `  ${"f".repeat(64)}\n` })
    expect(result.success && result.data.evidenceChecksumSha256).toBe("f".repeat(64))
  })

  it("sigue siendo opcional", () => {
    expect(fieldErrors({ ...BASE, evidenceChecksumSha256: null })).toBeNull()
  })

  it("rechaza lo que no es un SHA-256, en español", () => {
    expect(fieldErrors({ ...BASE, evidenceChecksumSha256: "abc" })?.evidenceChecksumSha256)
      .toEqual(["Un SHA-256 son 64 caracteres hexadecimales."])
    expect(fieldErrors({ ...BASE, evidenceChecksumSha256: "z".repeat(64) })?.evidenceChecksumSha256)
      .toEqual(["Un SHA-256 son 64 caracteres hexadecimales."])
  })
})

describe("safetyIndicatorDenominatorSchema — cero", () => {
  /**
   * Cero NO se bloquea acá a propósito: un mes sin operación es un dato
   * legítimo y el guardarraíl vive en el cierre del período, que rechaza
   * numeradores de frecuencia/gravedad sin horas. Lo que se arregló es que el
   * formulario ya no lo ofrece prellenado.
   */
  it("acepta dotación y horas en cero", () => {
    expect(fieldErrors({ ...BASE, workerCount: 0, workedHours: 0 })).toBeNull()
  })

  it("rechaza valores negativos en español", () => {
    expect(fieldErrors({ ...BASE, workerCount: -1 })?.workerCount).toEqual(["La dotación no puede ser negativa."])
    expect(fieldErrors({ ...BASE, workedHours: -0.5 })?.workedHours).toEqual(["Las horas no pueden ser negativas."])
  })
})
