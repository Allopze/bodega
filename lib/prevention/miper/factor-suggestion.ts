/**
 * El factor de riesgo de una fila importada del RE-04 que el catálogo no
 * reconoce por su nombre exacto. Puro: lo usan la vista previa (para proponer) y
 * la carga (para comparar con la misma clave).
 */
import { levenshtein } from "@/lib/levenshtein"
import { cleanMiperName, normalizeMiperName } from "./names"

/** Clave con que se compara un FACTORES DE RIESGO con el catálogo: sin tildes, mayúsculas ni espacios sobrantes. */
export function riskFactorKey(name: string | null | undefined): string | null {
  const cleaned = cleanMiperName(name)
  return cleaned === null ? null : normalizeMiperName(cleaned)
}

/** Una errata se reconoce desde cinco letras: con menos, dos cambios ya son otra palabra. */
const MIN_TYPO_LENGTH = 5
const MAX_TYPO_DISTANCE = 2
/** Separadores de un factor compuesto: «MECÁNICO / ELÉCTRICO», «FÍSICO, QUÍMICO». */
const COMPOUND_SEPARATOR = /[/,;+]/u

/**
 * El factor del catálogo que corresponde a `name`, o `null` si no hay uno claro.
 * La sugerencia llega elegida en el diálogo, así que sólo se propone cuando el
 * parecido no deja dudas:
 * - una errata de una o dos letras: «MCANICO» → Mecánico, «PSISCOSOCIAL» → Psicosocial;
 * - un compuesto, por su primera parte que calce: «MECÁNICO / ELÉCTRICO» → Mecánico;
 * - un nombre que empieza con un factor: «ERGONÓMICO FUNCIONAL» → Ergonómico.
 * Lo demás no se sugiere: «Traslado de contenedor» es una tarea escrita en la
 * columna equivocada y elegirle un factor lo decide una persona.
 */
export function suggestRiskFactor(name: string, factors: ReadonlyArray<{ id: string; name: string }>): string | null {
  const catalog = factors.map((factor) => ({ id: factor.id, key: normalizeMiperName(factor.name) }))
  const match = (text: string): string | null => {
    const key = riskFactorKey(text)
    if (key === null) return null
    const exact = catalog.find((factor) => factor.key === key)
    if (exact) return exact.id
    if (key.length < MIN_TYPO_LENGTH) return null
    let best: { id: string; distance: number } | null = null
    for (const factor of catalog) {
      const distance = levenshtein(key, factor.key)
      if (distance <= MAX_TYPO_DISTANCE && (!best || distance < best.distance)) best = { id: factor.id, distance }
    }
    return best?.id ?? null
  }
  const whole = match(name)
  if (whole) return whole
  for (const part of name.split(COMPOUND_SEPARATOR)) {
    const found = match(part)
    if (found) return found
  }
  const firstWord = riskFactorKey(name)?.split(" ")[0] ?? ""
  return firstWord.length >= MIN_TYPO_LENGTH ? catalog.find((factor) => factor.key === firstWord)?.id ?? null : null
}

/** Lo que se necesita de una fila de la vista previa para hablar de su factor. */
type FactorRow = {
  status: string
  riskFactorName: string | null
  issues: ReadonlyArray<{ code: string; excel?: unknown }>
}

/** Un FACTORES DE RIESGO que el catálogo no reconoce, una vez por valor, con cuántas filas lo usan. */
export type UnknownFactor = { key: string; name: string; rows: number }

export function unknownFactorsOf(rows: readonly FactorRow[]): UnknownFactor[] {
  const found = new Map<string, UnknownFactor>()
  for (const row of rows) {
    const issue = row.issues.find((candidate) => candidate.code === "unknown_factor")
    const key = typeof issue?.excel === "string" ? riskFactorKey(issue.excel) : null
    if (!issue || key === null) continue
    const current = found.get(key)
    found.set(key, current ? { ...current, rows: current.rows + 1 } : { key, name: String(issue.excel), rows: 1 })
  }
  return [...found.values()]
}

/** La asignación con que nace la vista previa: el factor parecido, cuando el parecido es claro. */
export function suggestedFactorMapping(rows: readonly FactorRow[], factors: ReadonlyArray<{ id: string; name: string }>): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const factor of unknownFactorsOf(rows)) {
    const suggestion = suggestRiskFactor(factor.name, factors)
    if (suggestion) mapping[factor.key] = suggestion
  }
  return mapping
}

/** ¿La fila espera un factor que no se le asignó? Es la única que, por su factor, no se carga. */
export function waitsForFactor(row: FactorRow, mapping: Readonly<Record<string, string>>): boolean {
  if (row.status !== "needs_review") return false
  const key = riskFactorKey(row.riskFactorName)
  return key === null || !mapping[key]
}
