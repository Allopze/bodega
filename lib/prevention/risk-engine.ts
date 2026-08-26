/**
 * Motor de evaluación de riesgo MIPER — Probabilidad × Consecuencia.
 *
 * Único lugar donde se calcula el nivel de riesgo. El backend SIEMPRE
 * recalcula magnitud (MR) y clasificación desde probabilidad y consecuencia;
 * nunca acepta esos valores desde el cliente (ficha MIPER §23-24: "no
 * confiar en valores enviados por el cliente").
 *
 * La metodología (escala de P/C, bandas de clasificación, intervalo de
 * revisión) vive en `preventionRiskMethodologies.configuration` (jsonb) y se
 * congela por matriz en `methodologySnapshot` al crearse — así una revisión
 * histórica nunca se recalcula retroactivamente si la metodología cambia
 * (§25). `resolveMethodology` cae a `DEFAULT_RISK_METHODOLOGY` (la
 * metodología ISP 3×3 real de la empresa, misma tabla P×C de la hoja
 * "Criterios de Evaluación IPER") si la configuración viene vacía o con
 * forma desconocida.
 */

import { RISK_LEVEL_COLOR, type RiskLevel } from "./risk-levels"

export const RISK_CLASSIFICATIONS = ["tolerable", "moderado", "importante", "intolerable"] as const
export type RiskClassification = typeof RISK_CLASSIFICATIONS[number]

export const RISK_CLASSIFICATION_LABEL: Record<RiskClassification, string> = {
  tolerable: "Tolerable",
  moderado: "Moderado",
  importante: "Importante",
  intolerable: "Intolerable",
}

export interface RiskScaleLevel {
  value: number
  code: string
  label: string
  criterion: string
}

export interface RiskBand {
  /** Un magnitud es de esta banda si es ≤ este techo y > el techo de la banda anterior. */
  maxMagnitude: number
  classification: RiskClassification
  action: string
}

export interface RiskMethodology {
  engineVersion: string
  probability: RiskScaleLevel[]
  consequence: RiskScaleLevel[]
  bands: RiskBand[]
  reviewIntervalDays: number
}

/**
 * Biyección clasificación↔nivel. Es DISTINTA A PROPÓSITO de `ALIASES` en
 * `risk-levels.ts` (que colapsa tolerable/moderado→"medium" al parsear texto
 * humano libre de importaciones históricas ambiguas). Esta es 4→4: preserva
 * los cuatro baldes existentes, permite backfillear `riskClassification`
 * desde `residualLevel` sin ambigüedad, y no mueve ninguna fila existente de
 * balde en el backfill (round-trip exacto).
 */
export const RISK_CLASSIFICATION_TO_LEVEL: Record<RiskClassification, RiskLevel> = {
  tolerable: "low",
  moderado: "medium",
  importante: "high",
  intolerable: "critical",
}

export const RISK_LEVEL_TO_CLASSIFICATION: Record<RiskLevel, RiskClassification> = {
  low: "tolerable",
  medium: "moderado",
  high: "importante",
  critical: "intolerable",
}

/** Reutiliza la paleta de `risk-levels.ts` vía la biyección — un solo color por balde, sin tabla paralela. */
export function riskClassificationColor(classification: RiskClassification): string {
  return RISK_LEVEL_COLOR[RISK_CLASSIFICATION_TO_LEVEL[classification]]
}

/**
 * Variante de `<Badge>` por clasificación. Importante e intolerable comparten
 * "danger" — misma convención que `RISK_LEVEL_COLOR` (high/critical
 * comparten `--color-danger`); el texto de la etiqueta es lo que distingue,
 * el color no tiene por qué. Nunca `style` inline con color arbitrario sobre
 * texto: las variantes del design system ya resuelven el contraste WCAG.
 */
export const RISK_CLASSIFICATION_BADGE_VARIANT: Record<RiskClassification, "success" | "warning" | "danger"> = {
  tolerable: "success",
  moderado: "warning",
  importante: "danger",
  intolerable: "danger",
}

