/**
 * Parser **puro** de la hoja *RE-04 IPER* del formato real (§9.3, Task 7 de la F3).
 *
 * Recibe la matriz de celdas ya extraída por ExcelJS —el servicio la lee, este
 * módulo no lo hace— y devuelve una fila por riesgo evaluado con:
 *
 * - `original`: la fila tal como está en el Excel (clave = rótulo de columna).
 * - `normalized`: los valores mapeados al vocabulario de la plataforma.
 * - `issues`: los problemas de la fila, con el valor leído y el que manda.
 * - `fingerprintSha256`: huella del contenido, para trazabilidad.
 *
 * Reglas del §9.3 (y del Review Focus 5 de la Parte IV):
 *
 * - Los textos del formato real se mapean: `"SÍ, CONTROLADO" → "yes"`,
 *   `"PARCIALMENTE CONTROLADO" → "partial"`, `"NO CONTROLADO"` o vacío `→ "no"`;
 *   `"RUTINARIA" → true`, `"NO RUTINARIA" → false`.
 * - P y C sólo valen `{1, 2, 4}`: cualquier otro valor (o su ausencia) produce
 *   `p_out_of_scale` / `c_out_of_scale` y la fila **no se carga**.
 * - El MR y la clasificación del Excel se **informan** (`mr_mismatch`,
 *   `classification_mismatch`) pero **no mandan**: manda `classify(p, c)`.
 * - El factor de riesgo que no existe en el catálogo produce `unknown_factor`.
 *   El catálogo se recibe como dato (`knownFactors`, nombres normalizados) para
 *   que este módulo siga siendo puro: quien lo llama lo lee de la base.
 *
 * No importa `db` ni nada del servidor (regla dura de la tarea): sólo
 * `node:crypto` para la huella.
 */
import { createHash } from "node:crypto"
import { classify, isScaleValue, magnitudeOf, type RiskClassification } from "./methodology"
import { normalizeMiperName } from "./names"

/** Nombre de la hoja del formato real. */
export const RE04_SHEET_NAME = "RE-04 IPER"

/**
 * Columnas del RE-04, en su orden real (1..21). Los encabezados del formato
 * ocupan dos filas —la segunda trae F / M / OTRO y PROBABILIDAD / CONSECUENCIA /
 * MR / CLASIFICACIÓN—, así que el índice manda y no el texto del encabezado.
 */
export const RE04_COLUMNS = [
  "N°",
  "ACTIVIDAD",
  "TAREA",
  "PUESTO DE TRABAJO",
  "LUGAR DE TRABAJO ESPECÍFICO",
  "TRABAJADORES (F)",
  "TRABAJADORES (M)",
  "TRABAJADORES (OTRO)",
  "FACTORES DE RIESGO",
  "RUTINARIA / NO RUTINARIA",
  "PELIGRO",
  "RIESGO",
  "DAÑO PROBABLE",
  "PROBABILIDAD",
  "CONSECUENCIA",
  "MR",
  "CLASIFICACIÓN DEL RIESGO",
  "MEDIDA DE CONTROL",
  "¿ESTÁ CONTROLADO EL RIESGO?",
  "RESPONSABLE",
  "PLAZOS",
] as const

export type Re04ColumnLabel = (typeof RE04_COLUMNS)[number]

/** `yes | partial | no` es el CHECK de `prevention_risk_entries.controlled_status`. */
export type Re04ControlledStatus = "yes" | "partial" | "no"

export type RiskImportIssueCode =
  | "p_out_of_scale"
  | "c_out_of_scale"
  | "mr_mismatch"
  | "classification_mismatch"
  | "unknown_factor"

export type RiskImportIssue = {
  code: RiskImportIssueCode
  message: string
  /** Lo que dice el Excel. */
  excel?: string | number | null
  /** Lo que aplica la plataforma (manda el cálculo). */
  calculated?: string | number | null
}

