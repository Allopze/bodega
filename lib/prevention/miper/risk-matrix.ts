/**
 * Mapa de calor probabilidad × consecuencia del RE-04 (CHART-007 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`): las reglas que no tocan la base ni el
 * DOM. El componente (`components/charts/risk-matrix.tsx`) sólo dibuja lo que
 * sale de aquí.
 *
 * La clasificación de cada celda NO se recalcula con otra regla: es `classify`
 * de `methodology.ts`, la misma que la columna generada
 * `prevention_risk_entries.classification`. Por eso las celdas con la misma
 * magnitud (P4 × C2 y P2 × C4, ambas 8) comparten banda, y por eso la escala
 * 1-2-4 no se interpola: son cuatro clases discretas.
 */
import { countOf } from "@/lib/utils"
import { normalizeRiskLevel, type RiskLevel } from "@/lib/prevention/risk-levels"
import {
  CLASSIFICATION_LABEL, classify, criticalityOf, isScaleValue, RISK_CLASSIFICATIONS,
  type MiperScaleValue, type RiskClassification,
} from "./methodology"
import { cleanMiperName, normalizeMiperName } from "./names"

/** De arriba abajo: la probabilidad más alta primero, como se lee un mapa de riesgos. */
export const RISK_MATRIX_PROBABILITIES = [4, 2, 1] as const satisfies readonly MiperScaleValue[]
/** De izquierda a derecha: la consecuencia crece hacia la derecha. */
export const RISK_MATRIX_CONSEQUENCES = [1, 2, 4] as const satisfies readonly MiperScaleValue[]

/** Palabra de cada valor de la escala (probabilidad y consecuencia usan las mismas tres: baja, media, alta). */
export const SCALE_WORD: Record<MiperScaleValue, string> = { 1: "Baja", 2: "Media", 4: "Alta" }

/** Cuántos peligros distintos nombra el tooltip de una celda (CHART-007, P-3). */
export const TOP_HAZARDS_PER_CELL = 3

/** Un peligro de una celda y en cuántos de sus riesgos aparece. */
export type HazardCount = { label: string; count: number }

export type RiskMatrixCell = {
  probability: MiperScaleValue
  consequence: MiperScaleValue
  /** MR = P × C. */
  magnitude: number
  classification: RiskClassification
  count: number
  /** Los {@link TOP_HAZARDS_PER_CELL} peligros más frecuentes de la celda: más repetido primero, con empate por nombre. */
  topHazards: HazardCount[]
  /** Peligros distintos de la celda que no caben en `topHazards`. */
  moreHazards: number
}

export type RiskMatrixData = {
  /** Nueve celdas en orden de lectura: filas por probabilidad descendente, columnas por consecuencia ascendente. */
  cells: RiskMatrixCell[]
  total: number
  /** Con probabilidad y consecuencia dentro de la escala: las que entran en la grilla. */
  evaluated: number
  /** Sin P o sin C (o fuera de la escala): quedan fuera de la grilla. */
  unevaluated: number
  byClassification: Record<RiskClassification, number>
  /** Importantes + Intolerables, la cifra que la pestaña Resumen ya muestra como tile. */
  severe: number
  /** La celda con más riesgos; `null` si no hay ninguno evaluado. Con empate, la más grave (ver `buildRiskMatrix`). */
  busiest: RiskMatrixCell | null
  /** Cuántas celdas comparten el conteo máximo (1 = una sola concentra; 0 = nada evaluado). */
  tied: number
}

/** Una celda de la grilla, por sus dos coordenadas: lo que el filtro `?celda=` lleva en la URL. */
export type MatrixCellRef = { probability: MiperScaleValue; consequence: MiperScaleValue }

/** El valor de `?celda=`: «P4xC2». Una sola clave para una sola dimensión (DESIGN.md § Drill-down). */
export const cellParam = (cell: MatrixCellRef) => `P${cell.probability}xC${cell.consequence}`

/** Lee `?celda=`; lo que no es una celda de la escala 1-2-4 (a mano en la URL) no filtra. */
export function parseCellParam(value: string | null | undefined): MatrixCellRef | null {
  const match = /^P(\d+)xC(\d+)$/i.exec((value ?? "").trim())
  if (!match) return null
  const probability = Number(match[1]), consequence = Number(match[2])
  return isScaleValue(probability) && isScaleValue(consequence) ? { probability, consequence } : null
}

/** «P4 × C2». La abreviatura lleva su significado completo en el `title` del componente. */
export const cellName = (cell: Pick<RiskMatrixCell, "probability" | "consequence">) => `P${cell.probability} × C${cell.consequence}`

/** «probabilidad Alta × consecuencia Media (P4 × C2)»: la celda dicha en lenguaje de usuario. */
export const cellDescription = (cell: Pick<RiskMatrixCell, "probability" | "consequence">) =>
  `probabilidad ${SCALE_WORD[cell.probability]} × consecuencia ${SCALE_WORD[cell.consequence]} (${cellName(cell)})`

type Evaluable = { probability: number | null; consequence: number | null; hazard?: string | null }

/**
 * Los peligros más frecuentes de una celda. «Caída de objetos» y «caida de
 * objetos » son el mismo peligro (misma clave que el diccionario: sin tildes,
 * minúsculas, espacios colapsados) y se rotulan con la escritura más repetida;
 * con empate, la primera que apareció. Un riesgo sin peligro escrito no suma.
 */