const CRITERIA = {
  probLow: "El daño ocurrirá rara vez o en contadas ocasiones (posibilidad de ocurrencia remota).",
  probMedium: "El daño puede ocurrir en varias ocasiones (posibilidad de ocurrencia mediana, no siendo tan evidente).",
  probHigh: "El daño ocurrirá siempre o casi siempre (posibilidad de ocurrencia inmediata, siendo evidente que pasará).",
  consLow: "Pequeñas lesiones o daños superficiales, o molestias e irritaciones con tiempos rápidos de recuperación.",
  consMedium: "Lesiones (laceraciones, quemaduras, torceduras, etc.) y/o intoxicaciones que pueden causar incapacidad temporal.",
  consHigh: "Eventos extremadamente dañinos: amputaciones, lesiones múltiples con incapacidad permanente, lesiones fatales.",
} as const

const ACTIONS = {
  tolerable: "No se necesita mejorar la acción preventiva. Se deben considerar soluciones más rentables o mejoras que no supongan una carga económica importante. Se requieren comprobaciones periódicas para asegurar que se mantiene la eficacia de las medidas de control.",
  moderado: "Se deben hacer esfuerzos para reducir el riesgo, determinando las inversiones precisas. Las medidas para reducir el riesgo se deben implementar en un período determinado.",
  importante: "No se debe comenzar ni continuar el trabajo hasta que se haya reducido el riesgo. Cuando el riesgo corresponda a un trabajo que se está realizando, se debe remediar el problema en un tiempo inferior al de los riesgos moderados.",
  intolerable: "No debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo. Si no es posible reducirlo, incluso con recursos ilimitados, se debe prohibir el trabajo.",
} as const

/** Metodología ISP-IPER 3×3 — la misma tabla P×C de la hoja "Criterios de Evaluación IPER". */
export const DEFAULT_RISK_METHODOLOGY: RiskMethodology = {
  engineVersion: "iper-3x3-v1",
  probability: [
    { value: 1, code: "baja", label: "Baja - 1", criterion: CRITERIA.probLow },
    { value: 2, code: "media", label: "Media - 2", criterion: CRITERIA.probMedium },
    { value: 4, code: "alta", label: "Alta - 4", criterion: CRITERIA.probHigh },
  ],
  consequence: [
    { value: 1, code: "baja", label: "Baja - 1", criterion: CRITERIA.consLow },
    { value: 2, code: "media", label: "Media - 2", criterion: CRITERIA.consMedium },
    { value: 4, code: "alta", label: "Alta - 4", criterion: CRITERIA.consHigh },
  ],
  bands: [
    { maxMagnitude: 2, classification: "tolerable", action: ACTIONS.tolerable },
    { maxMagnitude: 4, classification: "moderado", action: ACTIONS.moderado },
    { maxMagnitude: 8, classification: "importante", action: ACTIONS.importante },
    { maxMagnitude: 16, classification: "intolerable", action: ACTIONS.intolerable },
  ],
  reviewIntervalDays: 182,
}

/**
 * Lee `preventionRiskMethodologies.configuration` (jsonb, hoy inerte) y cae
 * al default si viene vacío o con forma desconocida. Permite que una
 * metodología futura (p. ej. 5×5) declare otra escala sin tocar código.
 */
export function resolveMethodology(configuration: unknown): RiskMethodology {
  if (!configuration || typeof configuration !== "object") return DEFAULT_RISK_METHODOLOGY
  const config = configuration as Partial<RiskMethodology>
  if (!Array.isArray(config.probability) || !Array.isArray(config.consequence) || !Array.isArray(config.bands)) {
    return DEFAULT_RISK_METHODOLOGY
  }
  if (config.probability.length === 0 || config.consequence.length === 0 || config.bands.length === 0) {
    return DEFAULT_RISK_METHODOLOGY
  }
  return {
    engineVersion: typeof config.engineVersion === "string" && config.engineVersion ? config.engineVersion : DEFAULT_RISK_METHODOLOGY.engineVersion,
    probability: config.probability as RiskScaleLevel[],
    consequence: config.consequence as RiskScaleLevel[],
    bands: config.bands as RiskBand[],
    reviewIntervalDays: typeof config.reviewIntervalDays === "number" && config.reviewIntervalDays > 0
      ? config.reviewIntervalDays
      : DEFAULT_RISK_METHODOLOGY.reviewIntervalDays,
  }
}

export function computeRiskMagnitude(probability: number, consequence: number): number {
  return probability * consequence
}

