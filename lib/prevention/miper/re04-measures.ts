/**
 * Medidas del RE-04 en la importación (Fase C, spec §8). Puro: no toca la base
 * ni el reloj (el «hoy» lo pasa quien llama).
 *
 * - Las medidas salen SIEMPRE de `original["MEDIDA DE CONTROL"]`: la celda tal
 *   como vino del Excel, guardada en la fila del lote, con los saltos de línea
 *   que `normalized.measures` aplana. Así un lote preparado antes de la Fase C
 *   sirve sin versionar el parser.
 * - Cada frase distinta (`normalizeMeasure`) se decide una vez: su tipo I–V. Cada
 *   valor distinto de RESPONSABLE y de PLAZOS (`normalizeMiperName`), también
 *   una vez (D6).
 * - La vista previa y la carga calculan esto con la misma función y desde las
 *   mismas filas del lote. La carga rechaza un mapeo al que le falten claves o
 *   que traiga claves que el lote no tiene (`mappingProblems`).
 */
import { addDaysToPlainDate, countOf } from "@/lib/utils"
import { normalizeMeasure } from "./dedup"
import { cleanMiperName, normalizeMiperName } from "./names"
import type { Re04ColumnLabel } from "./re04-import"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "./snapshot"

/** Largo máximo de una medida: el de `miperControlSaveSchema.values.description`. */
export const MEASURE_MAX_LENGTH = 3000
/** Largo máximo de una frecuencia de verificación: el de `deadlineDecisionSchema` y `verificationFrequency`. */
export const FREQUENCY_MAX_LENGTH = 120
/** Largo máximo de un responsable escrito: el de `responsibleDecisionSchema` y `responsibleName`. */
export const RESPONSIBLE_MAX_LENGTH = 300

const MEASURE_COLUMN: Re04ColumnLabel = "MEDIDA DE CONTROL"
const RESPONSIBLE_COLUMN: Re04ColumnLabel = "RESPONSABLE"
const DEADLINE_COLUMN: Re04ColumnLabel = "PLAZOS"

/**
 * `prefix`: el «IV. Controles administrativos:» ROTULADO que escribe el libro que
 * exporta la plataforma; ese tipo viene confirmado. `numeral`: un romano suelto
 * («I. USAR CASCO»), que alguien pudo escribir a mano: se sugiere ese tipo y lo
 * confirma una persona, como el de una palabra clave (spec §8).
 */
export type HierarchySource = "prefix" | "numeral" | "keyword" | "default"
export type HierarchySuggestion = { hierarchy: ControlHierarchy; source: HierarchySource }
/**
 * `line`: la línea de la celda de la que salió la pieza, contada sobre las líneas
 * no vacías y ANTES de descartar repetidas y restos. Es la que alinea la medida
 * con su RESPONSABLE y su PLAZOS en el libro exportado.
 * `prefix`: el tipo del «I.–V.» de la línea; `labeled`, si venía rotulado
 * («IV. Controles administrativos:») y no como un romano suelto («IV.»).
 */
export type MeasurePiece = { text: string; key: string; prefix: ControlHierarchy | null; labeled: boolean; line: number }
export type ResponsibleDecision = { kind: "user"; userId: string } | { kind: "text"; name: string } | { kind: "none" }
export type DeadlineDecision = { kind: "existing"; frequency: string | null } | { kind: "pending"; dueDate: string | null }
export type DeadlineSource = "existing" | "date" | "relative" | "immediate" | "frequency" | "default"
export type ImportRowInput = { rowNumber: number; status: string; original: unknown }
export type ResponsibleUser = { id: string; name: string }
export type ImportMeasure = { rowNumber: number; text: string; phraseKey: string; prefix: ControlHierarchy | null; labeled: boolean; responsibleKey: string; deadlineKey: string }
export type PhraseGroup = { key: string; text: string; count: number; suggestion: HierarchySuggestion }
export type ValueGroup<D> = { key: string; text: string | null; count: number; suggestion: D }
export type MeasureAnalysis = {
  /** En el orden de las filas y, dentro de cada fila, en el del Excel. */
  measures: ImportMeasure[]
  phrases: PhraseGroup[]
  responsibles: ValueGroup<ResponsibleDecision>[]
  deadlines: ValueGroup<DeadlineDecision>[]
}
export type ImportMappings = {
  measureMapping: Record<string, ControlHierarchy>
  responsibleMapping: Record<string, ResponsibleDecision>
  deadlineMapping: Record<string, DeadlineDecision>
}