/** Fila normalizada al vocabulario del modelo RE-04 (§3 del spec). */
export type Re04Normalized = {
  activity: string | null
  task: string | null
  position: string | null
  location: string | null
  exposedFemale: number | null
  exposedMale: number | null
  exposedOther: number | null
  riskFactor: string | null
  isRoutine: boolean | null
  hazard: string | null
  risk: string | null
  probableDamage: string | null
  probability: number | null
  consequence: number | null
  /** `p × c`; nulo si la fila no se puede evaluar. Es el MR que se guarda. */
  magnitude: number | null
  /** `classify(p, c)`; nulo si la fila no se puede evaluar. Es el que se guarda. */
  classification: RiskClassification | null
  controlledStatus: Re04ControlledStatus
  /** MR escrito en el Excel (se informa, no manda). */
  excelMagnitude: number | null
  /** Clasificación escrita en el Excel, tal cual (se informa, no manda). */
  excelClassification: string | null
  measures: string | null
  responsible: string | null
  deadlines: string | null
}

export type ParsedRe04Row = {
  /** Fila del Excel (1-based): lo que la persona ve cuando la abre. */
  rowNumber: number
  original: Record<string, unknown>
  normalized: Re04Normalized
  issues: RiskImportIssue[]
  fingerprintSha256: string
}

/** Hoja ya extraída: `rows[0]` es la fila `startRow` del Excel. */
export type Re04CellMatrix = {
  startRow: number
  rows: unknown[][]
}

/**
 * Estado de la fila en la vista previa. Son los estados que el CHECK de
 * `prevention_risk_import_rows` ya admite —no se agrega ninguno—:
 *
 * - `ready`: se puede cargar. Incluye las filas que sólo **informan** un MR o una
 *   clasificación del Excel distintos: no piden ninguna decisión porque manda el
 *   cálculo, así que no tiene sentido detenerlas.
 * - `needs_review`: falta una decisión humana (hoy, el factor desconocido).
 * - `rejected`: P o C fuera de la escala; no se carga nunca.
 */
export type RiskImportRowStatus = "ready" | "needs_review" | "rejected"

export function riskImportStatus(issues: readonly RiskImportIssue[]): RiskImportRowStatus {
  if (issues.some((issue) => issue.code === "p_out_of_scale" || issue.code === "c_out_of_scale")) return "rejected"
  if (issues.some((issue) => issue.code === "unknown_factor")) return "needs_review"
  return "ready"
}

/** Una fila sin ningún valor no es un riesgo: es un resto de formato. */
export function isEmptyRe04Row(cells: readonly unknown[]): boolean {
  return cells.every((cell) => textOf(cell) === null)
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const raw = typeof value === "string" ? value : String(value)
  const cleaned = raw.replace(/\s+/g, " ").trim()
  return cleaned.length > 0 ? cleaned : null
}

/** Clave de comparación de textos del Excel: sin tildes, sin signos, minúsculas. */
function keyOf(value: unknown): string {
  const raw = textOf(value)
  if (raw === null) return ""
  return normalizeMiperName(raw).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

/** Número entero del Excel: número nativo o texto ("8", "8,0"). */
function intOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null
  const raw = textOf(value)
  if (raw === null) return null
  const parsed = Number(raw.replace(",", "."))
  return Number.isInteger(parsed) ? parsed : null
}

/** "SÍ, CONTROLADO" / "PARCIALMENTE CONTROLADO" / "NO CONTROLADO" / vacío → "no". */
const CONTROLLED_TEXT: Record<string, Re04ControlledStatus> = {
  "si controlado": "yes",
  "si": "yes",
  "controlado": "yes",
  "parcialmente controlado": "partial",
  "parcialmente": "partial",
  "parcial": "partial",
  "no controlado": "no",
  "no": "no",
}

export function controlledStatusOf(value: unknown): Re04ControlledStatus {
  return CONTROLLED_TEXT[keyOf(value)] ?? "no"
}

/** "RUTINARIA" → true, "NO RUTINARIA" → false, vacío → null. */
export function isRoutineOf(value: unknown): boolean | null {
  const key = keyOf(value)
  if (key === "") return null
  if (key.startsWith("no ") || key === "no" || key.startsWith("no rutinaria")) return false
  if (key.includes("rutinaria")) return true
  return null
}

/** Textos de clasificación del RE-04 → vocabulario del modelo. */
const CLASSIFICATION_TEXT: Record<string, RiskClassification> = {
  tolerable: "tolerable",
  moderado: "moderate",
  moderate: "moderate",
  importante: "important",
  important: "important",
  intolerable: "intolerable",
}

