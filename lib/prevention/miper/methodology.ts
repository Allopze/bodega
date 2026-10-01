/**
 * Metodología del RE-04 (hoja "Criterios de Evaluación IPER" de la matriz de
 * Biodiversa). Es la única fuente de las escalas y los textos: la grilla la usa
 * para el cálculo instantáneo, la migración la replica en la columna generada, y
 * `RE04_METHODOLOGY` la congela en `methodology_snapshot` de cada MIPER.
 */
import type { RiskLevel } from "@/lib/prevention/risk-levels"

export const MIPER_SCALE_VALUES = [1, 2, 4] as const
export type MiperScaleValue = typeof MIPER_SCALE_VALUES[number]

export const PROBABILITY_LEVELS: ReadonlyArray<{ value: MiperScaleValue; label: string; description: string }> = [
  { value: 1, label: "Baja", description: "El daño ocurrirá rara vez o en contadas ocasiones (posibilidad de ocurrencia remota)." },
  { value: 2, label: "Media", description: "El daño ocurrirá en varias ocasiones (posibilidad de ocurrencia mediana (puede pasar), no siendo tan evidente)." },
  { value: 4, label: "Alta", description: "El daño ocurrirá siempre o casi siempre (posibilidad de ocurrencia inmediata, siendo evidente que pasará)." },
]

export const CONSEQUENCE_LEVELS: ReadonlyArray<{ value: MiperScaleValue; label: string; description: string }> = [
  { value: 1, label: "Baja (ligeramente dañino)", description: "Esta graduación debe ser adoptada en aquellos casos que pueden causar pequeñas lesiones o daños superficiales (cortes superficiales, magulladuras, etc.), o molestias e irritaciones con tiempos rápidos de recuperación." },
  { value: 2, label: "Media (dañino)", description: "Esta graduación debe ser adoptada en aquellos casos que pueden causar lesiones (laceraciones, quemaduras, torceduras, etc.) y/o intoxicaciones que pueden causar incapacidad temporal." },
  { value: 4, label: "Alta (extremadamente dañino)", description: "Esta graduación debe ser adoptada en aquellos casos en los cuales se puedan generar eventos extremadamente dañinos como amputaciones, lesiones múltiples que generen incapacidades permanentes y lesiones fatales." },
]

export const RISK_CLASSIFICATIONS = ["tolerable", "moderate", "important", "intolerable"] as const
export type RiskClassification = typeof RISK_CLASSIFICATIONS[number]

export const CLASSIFICATION_LABEL: Record<RiskClassification, string> = {
  tolerable: "Tolerable",
  moderate: "Moderado",
  important: "Importante",
  intolerable: "Intolerable",
}

/** Textos verbatim del RE-04, columna F de las filas 9–12. */
export const CLASSIFICATION_CRITERIA: Record<RiskClassification, string> = {
  tolerable: "No se necesita mejorar la acción preventiva. Sin embargo, se deben considerar soluciones más rentables o mejoras que no supongan una carga económica importante. Se requieren comprobaciones periódicas para asegurar que se mantiene la eficacia de las medidas de control.",
  moderate: "Se deben hacer esfuerzos para reducir el riesgo, determinando las inversiones precisas. Las medidas para reducir el riesgo se deben implementar en un período determinado. Cuando el riesgo moderado está asociado con consecuencias extremadamente dañinas, se precisará una acción posterior para establecer, con más precisión, la probabilidad de daño como base para determinar la necesidad de mejora de las medidas de control.",
  important: "No se debe comenzar ni continuar el trabajo hasta que se haya reducido el riesgo (puede que se precisen recursos considerables para controlar el riesgo). Cuando el riesgo corresponda a un trabajo que se está realizando, se debe remediar el problema en un tiempo inferior al de los riesgos moderados.",
  intolerable: "No debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo. Si no es posible reducirlo, incluso con recursos ilimitados, se debe prohibir el trabajo.",
}

const BAND_MAGNITUDES: Record<RiskClassification, readonly number[]> = {
  tolerable: [1, 2], moderate: [4], important: [8], intolerable: [16],
}

export function isScaleValue(value: unknown): value is MiperScaleValue {
  return value === 1 || value === 2 || value === 4
}

export function magnitudeOf(probability: unknown, consequence: unknown): number | null {
  if (!isScaleValue(probability) || !isScaleValue(consequence)) return null
  return probability * consequence
}

/** Misma regla que la columna generada `prevention_risk_entries.classification`. */
export function classify(probability: unknown, consequence: unknown): RiskClassification | null {
  const mr = magnitudeOf(probability, consequence)
  if (mr === null) return null
  if (mr <= 2) return "tolerable"
  if (mr === 4) return "moderate"
  if (mr === 8) return "important"
  return "intolerable"
}

/** Puente al vocabulario de 4 niveles que usan la CAPA y el mapa de riesgos. */
export function criticalityOf(classification: RiskClassification): RiskLevel {
  return ({ tolerable: "low", moderate: "medium", important: "high", intolerable: "critical" } as const)[classification]
}

export const RE04_METHODOLOGY = {
  id: "riskmethod-re04-chome",
  code: "RE-04-CHOME",
  name: "Matriz de Identificación de Peligros y Evaluación de Riesgos (RE-04)",
  versionLabel: "REV-2026",
  kind: "primary" as const,
  authoritySource: "Formato RE-04 CHOME: probabilidad × consecuencia (1-2-4), magnitud del riesgo y clasificación en cuatro bandas.",
  configuration: {
    probability: PROBABILITY_LEVELS,
    consequence: CONSEQUENCE_LEVELS,
    bands: RISK_CLASSIFICATIONS.map((classification) => ({
      classification,
      label: CLASSIFICATION_LABEL[classification],
      magnitudes: BAND_MAGNITUDES[classification],
      criteria: CLASSIFICATION_CRITERIA[classification],
    })),
  },
}
