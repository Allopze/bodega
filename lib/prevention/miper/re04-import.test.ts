import { describe, expect, it } from "vitest"
import { controlledStatusOf, parseRe04Matrix, riskImportStatus, type Re04CellMatrix } from "./re04-import"

/**
 * Fila del RE-04 del formato real. Los datos empiezan en la fila 14: las 12-13
 * son el encabezado de la hoja, y `startRow` es la fila del Excel de `rows[0]`.
 */
type RowInput = {
  number?: number
  activity?: string
  task?: string
  position?: string
  location?: string
  female?: number
  male?: number
  other?: number
  factor?: string
  routine?: string
  hazard?: string
  risk?: string
  damage?: string
  probability?: unknown
  consequence?: unknown
  mr?: unknown
  classification?: string
  measures?: string
  controlled?: string
  responsible?: string
  deadlines?: string
}

function sheetRow(input: RowInput): unknown[] {
  return [
    input.number ?? null, input.activity ?? null, input.task ?? null, input.position ?? null, input.location ?? null,
    input.female ?? null, input.male ?? null, input.other ?? null,
    input.factor ?? null, input.routine ?? null, input.hazard ?? null, input.risk ?? null, input.damage ?? null,
    input.probability ?? null, input.consequence ?? null, input.mr ?? null, input.classification ?? null,
    input.measures ?? null, input.controlled ?? null, input.responsible ?? null, input.deadlines ?? null,
  ]
}

function parse(rows: unknown[][], knownFactors: string[] = []) {
  const matrix: Re04CellMatrix = { startRow: 14, rows }
  return parseRe04Matrix(matrix, { knownFactors: new Set(knownFactors) }).rows
}

