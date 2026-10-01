/**
 * Deduplicación de medidas del Programa de Trabajo (§7.3 del spec F2).
 *
 * El sistema propone agrupar medidas que describen lo mismo; la persona decide
 * crear una actividad nueva o vincularse a una existente. Por eso estas piezas
 * son puras y deterministas: no tocan la base ni proponen por sí solas.
 */

/**
 * Umbral de similitud de Jaccard a partir del cual dos medidas caen en el mismo
 * grupo. Es un valor inicial ajustable con datos reales (decisión abierta §14.4
 * del spec): subirlo separa medidas parecidas, bajarlo fusiona más.
 */
export const MEASURE_GROUP_THRESHOLD = 0.6

/** Palabras vacías que no aportan al comparar descripciones de medidas. */
const STOP_WORDS = new Set(["de", "la", "el", "los", "y", "para", "con", "en", "del"])

/**
 * Clave de comparación de una medida: minúsculas sin tildes, sin puntuación, sin
 * palabras vacías y con los espacios colapsados. Se conserva el orden de las
 * palabras.
 */
export function normalizeMeasure(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
    .join(" ")
}

function tokenSet(value: string): Set<string> {
  const normalized = normalizeMeasure(value)
  return new Set(normalized.length > 0 ? normalized.split(" ") : [])
}

/** Índice de Jaccard sobre los conjuntos de tokens de la forma normalizada. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

/** Similitud de Jaccard entre dos descripciones (0 = nada en común, 1 = iguales). */
export function similarity(a: string, b: string): number {
  return jaccard(tokenSet(a), tokenSet(b))
}

type Measure = { id: string; description: string }

type WorkingGroup = {
  /** `id` de la medida representante (la primera que abrió el grupo). */
  key: string
  measures: string[]
  /** Tokens de la representante: sólo se compara contra ella, nunca contra el grupo entero. */
  tokens: Set<string>
}

/**
 * Agrupa medidas por similitud ≥ `threshold` **sin** fusionar transitivamente
 * grupos distintos: cada medida cae en un solo grupo, el de la representante más
 * parecida (comparada sólo contra las representantes ya creadas); si ninguna
 * supera el umbral, abre su propio grupo y pasa a ser su representante.
 *
 * El orden de entrada decide las representantes, así que la función es
 * determinista para un mismo arreglo.
 */
export function groupMeasures(measures: Measure[], threshold: number): Array<{ key: string; measures: string[] }> {
  const groups: WorkingGroup[] = []

  for (const measure of measures) {
    const tokens = tokenSet(measure.description)
    let best: WorkingGroup | null = null
    let bestScore = -1
    for (const group of groups) {
      const score = jaccard(tokens, group.tokens)
      if (score > bestScore) {
        bestScore = score
        best = group
      }
    }

    if (best && bestScore >= threshold) {
      best.measures.push(measure.id)
    } else {
      groups.push({ key: measure.id, measures: [measure.id], tokens })
    }
  }

  return groups.map((group) => ({ key: group.key, measures: group.measures }))
}