export function classificationTextOf(value: unknown): { raw: string | null; mapped: RiskClassification | null } {
  const raw = textOf(value)
  if (raw === null) return { raw: null, mapped: null }
  return { raw, mapped: CLASSIFICATION_TEXT[keyOf(raw)] ?? null }
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** `knownFactors`: nombres del catálogo ya normalizados (`normalizeMiperName`). */
export type Re04ParseOptions = {
  knownFactors?: ReadonlySet<string>
}

export function parseRe04Matrix(matrix: Re04CellMatrix, options: Re04ParseOptions = {}): { rows: ParsedRe04Row[] } {
  const knownFactors = options.knownFactors ?? new Set<string>()
  const rows: ParsedRe04Row[] = []
  matrix.rows.forEach((cells, index) => {
    if (isEmptyRe04Row(cells)) return
    rows.push(parseRe04Row(cells, matrix.startRow + index, knownFactors))
  })
  return { rows }
}

function parseRe04Row(cells: readonly unknown[], rowNumber: number, knownFactors: ReadonlySet<string>): ParsedRe04Row {
  const original: Record<string, unknown> = {}
  RE04_COLUMNS.forEach((label, index) => { original[label] = cells[index] ?? null })

  const probabilityRaw = cells[13] ?? null
  const consequenceRaw = cells[14] ?? null
  const probability = intOf(probabilityRaw)
  const consequence = intOf(consequenceRaw)
  const magnitude = magnitudeOf(probability, consequence)
  const classification = classify(probability, consequence)
  const excelMagnitude = intOf(cells[15])
  const excelClassification = classificationTextOf(cells[16])
  const factorName = textOf(cells[8])

  const issues: RiskImportIssue[] = []
  if (!isScaleValue(probability)) {
    issues.push({
      code: "p_out_of_scale",
      message: probability === null
        ? "La probabilidad está vacía o no es un número."
        : `La probabilidad ${probability} no está en la escala (1, 2 o 4).`,
      excel: typeof probabilityRaw === "string" || typeof probabilityRaw === "number" ? probabilityRaw : null,
    })
  }
  if (!isScaleValue(consequence)) {
    issues.push({
      code: "c_out_of_scale",
      message: consequence === null
        ? "La consecuencia está vacía o no es un número."
        : `La consecuencia ${consequence} no está en la escala (1, 2 o 4).`,
      excel: typeof consequenceRaw === "string" || typeof consequenceRaw === "number" ? consequenceRaw : null,
    })
  }
  if (excelMagnitude !== null && magnitude !== null && excelMagnitude !== magnitude) {
    issues.push({
      code: "mr_mismatch",
      message: `El Excel trae MR ${excelMagnitude} y la plataforma calcula ${magnitude} (P ${probability} × C ${consequence}).`,
      excel: excelMagnitude,
      calculated: magnitude,
    })
  }
  if (excelClassification.mapped !== null && classification !== null && excelClassification.mapped !== classification) {
    issues.push({
      code: "classification_mismatch",
      message: `El Excel clasifica la fila como ${excelClassification.raw} y la plataforma como ${classification}.`,
      excel: excelClassification.mapped,
      calculated: classification,
    })
  }
  if (factorName !== null && !knownFactors.has(normalizeMiperName(factorName))) {
    issues.push({
      code: "unknown_factor",
      message: `El factor de riesgo «${factorName}» no está en el catálogo: mapéalo o créalo.`,
      excel: factorName,
    })
  }

  const normalized: Re04Normalized = {
    activity: textOf(cells[1]),
    task: textOf(cells[2]),
    position: textOf(cells[3]),
    location: textOf(cells[4]),
    exposedFemale: intOf(cells[5]),
    exposedMale: intOf(cells[6]),
    exposedOther: intOf(cells[7]),
    riskFactor: factorName,
    isRoutine: isRoutineOf(cells[9]),
    hazard: textOf(cells[10]),
    risk: textOf(cells[11]),
    probableDamage: textOf(cells[12]),
    probability,
    consequence,
    magnitude,
    classification,
    controlledStatus: controlledStatusOf(cells[18]),
    excelMagnitude,
    excelClassification: excelClassification.raw,
    measures: textOf(cells[17]),
    responsible: textOf(cells[19]),
    deadlines: textOf(cells[20]),
  }

  return { rowNumber, original, normalized, issues, fingerprintSha256: sha256(original) }
}