describe("parser puro del RE-04 IPER", () => {
  it("mapea los textos del formato real y salta las filas sin valores", () => {
    const rows = parse([
      sheetRow({ activity: "Transporte", factor: "Mecánico", hazard: "Camión", probability: 4, consequence: 4, controlled: "SÍ, CONTROLADO" }),
      sheetRow({ controlled: "PARCIALMENTE CONTROLADO" }),
      sheetRow({ controlled: "NO CONTROLADO" }),
      // Sin ningún valor no es un riesgo: no llega a la vista previa.
      sheetRow({}),
      sheetRow({ routine: "NO RUTINARIA" }),
      sheetRow({ routine: "RUTINARIA" }),
    ], ["Mecánico"])

    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.normalized.controlledStatus)).toEqual(["yes", "partial", "no", "no", "no"])
    expect(rows[3]!.normalized.isRoutine).toBe(false)
    expect(rows[4]!.normalized.isRoutine).toBe(true)
    expect(rows[0]!.rowNumber).toBe(14)
    // La fila vacía (17) no corre los números de las siguientes: son los del Excel.
    expect(rows[3]!.rowNumber).toBe(18)
    expect(rows[4]!.rowNumber).toBe(19)
  })

  it("RUTINARIA / NO RUTINARIA también abreviadas «R» y «NR», como las escribe el RE-04 de Cholguán", () => {
    const rows = parse([
      sheetRow({ hazard: "Ruido", routine: "R", probability: 1, consequence: 1 }),
      sheetRow({ hazard: "Polvo", routine: " nr ", probability: 1, consequence: 1 }),
      sheetRow({ hazard: "Calor", routine: "No rutinaria", probability: 1, consequence: 1 }),
      sheetRow({ hazard: "Frío", routine: "RUTINARIA", probability: 1, consequence: 1 }),
      sheetRow({ hazard: "Lluvia", routine: "RN", probability: 1, consequence: 1 }),
    ])
    expect(rows.map((row) => row.normalized.isRoutine)).toEqual([true, false, false, true, null])
  })

  it("«¿Está controlado?» se reconoce por prefijo: la cola del RE-04 real no lo vuelve «No»", () => {
    const rows = parse([
      sheetRow({ controlled: "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA" }),
      sheetRow({ controlled: "SÍ, CONTROLADO (VERIFICADO EN TERRENO)" }),
      sheetRow({ controlled: "NO CONTROLADO - SIN MEDIDAS" }),
      // «SIN …» empieza con «si» pero no es «Sí»: el prefijo es por palabras.
      sheetRow({ controlled: "SIN INFORMACIÓN" }),
    ])
    expect(rows.map((row) => row.normalized.controlledStatus)).toEqual(["partial", "yes", "no", "no"])
  })

  it("«¿Está controlado?» que dice «PARCIAL» en cualquier parte es parcial, antes de probar el prefijo «SÍ»", () => {
    expect(controlledStatusOf("SÍ, PARCIALMENTE CONTROLADO")).toBe("partial")
    expect(controlledStatusOf("CONTROLADO PARCIALMENTE")).toBe("partial")
    expect(controlledStatusOf("Sí, parcial")).toBe("partial")
    // Los rótulos exactos del formato no cambian.
    expect(["SÍ, CONTROLADO", "PARCIALMENTE CONTROLADO", "NO CONTROLADO", "SÍ", "NO", "CONTROLADO", "PARCIAL", "", null].map(controlledStatusOf))
      .toEqual(["yes", "partial", "no", "yes", "no", "yes", "partial", "no", "no"])
  })

  it("P y C fuera de {1, 2, 4} detienen la fila; el cálculo manda sobre el Excel", () => {
    const rows = parse([
      // El Excel trae MR 8, la plataforma calcula 16: se informa y manda el cálculo.
      sheetRow({ probability: 4, consequence: 4, mr: 8, classification: "INTOLERABLE" }),
      sheetRow({ probability: 3, consequence: 4, mr: 12, classification: "IMPORTANTE" }),
      sheetRow({ probability: "N/A", consequence: null }),
      // Clasificación del Excel que no coincide con P × C (2 × 4 = 8 → Importante).
      sheetRow({ probability: 2, consequence: 4, mr: 8, classification: "MODERADO" }),
    ])

    expect(rows[0]!.issues).toContainEqual(expect.objectContaining({ code: "mr_mismatch", excel: 8, calculated: 16 }))
    expect(rows[0]!.normalized.magnitude).toBe(16)
    expect(rows[0]!.normalized.classification).toBe("intolerable")
    expect(riskImportStatus(rows[0]!.issues)).toBe("ready")

    expect(rows[1]!.issues).toContainEqual(expect.objectContaining({ code: "p_out_of_scale", excel: 3 }))
    expect(riskImportStatus(rows[1]!.issues)).toBe("rejected")
    expect(rows[1]!.normalized.magnitude).toBeNull()

    expect(rows[2]!.issues.map((issue) => issue.code)).toContain("p_out_of_scale")
    expect(rows[2]!.issues.map((issue) => issue.code)).toContain("c_out_of_scale")
    expect(riskImportStatus(rows[2]!.issues)).toBe("rejected")

    expect(rows[3]!.issues).toContainEqual(expect.objectContaining({ code: "classification_mismatch", excel: "moderate", calculated: "important" }))
    expect(rows[3]!.normalized.classification).toBe("important")
    expect(rows[3]!.normalized.excelClassification).toBe("MODERADO")
  })

  it("el factor que el catálogo no tiene se informa; con el factor, la fila queda lista", () => {
    const [unknown] = parse([sheetRow({ factor: "Psicosocial (nuevo)", probability: 1, consequence: 1 })])
    expect(unknown!.issues).toContainEqual(expect.objectContaining({ code: "unknown_factor", excel: "Psicosocial (nuevo)" }))
    expect(riskImportStatus(unknown!.issues)).toBe("needs_review")

    const [known] = parse([sheetRow({ factor: "Psicosocial (nuevo)", probability: 1, consequence: 1 })], ["psicosocial (nuevo)"])
    expect(known!.issues).toEqual([])
    expect(riskImportStatus(known!.issues)).toBe("ready")
  })

  it("salta las filas sin ningún valor y la huella depende del contenido, no de la posición", () => {
    const rows = parse([
      sheetRow({}),
      sheetRow({ hazard: "Ruido", probability: 1, consequence: 1 }),
      sheetRow({}),
      sheetRow({ hazard: "Ruido", probability: 1, consequence: 1 }),
      sheetRow({ hazard: "Otro", probability: 1, consequence: 1 }),
    ])
    expect(rows.map((row) => row.rowNumber)).toEqual([15, 17, 18])
    expect(rows[0]!.fingerprintSha256).toBe(rows[1]!.fingerprintSha256)
    expect(rows[0]!.fingerprintSha256).not.toBe(rows[2]!.fingerprintSha256)
    expect(rows[0]!.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/)
    // El original guarda la fila cruda con sus rótulos: es la traza del Excel.
    expect(rows[0]!.original["PELIGRO"]).toBe("Ruido")
    expect(rows[0]!.normalized.hazard).toBe("Ruido")
  })

  it("los riesgos terminan en el control de cambios del pie de la hoja: sus filas no son riesgos", () => {
    // Así venían 4 «no se carga» en los RE-04 de Biodiversa 2026 y Cholguán: la tabla Revisión | Fecha | Modificaciones.
    const control = (revision: unknown, fecha: unknown, cambio: unknown) => { const cells = sheetRow({}); cells[4] = revision; cells[5] = fecha; cells[6] = cambio; return cells }
    const rows = parse([
      sheetRow({ hazard: "Ruido", probability: 1, consequence: 1 }),
      control("Revisión", "Fecha", "Modificaciones"),
      control(1, "2024-12-01", "Edición inicial."),
      control(2, "2025-01-31", "Actualización del documento de acuerdo con el D.S. 44."),
    ])
    expect(rows.map((row) => row.rowNumber)).toEqual([14])
  })

  it("salta los restos de la plantilla: una fila que sólo trae N°, MR o «REVISAR» de la fórmula de CLASIFICACIÓN no es un riesgo", () => {
    // Así venían 24 «no se carga» en el RE-04 de Biodiversa: filas vacías con la fórmula escrita.
    const rows = parse([
      sheetRow({ hazard: "Ruido", probability: 1, consequence: 1 }),
      sheetRow({ classification: "REVISAR" }),
      sheetRow({ number: 3, mr: 0, classification: "REVISAR" }),
    ])
    expect(rows.map((row) => row.rowNumber)).toEqual([14])
    // Con cualquier dato propio, sí es una fila: P y C vacíos la detienen y lo dice.
    const real = parse([sheetRow({ hazard: "Caída", classification: "REVISAR" })])
    expect(real).toHaveLength(1)
    expect(riskImportStatus(real[0]!.issues)).toBe("rejected")
  })
})