/** La importación deja las celdas en texto, número o booleano (`cellValue`). */
function cellText(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

/** Las líneas de una celda, limpias y sin las blancas del final; una blanca en medio queda como "". */
function rawCellLines(cell: unknown): string[] {
  const text = cellText(cell)
  if (text === null) return []
  const lines = text.split(/\r?\n/).map((raw) => cleanMiperName(raw) ?? "")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

/** Las líneas no vacías de una celda, limpias. Su índice es el `line` de cada medida. */
function cellLines(cell: unknown): string[] {
  return rawCellLines(cell).filter((line) => line !== "")
}

/* ── Separar las medidas de una celda ───────────────────────────────────── */

const ROMAN: Record<string, ControlHierarchy> = { I: "elimination", II: "substitution", III: "engineering", IV: "administrative", V: "ppe" }
const BARE_PREFIX = /^(IV|V|I{1,3})\.\s+/u
/** «IV. Controles administrativos:», como escribe cada medida el libro que exporta la plataforma. */
const LABELED_PREFIXES = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>)
  .map(([hierarchy, label]) => ({ hierarchy, prefix: `${label}:`.toLocaleLowerCase("es-CL") }))
/** «…BIOLÓGICOS.PARTICIPAR…»: dos medidas pegadas por un punto sin espacio. No corta «E.P.P.» ni «D.S. 594». */
const GLUED_SENTENCE = /(?<=\p{L}{3})\.(?=\p{Lu}\p{L}{2})/u
/** Viñetas y puntuación sobrantes en los bordes de una medida. */
const EDGE_PUNCTUATION = /^[\s.,;:\-–—•*]+|[\s.,;:\-–—•*]+$/gu

function prefixOf(line: string): { hierarchy: ControlHierarchy; labeled: boolean; rest: string } | null {
  const lower = line.toLocaleLowerCase("es-CL")
  for (const { hierarchy, prefix } of LABELED_PREFIXES) {
    if (lower.startsWith(prefix)) return { hierarchy, labeled: true, rest: line.slice(prefix.length) }
  }
  const bare = BARE_PREFIX.exec(line)
  return bare ? { hierarchy: ROMAN[bare[1]!]!, labeled: false, rest: line.slice(bare[0].length) } : null
}

const DIGIT = /^\p{Nd}$/u

/**
 * Corta por `separator` fuera de paréntesis o corchetes: «EPP (CASCO, GUANTES)»
 * queda entero. Una coma entre dos dígitos es decimal y tampoco corta: «DISTANCIA
 * MÍNIMA DE 1,5 METROS» es una medida, no «…DE 1» y «5 METROS».
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  const chars = Array.from(text)
  let depth = 0
  let current = ""
  for (const [index, char] of chars.entries()) {
    if (char === "(" || char === "[") depth += 1
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1
    const decimal = char === "," && DIGIT.test(chars[index - 1] ?? "") && DIGIT.test(chars[index + 1] ?? "")
    if (depth === 0 && char === separator && !decimal) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * Las medidas de una celda «MEDIDA DE CONTROL»:
 * - cada salto de línea separa;
 * - una línea con «I.–V.» (libro exportado) es UNA medida y trae su tipo;
 * - en las demás, «;» si la línea tiene alguno —sus comas enumeran dentro de una
 *   medida: «VERIFICAR CARGA MÁXIMA, DISTRIBUCIÓN, HERMETICIDAD; …»— y si no,
 *   las comas de primer nivel que no son decimales («1,5 METROS»);
 * - después, el «.X» pegado.
 * Se descartan los restos de menos de 3 caracteres y la misma frase repetida en
 * la celda (queda la primera, con su línea).
 */
export function splitMeasures(cell: unknown): MeasurePiece[] {
  const pieces: MeasurePiece[] = []
  const seen = new Set<string>()
  const push = (raw: string, prefix: ControlHierarchy | null, labeled: boolean, line: number) => {
    const cleaned = (cleanMiperName(raw) ?? "").replace(EDGE_PUNCTUATION, "").slice(0, MEASURE_MAX_LENGTH)
    const key = normalizeMeasure(cleaned)
    if (cleaned.length < 3 || key === "" || seen.has(key)) return
    seen.add(key)
    pieces.push({ text: cleaned, key, prefix, labeled, line })
  }
  cellLines(cell).forEach((line, index) => {
    const prefixed = prefixOf(line)
    if (prefixed) {
      push(prefixed.rest, prefixed.hierarchy, prefixed.labeled, index)
      return
    }
    const bySemicolon = splitTopLevel(line, ";")
    const parts = bySemicolon.length > 1 ? bySemicolon : splitTopLevel(line, ",")
    for (const part of parts) for (const piece of part.split(GLUED_SENTENCE)) push(piece, null, false, index)
  })
  return pieces
}

/* ── Tipo sugerido ──────────────────────────────────────────────────────── */

/**
 * Palabras clave (sin tildes, minúsculas) por tipo, en orden de prioridad para el
 * empate. Manda la que aparece PRIMERO en la frase: «PROCEDIMIENTOS DE BLOQUEO»
 * es IV y «USO DE BARANDAS» es III. Se buscan como comienzo de palabra
 * («guante» calza «guantes»); «no » lleva su espacio para no calzar «normas».
 */
const KEYWORDS: ReadonlyArray<readonly [ControlHierarchy, readonly string[]]> = [
  ["elimination", ["eliminar", "eliminacion", "suprimir"]],
  ["substitution", ["sustituir", "sustitucion", "reemplazar", "reemplazo"]],
  ["engineering", [
    "baranda", "barrera", "resguardo", "enclavamiento", "bloqueo", "loto", "mantencion", "mantenimiento", "demarcacion", "delimitar",
    "aislacion", "puesta a tierra", "ventilacion", "extraccion", "pantalla", "proteccion de maquina", "sistema de seguridad",
    "sistemas de seguridad", "soporte", "ayuda mecanica", "ayudas mecanicas", "alarma", "instalar", "instalacion", "sombra",
    "extintor", "asiento", "escala", "piso",
  ]],
  ["ppe", [
    "epp", "elementos de proteccion personal", "elemento de proteccion personal", "guante", "casco", "calzado", "bota", "lente",
    "antiparra", "mascarilla", "respirador", "protector auditivo", "protectores auditivos", "tapon", "protector ocular", "chaleco",
    "arnes", "careta", "faja", "bloqueador", "legionario", "sombrero", "ropa", "overol", "traje", "zapato", "barbiquejo",
  ]],
  ["administrative", [
    "capacitacion", "capacitar", "procedimiento", "senalizacion", "senalizar", "senaletica", "inspeccion", "inspeccionar", "revision",
    "revisar", "supervision", "supervisar", "pausa", "rotacion", "charla", "induccion", "orden y limpieza", "control de", "controlar",
    "verificar", "verificacion", "planificar", "planificacion", "prohibir", "prohibido", "prohibicion", "respetar", "permiso de trabajo",
    "checklist", "protocolo", "programa", "vigia", "medicion", "higiene", "lavado", "desinfeccion", "vacunacion", "inoculacion",
    "comunicacion", "comunicar", "reportar", "reporte", "autoevaluacion", "ergonomia", "hidratacion", "gestion", "horario", "jornada",
    "turno", "instructivo", "evitar", "no ", "distancia", "transitar", "conducir", "operar", "fomentar", "suspender", "detener",
    "asegurar", "postura", "elongacion", "clima",
  ]],
]
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const KEYWORD_RULES = KEYWORDS.map(([hierarchy, words]) => ({
  hierarchy,
  pattern: new RegExp(`(^|[^\\p{L}])(?:${words.map(escapeRegExp).join("|")})`, "u"),
}))
/** «USO DE …» sin otra pista es EPP (spec §8). */
const USE_OF = /^uso(?: \p{L}+)? de\b/u

/**
 * El tipo que se sugiere. El «I.–V.» manda: rotulado, viene confirmado (`prefix`);
 * suelto, es sólo una sugerencia (`numeral`). Sin pista: IV, marcado `default`
 * para que la persona lo mire.
 */
export function inferHierarchy(piece: { text: string; prefix?: ControlHierarchy | null; labeled?: boolean }): HierarchySuggestion {
  if (piece.prefix) return { hierarchy: piece.prefix, source: piece.labeled ? "prefix" : "numeral" }
  const text = normalizeMiperName(piece.text)
  let best: { hierarchy: ControlHierarchy; position: number } | null = null
  for (const rule of KEYWORD_RULES) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    const position = match.index + match[1]!.length
    if (!best || position < best.position) best = { hierarchy: rule.hierarchy, position }
  }
  if (best) return { hierarchy: best.hierarchy, source: "keyword" }
  if (USE_OF.test(text)) return { hierarchy: "ppe", source: "keyword" }
  return { hierarchy: "administrative", source: "default" }
}