export function classifyRisk(magnitude: number, methodology: RiskMethodology = DEFAULT_RISK_METHODOLOGY): RiskClassification {
  const sorted = [...methodology.bands].sort((a, b) => a.maxMagnitude - b.maxMagnitude)
  const band = sorted.find((item) => magnitude <= item.maxMagnitude)
  if (!band) throw new Error(`Magnitud de riesgo ${magnitude} fuera de las bandas de la metodología (máximo ${sorted.at(-1)?.maxMagnitude ?? "?"}).`)
  return band.classification
}

export interface EvaluatedRisk {
  probability: number
  consequence: number
  riskMagnitude: number
  riskClassification: RiskClassification
  /** Compatibilidad hacia los 6 consumidores externos que referencian el nivel low/medium/high/critical. */
  residualLevel: RiskLevel
  /** `numeric(mode:"number")` en BD — drizzle espera number, no string. */
  residualScore: number
}

/**
 * Único punto de cálculo. El servidor SIEMPRE llama a esto para escribir una
 * entrada de riesgo — nunca persiste `riskMagnitude`/`riskClassification`
 * recibidos del cliente, aunque lleguen en el payload.
 */
export function evaluateRisk(
  input: { probability: number; consequence: number },
  methodology: RiskMethodology = DEFAULT_RISK_METHODOLOGY,
): EvaluatedRisk {
  const validProbability = methodology.probability.some((level) => level.value === input.probability)
  const validConsequence = methodology.consequence.some((level) => level.value === input.consequence)
  if (!validProbability) throw new Error(`Probabilidad inválida: ${input.probability}. Valores permitidos: ${methodology.probability.map((l) => l.value).join(", ")}.`)
  if (!validConsequence) throw new Error(`Consecuencia inválida: ${input.consequence}. Valores permitidos: ${methodology.consequence.map((l) => l.value).join(", ")}.`)
  const riskMagnitude = computeRiskMagnitude(input.probability, input.consequence)
  const riskClassification = classifyRisk(riskMagnitude, methodology)
  return {
    probability: input.probability,
    consequence: input.consequence,
    riskMagnitude,
    riskClassification,
    residualLevel: RISK_CLASSIFICATION_TO_LEVEL[riskClassification],
    residualScore: riskMagnitude,
  }
}

/**
 * Tolera texto humano libre del Excel importado: "BAJA", "alta ", "4", 4.
 * Devuelve `null` (nunca adivina) si no calza con ningún nivel de la escala.
 */
export function parseScaleValue(value: unknown, scale: readonly RiskScaleLevel[]): number | null {
  if (value == null) return null
  if (typeof value === "number") {
    return Number.isFinite(value) && scale.some((level) => level.value === value) ? value : null
  }
  const normalized = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ")
  if (!normalized) return null
  const asNumber = Number(normalized)
  if (Number.isFinite(asNumber) && normalized !== "") return scale.some((level) => level.value === asNumber) ? asNumber : null
  // Sólo coincidencia exacta o seguida de espacio ("baja", "baja 1"). Un
  // `startsWith` con guion ("media-") también coincidía con compuestos
  // ambiguos como "MEDIA-ALTA" — texto libre de Excel que no es un nivel.
  const match = scale.find((level) => normalized === level.code || normalized.startsWith(`${level.code} `))
  return match ? match.value : null
}

export function parseRiskClassification(value: unknown): RiskClassification | null {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
  return (RISK_CLASSIFICATIONS as readonly string[]).includes(normalized) ? (normalized as RiskClassification) : null
}

/**
 * Identidad estable de una entrada de riesgo ya persistida (post-resolución
 * de jerarquía): el mismo criterio que usan `repointRiskMapMarkers` para
 * reapuntar el mapa de riesgos al publicar una nueva revisión y
 * `compareRiskMatrices` para emparejar entradas entre dos versiones.
 *
 * El `fingerprint()` del importador (`prevention-risk-import.ts`) es
 * deliberadamente una función distinta, no una copia divergente: opera
 * *antes* de que proceso/tarea/puesto existan como filas — sólo tiene sus
 * códigos de texto del Excel, nunca sus id — así que no puede construir esta
 * misma clave todavía.
 */
export function riskEntryIdentityKey(entry: { processId: string; taskId: string; positionId: string; hazardCode: string }): string {
  return `${entry.processId}|${entry.taskId}|${entry.positionId}|${entry.hazardCode}`
}