function summarizeHazards(hazards: readonly string[]): Pick<RiskMatrixCell, "topHazards" | "moreHazards"> {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const raw of hazards) {
    const label = cleanMiperName(raw)
    if (!label) continue
    const key = normalizeMiperName(label)
    const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() }
    group.count += 1
    group.spellings.set(label, (group.spellings.get(label) ?? 0) + 1)
    groups.set(key, group)
  }
  const ranked = [...groups.entries()].map(([key, group]) => {
    // `Map` conserva el orden de aparición, y `reduce` sólo cambia de ganador con una escritura estrictamente más repetida.
    const label = [...group.spellings.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
    return { key, label, count: group.count }
  }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "es-CL"))
  return {
    topHazards: ranked.slice(0, TOP_HAZARDS_PER_CELL).map(({ label, count }) => ({ label, count })),
    moreHazards: Math.max(0, ranked.length - TOP_HAZARDS_PER_CELL),
  }
}

export function buildRiskMatrix(rows: readonly Evaluable[]): RiskMatrixData {
  const cells: RiskMatrixCell[] = RISK_MATRIX_PROBABILITIES.flatMap((probability) =>
    RISK_MATRIX_CONSEQUENCES.map((consequence) => ({
      probability, consequence, magnitude: probability * consequence, classification: classify(probability, consequence)!, count: 0,
      topHazards: [], moreHazards: 0,
    })))
  const byClassification = Object.fromEntries(RISK_CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<RiskClassification, number>
  const hazardsByCell = new Map<RiskMatrixCell, string[]>()
  let evaluated = 0
  for (const row of rows) {
    if (!isScaleValue(row.probability) || !isScaleValue(row.consequence)) continue
    const cell = cells.find((candidate) => candidate.probability === row.probability && candidate.consequence === row.consequence)
    if (!cell) continue
    cell.count += 1
    byClassification[cell.classification] += 1
    evaluated += 1
    if (row.hazard) {
      const list = hazardsByCell.get(cell)
      if (list) list.push(row.hazard)
      else hazardsByCell.set(cell, [row.hazard])
    }
  }
  for (const [cell, hazards] of hazardsByCell) Object.assign(cell, summarizeHazards(hazards))
  // Más riesgos; con empate, la de mayor magnitud (el empate se lee por el lado grave) y luego la de mayor probabilidad.
  const busiest = evaluated === 0 ? null : cells.reduce((best, cell) => {
    if (cell.count !== best.count) return cell.count > best.count ? cell : best
    if (cell.magnitude !== best.magnitude) return cell.magnitude > best.magnitude ? cell : best
    return cell.probability > best.probability ? cell : best
  })
  return {
    cells, total: rows.length, evaluated, unevaluated: rows.length - evaluated, byClassification,
    severe: byClassification.important + byClassification.intolerable, busiest,
    tied: busiest ? cells.filter((cell) => cell.count === busiest.count).length : 0,
  }
}

/** La frase que responde la pregunta del gráfico: cuánto del riesgo es grave y dónde se concentra. */
export function riskMatrixSummary(matrix: RiskMatrixData): string {
  const { busiest, evaluated, severe, tied } = matrix
  if (!busiest) return "Ningún riesgo está evaluado todavía."
  if (evaluated === 1) return `El único riesgo evaluado está en ${cellDescription(busiest)} y es ${CLASSIFICATION_LABEL[busiest.classification]}.`
  const graves = severe === 0
    ? "Ningún riesgo evaluado es Importante ni Intolerable"
    : `${severe} de ${evaluated} riesgos evaluados ${severe === 1 ? "es" : "son"} Importante${severe === 1 ? "" : "s"} o Intolerable${severe === 1 ? "" : "s"}`
  // Un empate no es una concentración: «la celda más cargada» sería una elección arbitraria entre iguales.
  if (tied > 1) return `${graves}; ${tied} celdas empatan con ${countOf(busiest.count, "riesgo")} cada una y la más grave es ${cellDescription(busiest)}.`
  return `${graves}; la celda más cargada es ${cellDescription(busiest)}, con ${countOf(busiest.count, "riesgo")}.`
}

/**
 * `residual_level` guarda los cuatro escalones del vocabulario del ISP
 * (`low|medium|high|critical`), no una probabilidad y una consecuencia: el
 * residual no se puede dibujar como grilla de 3 × 3. Se lee en las cuatro
 * bandas de la clasificación por el mismo puente que usa la CAPA
 * (`criticalityOf`), invertido, para que ambos lados del gráfico hablen igual.
 */
export function classificationOfRiskLevel(level: RiskLevel): RiskClassification {
  return RISK_CLASSIFICATIONS.find((classification) => criticalityOf(classification) === level)!
}

export type ResidualData = {
  /** Riesgos de esta MIPER. */
  total: number
  /** Los que tienen `residual_level`. En producción, 0 de 540 (2026-11-03). */
  recorded: number
  counts: Record<RiskClassification, number>
}

/** Cuenta el residual sólo de `entryIds` (las filas de esta MIPER) y sólo de los niveles que se entienden. */
export function summarizeResidual(entryIds: readonly string[], residualLevels: Readonly<Record<string, string | null | undefined>>): ResidualData {
  const counts = Object.fromEntries(RISK_CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<RiskClassification, number>
  let recorded = 0
  for (const id of entryIds) {
    const level = normalizeRiskLevel(residualLevels[id])
    if (!level) continue
    counts[classificationOfRiskLevel(level)] += 1
    recorded += 1
  }
  return { total: entryIds.length, recorded, counts }
}