/* ── Plazo y responsable sugeridos ──────────────────────────────────────── */

/**
 * Cómo escribe el libro exportado una medida existente en PLAZOS: «Existente ·
 * Trimestral», o «Existente» si no tiene frecuencia. Sin la palabra, una
 * existente sin frecuencia salía «—» y una frecuencia como «Al inicio del turno»
 * no se distinguía de un plazo: al volver a importar el libro, las dos quedaban
 * por implementar y sin fecha.
 */
const EXISTING_LABEL = "Existente"
/** «existente» al comienzo, como palabra entera (sobre el texto ya normalizado): «EXISTENTES EN BODEGA» no lo es. */
const EXISTING_DEADLINE = /^existente(?![\p{L}\p{N}])/u
const LEADING_WORD = /^[\p{L}\p{M}]+/u
const LEADING_SEPARATOR = /^[\s·:\-–—]+/u

/** El texto de PLAZOS de una medida existente en el libro exportado (`deadlineSuggestion` lo lee de vuelta). */
export function existingDeadlineText(frequency: string | null | undefined): string {
  const cleaned = cleanMiperName(frequency)
  return cleaned ? `${EXISTING_LABEL} · ${cleaned}` : EXISTING_LABEL
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
/**
 * «EN 30 DÍAS» o «PLAZO DE 15 DÍAS» (sobre el texto ya sin tildes). Pide el «en»
 * o el «de»: «CADA 30 DÍAS» es una frecuencia, no un plazo.
 */
const IN_DAYS = /\b(?:en|de) (\d{1,3}) dias?\b/
/**
 * «AL OCURRIR» / «INMEDIATO AL OCURRIR»: una medida de contingencia que ya existe
 * (un kit de derrames) y se aplica cuando pasa el evento. Va antes de «inmediato».
 */
const ON_OCCURRENCE = /\bal ocurrir\b/
const ON_OCCURRENCE_FREQUENCY = "Al ocurrir"
const IMMEDIATE = /\binmediat/
const FREQUENCY = /\b(diari[oa]s?|semanal(es)?|quincenal(es)?|mensual(es)?|bimestral(es)?|trimestral(es)?|cuatrimestral(es)?|semestral(es)?|anual(es)?|permanente|continu[oa]|periodic[oa]|cada|siempre)\b/

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * D6: lo que sugiere un valor de PLAZOS. Primero, lo que escribe el libro
 * exportado: «Existente · frecuencia» o «Existente» → existente, con lo que sigue
 * como frecuencia (o sin ella), aunque parezca un plazo. Una fecha → por
 * implementar con esa fecha; «en N días» o «de N días» → hoy + N (antes que la frecuencia:
 * «IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO», «PLAZO DE 15 DÍAS»; «CADA 30 DÍAS»
 * no lleva «en» ni «de» y es frecuencia);
 * «al ocurrir» → existente, con frecuencia «Al ocurrir» (antes que «inmediato»:
 * «INMEDIATO AL OCURRIR» es una contingencia que ya existe); «inmediato» → por
 * implementar hoy («INMEDIATO / ANTES DE CONTINUAR LA TAREA»); una frecuencia
 * («TRIMESTRAL», «ANTES DE CADA OPERACIÓN», «CADA 30 DÍAS») → existente, con ese
 * texto como frecuencia de verificación. Sin pista o vacío → por implementar,
 * sin fecha.
 */
export function deadlineSuggestion(text: string | null, today: string): { decision: DeadlineDecision; source: DeadlineSource } {
  const cleaned = cleanMiperName(text)
  if (cleaned === null) return { decision: { kind: "pending", dueDate: null }, source: "default" }
  const key = normalizeMiperName(cleaned)
  if (EXISTING_DEADLINE.test(key)) {
    const frequency = cleanMiperName(cleaned.replace(LEADING_WORD, "").replace(LEADING_SEPARATOR, ""))
    return { decision: { kind: "existing", frequency: frequency?.slice(0, FREQUENCY_MAX_LENGTH) ?? null }, source: "existing" }
  }
  const iso = ISO_DATE.exec(cleaned)
  const local = LOCAL_DATE.exec(cleaned)
  const date = iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : local ? calendarDate(Number(local[3]), Number(local[2]), Number(local[1])) : null
  if (date) return { decision: { kind: "pending", dueDate: date }, source: "date" }
  const days = IN_DAYS.exec(key)
  if (days) return { decision: { kind: "pending", dueDate: addDaysToPlainDate(today, Number(days[1])) }, source: "relative" }
  if (ON_OCCURRENCE.test(key)) return { decision: { kind: "existing", frequency: ON_OCCURRENCE_FREQUENCY }, source: "frequency" }
  if (IMMEDIATE.test(key)) return { decision: { kind: "pending", dueDate: today }, source: "immediate" }
  if (FREQUENCY.test(key)) return { decision: { kind: "existing", frequency: cleaned.slice(0, FREQUENCY_MAX_LENGTH) }, source: "frequency" }
  return { decision: { kind: "pending", dueDate: null }, source: "default" }
}

/** Por defecto, el responsable tal como lo escribe el Excel; si es exactamente el nombre de una persona elegible, esa persona. */
export function responsibleSuggestion(text: string | null, users: readonly ResponsibleUser[]): ResponsibleDecision {
  const cleaned = cleanMiperName(text)
  if (cleaned === null) return { kind: "none" }
  const key = normalizeMiperName(cleaned)
  const user = users.find((candidate) => normalizeMiperName(candidate.name) === key)
  return user ? { kind: "user", userId: user.id } : { kind: "text", name: cleaned.slice(0, RESPONSIBLE_MAX_LENGTH) }
}

/* ── Análisis del lote ──────────────────────────────────────────────────── */

const EMPTY_MARK = /^[—–-]$/u

const blankIfEmptyMark = (value: string) => (EMPTY_MARK.test(value) ? "" : value)

/** Las líneas de la celda MEDIDA: cuántas hay en crudo y en cuál de ellas está cada `line` (no vacía). */
type MeasureLayout = { rawCount: number; rawIndexOf: readonly number[] }

function measureLayout(cell: unknown): MeasureLayout {
  const raw = rawCellLines(cell)
  return { rawCount: raw.length, rawIndexOf: raw.flatMap((line, index) => (line === "" ? [] : [index])) }
}

/**
 * El valor de RESPONSABLE o PLAZOS de cada medida de la fila. El libro que
 * exporta la plataforma escribe UNA LÍNEA POR MEDIDA en las tres columnas (y cada
 * medida con su «I.–V.»): ahí cada medida toma la línea que le corresponde, y
 * «—» o una línea en blanco es «vacío». Se cuentan líneas de MEDIDA, no medidas:
 * la frase repetida en la fila toma los valores de su primera línea y el resto
 * de menos de 3 caracteres consume la suya, sin correr las demás. En orden:
 * 1. tantas líneas crudas como MEDIDA (sin contar las blancas del final): se
 *    alinea por línea cruda, y la blanca es «vacío»;
 * 2. si no, tantas líneas no vacías como MEDIDA: se alinea por línea no vacía;
 * 3. si no (o si la celda MEDIDA no trae «I.–V.»), la celda entera vale para
 *    todas las medidas de la fila.
 */
function valuesPerMeasure(cell: unknown, pieces: readonly MeasurePiece[], layout: MeasureLayout): string[] {
  if (pieces.every((piece) => piece.prefix !== null)) {
    const raw = rawCellLines(cell)
    if (raw.length === layout.rawCount) return pieces.map((piece) => blankIfEmptyMark(raw[layout.rawIndexOf[piece.line] ?? -1] ?? ""))
    const nonEmpty = raw.filter((line) => line !== "")
    if (nonEmpty.length === layout.rawIndexOf.length) return pieces.map((piece) => blankIfEmptyMark(nonEmpty[piece.line] ?? ""))
  }
  const whole = cleanMiperName(cellText(cell)) ?? ""
  return pieces.map(() => blankIfEmptyMark(whole))
}

const byCountThenText = (a: { count: number; text: string | null }, b: { count: number; text: string | null }) =>
  b.count - a.count || (a.text ?? "").localeCompare(b.text ?? "", "es")

/**
 * Las frases distintas, por frecuencia. Si alguna aparición trae «I.–V.», la
 * frase toma ese tipo: el de la primera rotulada y, si ninguna lo está, el del
 * primer romano suelto.
 */
export function distinctPhrases(measures: ReadonlyArray<Pick<ImportMeasure, "text" | "phraseKey" | "prefix" | "labeled">>): PhraseGroup[] {
  const groups = new Map<string, { text: string; count: number; prefix: ControlHierarchy | null; labeled: boolean }>()
  for (const measure of measures) {
    const group = groups.get(measure.phraseKey)
    if (!group) {
      groups.set(measure.phraseKey, { text: measure.text, count: 1, prefix: measure.prefix, labeled: measure.labeled })
      continue
    }
    group.count += 1
    if (measure.prefix && (group.prefix === null || (measure.labeled && !group.labeled))) {
      group.prefix = measure.prefix
      group.labeled = measure.labeled
    }
  }
  return [...groups].map(([key, group]) => ({ key, text: group.text, count: group.count, suggestion: inferHierarchy(group) })).sort(byCountThenText)
}

function groupValues<D>(measures: readonly ImportMeasure[], field: "responsibleKey" | "deadlineKey", texts: ReadonlyMap<string, string | null>, suggest: (text: string | null) => D): ValueGroup<D>[] {
  const counts = new Map<string, number>()
  for (const measure of measures) counts.set(measure[field], (counts.get(measure[field]) ?? 0) + 1)
  return [...counts].map(([key, count]) => {
    const text = texts.get(key) ?? null
    return { key, text, count, suggestion: suggest(text) }
  }).sort(byCountThenText)
}

/**
 * Las medidas del lote y lo que hay que decidir. Las filas `rejected` (P o C
 * fuera de la escala) nunca se cargan y no piden decisiones; las
 * `needs_review` sí, porque se cargan si el factor existe al confirmar.
 */
export function analyzeRe04Measures(rows: readonly ImportRowInput[], options: { today: string; users?: readonly ResponsibleUser[] }): MeasureAnalysis {
  const measures: ImportMeasure[] = []
  const responsibleTexts = new Map<string, string | null>()
  const deadlineTexts = new Map<string, string | null>()
  for (const row of rows) {
    if (row.status === "rejected") continue
    const original = (row.original ?? {}) as Partial<Record<Re04ColumnLabel, unknown>>
    const pieces = splitMeasures(original[MEASURE_COLUMN])
    if (pieces.length === 0) continue
    const layout = measureLayout(original[MEASURE_COLUMN])
    const responsibles = valuesPerMeasure(original[RESPONSIBLE_COLUMN], pieces, layout)
    const deadlines = valuesPerMeasure(original[DEADLINE_COLUMN], pieces, layout)
    pieces.forEach((piece, index) => {
      const responsible = responsibles[index] ?? ""
      const deadline = deadlines[index] ?? ""
      const responsibleKey = normalizeMiperName(responsible)
      const deadlineKey = normalizeMiperName(deadline)
      if (!responsibleTexts.has(responsibleKey)) responsibleTexts.set(responsibleKey, responsible || null)
      if (!deadlineTexts.has(deadlineKey)) deadlineTexts.set(deadlineKey, deadline || null)
      measures.push({ rowNumber: row.rowNumber, text: piece.text, phraseKey: piece.key, prefix: piece.prefix, labeled: piece.labeled, responsibleKey, deadlineKey })
    })
  }
  return {
    measures,
    phrases: distinctPhrases(measures),
    responsibles: groupValues(measures, "responsibleKey", responsibleTexts, (text) => responsibleSuggestion(text, options.users ?? [])),
    deadlines: groupValues(measures, "deadlineKey", deadlineTexts, (text) => deadlineSuggestion(text, options.today).decision),
  }
}

/** Las sugerencias como mapeo: es lo que hace «Aceptar sugerencias» sin cambios. */
export function suggestedMappings(analysis: MeasureAnalysis): ImportMappings {
  return {
    measureMapping: Object.fromEntries(analysis.phrases.map((phrase) => [phrase.key, phrase.suggestion.hierarchy])),
    responsibleMapping: Object.fromEntries(analysis.responsibles.map((group) => [group.key, group.suggestion])),
    deadlineMapping: Object.fromEntries(analysis.deadlines.map((group) => [group.key, group.suggestion])),
  }
}

/**
 * Lo que impide aplicar un mapeo al lote, en palabras de la persona. Vacío = se
 * puede aplicar. Falta una clave: la persona no decidió algo que el lote trae.
 * Sobra una clave: la decisión es de otro archivo (otra vista previa) o de un
 * cliente adulterado. En los dos casos se rechaza entero, antes de escribir.
 */
export function mappingProblems(analysis: MeasureAnalysis, mappings: ImportMappings): string[] {
  const missing: string[] = []
  let extra = 0
  const check = (expected: ReadonlyArray<{ key: string }>, given: Readonly<Record<string, unknown>>, describe: (count: number) => string) => {
    const keys = new Set(expected.map((group) => group.key))
    const absent = [...keys].filter((key) => !Object.hasOwn(given, key)).length
    if (absent > 0) missing.push(describe(absent))
    extra += Object.keys(given).filter((key) => !keys.has(key)).length
  }
  check(analysis.phrases, mappings.measureMapping, (count) => `el tipo de ${countOf(count, "medida")}`)
  check(analysis.responsibles, mappings.responsibleMapping, (count) => `el responsable de ${countOf(count, "valor")}`)
  check(analysis.deadlines, mappings.deadlineMapping, (count) => `el plazo de ${countOf(count, "valor")}`)
  const problems: string[] = []
  if (missing.length > 0) {
    const list = missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join(", ")} y ${missing.at(-1)!}`
    problems.push(`La importación no coincide con la vista previa: falta decidir ${list}.`)
  }
  if (extra > 0) problems.push(`La importación trae decisiones para ${countOf(extra, "valor")} que el archivo no tiene.`)
  if (problems.length > 0) problems.push("Vuelve a revisar el archivo.")
  return problems
}
