import { z } from "zod"
import { KNOWN_RULE_CODES } from "@/lib/combustibles/validation"
import { PERFORMANCE_FAMILIES, type PerformanceFamily, type SupplyMediumKind } from "./contracts"

/**
 * Lógica pura de la configuración del control: validación (zod), normalización
 * de textos y mapeo del proveedor. Sin acceso a base de datos ni a la sesión, de
 * modo que lo usan por igual las acciones del servidor, los formularios y las
 * pruebas. Ver GAP_MODULO_COMBUSTIBLE.md §3 (catálogos) y §5.
 */

// ── Números con coma decimal ─────────────────────────────────────────────────

/**
 * Lee un decimal escrito a la chilena. Acepta "2,5", "2.5", " 2,50 " y números.
 * Con coma, todo punto es separador de miles ("1.234,5"); sin coma, el punto
 * es decimal. Devuelve `null` si no es un número finito.
 */
export function parseDecimalInput(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(/\s/g, "")
  if (!cleaned) return null
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const decimal = (label: string) =>
  z.preprocess(
    (value) => parseDecimalInput(value) ?? Number.NaN,
    z.number({ error: `${label}: escribe un número` }).refine(Number.isFinite, `${label}: escribe un número`),
  )

// ── Texto ────────────────────────────────────────────────────────────────────

/** Slug estable para un nombre ("Surtidor CMPC" → "surtidor-cmpc"). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "medio"
}

/** Primer slug libre: `base`, `base-2`, `base-3`… */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base.slice(0, 60)}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 50)}-${Date.now()}`
}

/** Clave para comparar nombres sin importar mayúsculas, tildes ni espacios repetidos. */
export function nameKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
}

const ALIAS_MAX_LENGTH = 80
const ALIAS_MAX_COUNT = 30

/**
 * Alias con que un medio aparece en las planillas («Suministro entregado por»).
 * Se guardan en MAYÚSCULAS, con espacios colapsados, sin vacíos ni repetidos.
 * Acepta una lista separada por comas o saltos de línea.
 */
export function normalizeAliases(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? raw.split(/[,\n;]/) : raw
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of parts) {
    const alias = part.replace(/\s+/g, " ").trim().toLocaleUpperCase("es-CL")
    if (!alias || seen.has(alias)) continue
    seen.add(alias)
    result.push(alias)
  }
  return result
}

// ── Mapeo al libro de proveedores ────────────────────────────────────────────

export const PROVIDER_MAPPINGS = ["none", "copec_tct", "copec_tae"] as const
export type ProviderMapping = (typeof PROVIDER_MAPPINGS)[number]

export const PROVIDER_MAPPING_LABELS: Record<ProviderMapping, string> = {
  none: "No: se importa por archivo",
  copec_tct: "Copec · tarjeta de equipos",
  copec_tae: "Copec · tarjeta de abastecimiento",
}

export function providerMappingToColumns(mapping: ProviderMapping): { providerCode: "copec" | null; providerChannel: "TCT" | "TAE" | null } {
  switch (mapping) {
    case "copec_tct": return { providerCode: "copec", providerChannel: "TCT" }
    case "copec_tae": return { providerCode: "copec", providerChannel: "TAE" }
    default: return { providerCode: null, providerChannel: null }
  }
}

export function providerMappingFromColumns(providerCode: string | null | undefined, providerChannel: string | null | undefined): ProviderMapping {
  if (providerCode === "copec") return providerChannel === "TAE" ? "copec_tae" : providerChannel === "TCT" ? "copec_tct" : "none"
  return "none"
}

// ── Mandantes ────────────────────────────────────────────────────────────────

export const mandanteInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(120, "Máximo 120 caracteres"),
  clientId: z.string().min(1).nullable().default(null),
  tolerancePct: decimal("Tolerancia").pipe(z.number().min(0, "La tolerancia no puede ser negativa").max(100, "La tolerancia no puede superar 100 %")),
  isActive: z.boolean().default(true),
  worksiteIds: z.array(z.string().min(1)).max(500).default([]),
  /** El usuario aceptó mover faenas que hoy pertenecen a otro mandante. */
  confirmMove: z.boolean().default(false),
}).transform((value) => ({
  ...value,
  tolerancePct: Math.round(value.tolerancePct * 100) / 100,
  worksiteIds: [...new Set(value.worksiteIds)],
}))
export type MandanteInput = z.input<typeof mandanteInputSchema>
export type MandanteData = z.output<typeof mandanteInputSchema>

export const toggleActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean() })

// ── Medios de suministro ─────────────────────────────────────────────────────

export const SUPPLY_MEDIUM_KINDS = ["card", "provider_station", "mandante_dispenser", "own_tank", "other"] as const satisfies readonly SupplyMediumKind[]

export const supplyMediumInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(80, "Máximo 80 caracteres"),
  kind: z.enum(SUPPLY_MEDIUM_KINDS, { error: "Elige el tipo de medio" }),
  fuelSupplierId: z.string().min(1).nullable().default(null),
  providerMapping: z.enum(PROVIDER_MAPPINGS).default("none"),
  /** Texto libre separado por comas; se normaliza en `normalizeAliases`. */
  aliases: z.string().max(2000, "Demasiados alias").default(""),
  sortOrder: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? 0 : parseDecimalInput(value) ?? Number.NaN),
    z.number({ error: "El orden debe ser un número" }).int("El orden debe ser un número entero").min(0).max(10000),
  ),
  isActive: z.boolean().default(true),
}).transform((value, ctx) => {
  const aliases = normalizeAliases(value.aliases)
  if (aliases.length > ALIAS_MAX_COUNT) {
    ctx.addIssue({ code: "custom", path: ["aliases"], message: `Máximo ${ALIAS_MAX_COUNT} alias` })
  }
  if (aliases.some((alias) => alias.length > ALIAS_MAX_LENGTH)) {
    ctx.addIssue({ code: "custom", path: ["aliases"], message: `Cada alias admite hasta ${ALIAS_MAX_LENGTH} caracteres` })
  }
  return { ...value, aliases, ...providerMappingToColumns(value.providerMapping) }
})
export type SupplyMediumInput = z.input<typeof supplyMediumInputSchema>
export type SupplyMediumData = z.output<typeof supplyMediumInputSchema>

/** Alias de `aliases` ya usados por otro medio (para no dejar una planilla ambigua). */
export function findAliasConflicts(aliases: readonly string[], others: ReadonlyArray<{ id: string; name: string; aliases: readonly string[] }>, selfId?: string): Array<{ alias: string; mediumName: string }> {
  const conflicts: Array<{ alias: string; mediumName: string }> = []
  for (const alias of aliases) {
    const owner = others.find((medium) => medium.id !== selfId && medium.aliases.includes(alias))
    if (owner) conflicts.push({ alias, mediumName: owner.name })
  }
  return conflicts
}

// ── Familias de equipos ──────────────────────────────────────────────────────

/** `null` = «Fuera de las vistas de rendimiento». */
export const equipmentFamilyInputSchema = z.object({
  equipmentTypeId: z.string().min(1),
  family: z.enum(PERFORMANCE_FAMILIES).nullable(),
})
export type EquipmentFamilyInput = { equipmentTypeId: string; family: PerformanceFamily | null }

// ── Umbrales ─────────────────────────────────────────────────────────────────

/**
 * Parte editable de `PerformanceControlSettings`. `thresholdStdDevs` no está:
 * sale de la regla de anomalías `rendimiento_fuera_historico` y se muestra de
 * solo lectura en la pantalla.
 */
export const performanceThresholdsSchema = z.object({
  minSamples: decimal("Muestras mínimas").pipe(z.number().int("Usa un número entero").min(2, "Mínimo 2 cargas").max(100, "Máximo 100 cargas")),
  maxKmPerLiter: decimal("Máximo km/L").pipe(z.number().gt(0, "Debe ser mayor que 0").max(200, "Máximo 200 km/L")),
  maxLitersPerHour: decimal("Máximo L/h").pipe(z.number().gt(0, "Debe ser mayor que 0").max(2000, "Máximo 2.000 L/h")),
  duplicateWindowMinutes: decimal("Ventana de duplicados").pipe(z.number().int("Usa un número entero").min(1, "Mínimo 1 minuto").max(1440, "Máximo 1.440 minutos (24 horas)")),
  duplicateLitersTolerance: decimal("Tolerancia de litros").pipe(z.number().min(0, "No puede ser negativa").max(100, "Máximo 100 L")),
})
export type PerformanceThresholdsInput = z.input<typeof performanceThresholdsSchema>
export type PerformanceThresholdsData = z.output<typeof performanceThresholdsSchema>

// ── Recálculo de series ──────────────────────────────────────────────────────

/** Equipos que se recalculan por solicitud: mantiene cada petición corta. */
export const RECOMPUTE_BATCH_SIZE = 25

export const recomputeInputSchema = z.object({
  /** Último equipo procesado; el siguiente lote parte después de él. */
  cursor: z.string().min(1).nullable().default(null),
})

/** Estado de las marcas de las cargas de un lote de equipos: revisión y una firma de lo que el recálculo puede mover. */
export type MarkSnapshot = Map<string, { reviewStatus: string; signature: string }>

/**
 * Cuenta qué cambió entre la foto de marcas de antes y la de después de recalcular:
 * cargas que cambiaron, las que pasaron a «Por decidir» y las que dejaron de estarlo.
 */
export function diffMarkSnapshots(before: MarkSnapshot, after: MarkSnapshot): { changedLoads: number; flagged: number; released: number } {
  let changedLoads = 0
  let flagged = 0
  let released = 0
  for (const [id, next] of after) {
    const previous = before.get(id)
    if (!previous || previous.signature === next.signature) continue
    changedLoads += 1
    if (previous.reviewStatus !== "flagged" && next.reviewStatus === "flagged") flagged += 1
    if (previous.reviewStatus === "flagged" && next.reviewStatus !== "flagged") released += 1
  }
  return { changedLoads, flagged, released }
}

/** Texto de progreso: «50 de 130 equipos». */
export function recomputeProgressLabel(processed: number, total: number): string {
  return `${processed} de ${total} ${total === 1 ? "equipo" : "equipos"}`
}

// ── Reglas de detección: parámetros en palabras ──────────────────────────────

/**
 * Cada regla de detección guarda sus umbrales en un JSON (`config`). Para que
 * quien administra no tenga que escribirlo a mano, los parámetros que el motor
 * entiende se ofrecen como campos con su unidad y se describen en una frase
 * («Avisa si un equipo carga 3 veces o más en 2 horas»). El JSON completo sigue
 * disponible en «Avanzado» para lo que no tiene campo (p. ej. las excepciones
 * por tipo de equipo).
 *
 * Todo es puro: lo usan la tabla, el formulario, la acción del servidor y las
 * pruebas. Las claves y los valores por omisión replican los lectores de
 * `lib/combustibles/anomaly-detector.ts` (`thresholdStdDevsOf`, `marginOf`, …).
 */

export interface RuleParameter {
  /** Clave en el JSON de configuración de la regla. */
  key: string
  /** Rótulo del campo, con su unidad cuando no se deduce: «Margen sobre la capacidad (%)». */
  label: string
  /** Valor que aplica el motor cuando la regla no lo define (en la unidad mostrada). */
  defaultValue: number
  min: number
  max: number
  step: number
  integer?: boolean
  /**
   * El JSON guarda `mostrado / displayFactor`: el margen sobre la capacidad se
   * guarda como 0,05 y se escribe como 5 %.
   */
  displayFactor?: number
  helper: string
}

const PARAM_STD_DEVS: RuleParameter = {
  key: "thresholdStdDevs", label: "Veces su variación normal", defaultValue: 2, min: 0.5, max: 10, step: 0.5,
  helper: "Entre 0,5 y 10. Más alto avisa menos. En «Rendimiento fuera del historial» es el mismo valor que usa el control de cargas.",
}
const PARAM_MIN_SAMPLE: RuleParameter = {
  key: "minSample", label: "Cargas previas mínimas", defaultValue: 5, min: 3, max: 1000, step: 1, integer: true,
  helper: "Con menos cargas, la regla no compara contra el historial. Mínimo 3.",
}

export const RULE_PARAMETERS: Readonly<Record<string, readonly RuleParameter[]>> = {
  rendimiento_fuera_historico: [PARAM_STD_DEVS, PARAM_MIN_SAMPLE],
  rendimiento_fuera_grupo: [
    { ...PARAM_STD_DEVS, helper: "Entre 0,5 y 10. Más alto avisa menos." },
    PARAM_MIN_SAMPLE,
  ],
  litros_supera_capacidad: [
    { key: "margin", label: "Margen sobre la capacidad (%)", defaultValue: 5, min: 0, max: 100, step: 1, displayFactor: 100, helper: "Cuántos litros de más se toleran antes de avisar (de 0 a 100 %)." },
  ],
  variacion_brusca_consumo: [
    { key: "thresholdPct", label: "Variación del consumo (%)", defaultValue: 50, min: 1, max: 1000, step: 1, helper: "Cuánto debe cambiar el consumo del período respecto del anterior (desde 1 %)." },
  ],
  exceso_cargas_ventana: [
    { key: "maxLoads", label: "Cargas dentro de la ventana", defaultValue: 3, min: 1, max: 50, step: 1, integer: true, helper: "Con esta cantidad de cargas o más dentro de la ventana, se avisa." },
    { key: "windowHours", label: "Ventana de tiempo (horas)", defaultValue: 2, min: 1, max: 720, step: 1, integer: true, helper: "Horas hacia atrás que se miran (desde 1)." },
  ],
  salto_medidor_implausible: [
    { key: "maxKmPerDay", label: "Avance máximo del odómetro (km por día)", defaultValue: 1500, min: 1, max: 100000, step: 100, integer: true, helper: "Sobre esto entre dos cargas, la lectura es implausible." },
    { key: "maxHoursPerDay", label: "Avance máximo del horómetro (horas por día)", defaultValue: 24, min: 1, max: 24, step: 1, helper: "Un motor no acumula más de 24 horas por día." },
  ],
}

/** Reglas que el motor evalúa por lotes y que admiten acotar las filas por corrida (`batchRowLimit`). */
export const BATCH_RULE_CODES = [
  "litros_supera_capacidad", "variacion_brusca_consumo", "consumo_durante_inactividad", "evidencia_duplicada",
  "evidencia_ilegible", "proveedor_no_habitual", "rendimiento_fuera_historico", "rendimiento_fuera_grupo",
  "kilometraje_regresivo", "horometro_regresivo", "salto_medidor_implausible",
] as const

export const BATCH_ROW_LIMIT_PARAMETER: RuleParameter = {
  key: "batchRowLimit", label: "Filas que se revisan por corrida", defaultValue: 50000, min: 100, max: 1_000_000, step: 100, integer: true,
  helper: "Freno técnico del escaneo diario. Mínimo 100; déjalo vacío para usar el valor del sistema.",
}

export function isBatchRuleCode(code: string): boolean {
  return (BATCH_RULE_CODES as readonly string[]).includes(code)
}

const NO_PARAMETERS: readonly RuleParameter[] = []

/** Parámetros con campo propio para una regla (vacío si no tiene o el código no es del catálogo). */
export function ruleParametersFor(code: string): readonly RuleParameter[] {
  return RULE_PARAMETERS[code] ?? NO_PARAMETERS
}

/** Lee el JSON de una regla. `null` si no es JSON o no es un objeto: nunca se reemplaza en silencio por `{}`. */
export function parseRuleConfig(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw === null || raw === undefined || !raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

const roundDisplay = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * Número entero escrito a la chilena: «1.500» son mil quinientos, no uno coma
 * cinco. `parseDecimalInput` toma el punto sin coma como decimal, lo que en un
 * campo de enteros (filas por corrida, km por día) divide el valor por mil.
 */
function parseWholeNumberInput(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "")
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) return Number(cleaned.replace(/\./g, ""))
  return parseDecimalInput(cleaned)
}

/** Valor de un parámetro en la unidad que se muestra, o `undefined` si la regla no lo define. */
export function ruleParameterValue(parameter: RuleParameter, config: Record<string, unknown>): number | undefined {
  const stored = config[parameter.key]
  if (typeof stored !== "number" || !Number.isFinite(stored)) return undefined
  return roundDisplay(stored * (parameter.displayFactor ?? 1))
}

/**
 * Aplica los valores escritos en los campos sobre el JSON de la regla. Un campo
 * vacío quita la clave (vuelve al valor del sistema). Devuelve los errores por
 * clave de parámetro y deja intacto todo lo que el formulario no conoce
 * (excepciones por tipo de equipo, claves propias).
 */
export function mergeRuleParameters(
  parameters: readonly RuleParameter[],
  base: Record<string, unknown>,
  raw: Readonly<Record<string, string | null | undefined>>,
): { config: Record<string, unknown>; errors: Record<string, string> } {
  const config = { ...base }
  const errors: Record<string, string> = {}
  for (const parameter of parameters) {
    const text = raw[parameter.key]
    if (text === undefined || text === null) continue
    if (!text.trim()) { delete config[parameter.key]; continue }
    const value = parameter.integer ? parseWholeNumberInput(text) : parseDecimalInput(text)
    if (value === null) { errors[parameter.key] = `${parameter.label}: escribe un número`; continue }
    if (parameter.integer && !Number.isInteger(value)) { errors[parameter.key] = `${parameter.label}: usa un número entero`; continue }
    if (value < parameter.min || value > parameter.max) {
      errors[parameter.key] = `${parameter.label}: debe estar entre ${formatRuleNumber(parameter.min)} y ${formatRuleNumber(parameter.max)}`
      continue
    }
    config[parameter.key] = roundDisplay(value / (parameter.displayFactor ?? 1))
  }
  return { config, errors }
}

const ruleNumberFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 })
const formatRuleNumber = (value: number) => ruleNumberFormat.format(value)

const EVIDENCE_KIND_WORDS: Record<string, string> = {
  odometer: "el tablero (odómetro u horómetro)",
  liter_meter: "el contador de litros",
  removed_seal: "el sello retirado",
  installed_seal: "el sello instalado",
}

const plural = (count: number, one: string, many: string) => `${formatRuleNumber(count)} ${count === 1 ? one : many}`

/**
 * «Cuándo se activa» una regla, en una frase. Para una regla sin parámetros
 * dice que salta cada vez que ocurre; para una con parámetros usa el valor
 * configurado o, si no lo define, el que aplica el motor.
 */
export function describeRuleTrigger(code: string, rawConfig: string | null | undefined): string {
  const config = parseRuleConfig(rawConfig)
  if (config === null) return "La configuración no se puede leer: revisa el JSON en «Avanzado»."
  const value = (key: string) => {
    const parameter = ruleParametersFor(code).find((item) => item.key === key)
    if (!parameter) return 0
    return ruleParameterValue(parameter, config) ?? parameter.defaultValue
  }
  const typeOverrides = config["equipmentTypes"]
  const exceptions = typeOverrides && typeof typeOverrides === "object" && !Array.isArray(typeOverrides) ? Object.keys(typeOverrides).length : 0
  const suffix = exceptions > 0 ? ` Con excepciones para ${plural(exceptions, "tipo de equipo", "tipos de equipo")}.` : ""

  switch (code) {
    case "rendimiento_fuera_historico":
      return `Avisa si el rendimiento se aleja más de ${formatRuleNumber(value("thresholdStdDevs"))} veces su variación normal, con al menos ${plural(value("minSample"), "carga previa", "cargas previas")} del equipo.${suffix}`
    case "rendimiento_fuera_grupo":
      return `Avisa si el rendimiento se aleja más de ${formatRuleNumber(value("thresholdStdDevs"))} veces la variación normal de los equipos comparables, con al menos ${plural(value("minSample"), "carga", "cargas")}.${suffix}`
    case "litros_supera_capacidad":
      return `Avisa si una carga supera la capacidad del estanque en más de ${formatRuleNumber(value("margin"))} %.${suffix}`
    case "variacion_brusca_consumo":
      return `Avisa si el consumo del período varía más de ${formatRuleNumber(value("thresholdPct"))} % respecto del anterior.${suffix}`
    case "exceso_cargas_ventana":
      return `Avisa si un equipo carga ${plural(value("maxLoads"), "vez", "veces")} o más en ${plural(value("windowHours"), "hora", "horas")}.${suffix}`
    case "salto_medidor_implausible":
      return `Avisa si el medidor avanza más de ${formatRuleNumber(value("maxKmPerDay"))} km (o ${formatRuleNumber(value("maxHoursPerDay"))} horas) por día entre dos cargas.${suffix}`
    case "evidencia_faltante": {
      const kinds = Array.isArray(config["requiredKinds"]) ? config["requiredKinds"].filter((kind): kind is string => typeof kind === "string") : []
      if (kinds.length === 0) return "Avisa si la carga en terreno no trae todas las fotos exigidas."
      return `Avisa si la carga en terreno no trae la foto de ${kinds.map((kind) => EVIDENCE_KIND_WORDS[kind] ?? kind).join(", ")}.`
    }
    case "carga_fuera_horario":
      return "Según el horario de operación de la ficha de cada equipo."
    default:
      return KNOWN_RULE_CODE_SET.has(code) ? "Siempre que ocurre." : "Código desconocido para el motor: la regla no se evalúa."
  }
}

const KNOWN_RULE_CODE_SET: ReadonlySet<string> = new Set<string>(KNOWN_RULE_CODES)

/** ¿El motor de detección reconoce este código? Una regla con otro código queda inerte. */
export function isKnownRuleCode(code: string): boolean {
  return KNOWN_RULE_CODE_SET.has(code)
}

/** Lo que dejó un recálculo de series: equipos recorridos y cargas que cambiaron. */
export interface RecomputeSummary {
  equipment: number
  changedLoads: number
  flagged: number
  released: number
  /** El recálculo se detuvo antes de recorrer todos los equipos. */
  stopped: boolean
}

const countFormat = new Intl.NumberFormat("es-CL")

/** «Se recalcularon 130 equipos. 12 cargas cambiaron: 9 pasaron a «Por decidir» y 3 dejaron de estarlo.» */
export function recomputeSummaryText(summary: RecomputeSummary): string {
  const equipment = `${countFormat.format(summary.equipment)} ${summary.equipment === 1 ? "equipo" : "equipos"}`
  const head = summary.stopped ? `Recálculo detenido tras ${equipment}.` : `Se recalcularon ${equipment}.`
  if (summary.changedLoads === 0) return `${head} Ninguna carga cambió.`
  const loads = `${countFormat.format(summary.changedLoads)} ${summary.changedLoads === 1 ? "carga cambió" : "cargas cambiaron"}`
  const parts: string[] = []
  if (summary.flagged > 0) parts.push(`${countFormat.format(summary.flagged)} ${summary.flagged === 1 ? "pasó" : "pasaron"} a «Por decidir»`)
  if (summary.released > 0) parts.push(`${countFormat.format(summary.released)} ${summary.released === 1 ? "dejó" : "dejaron"} de estarlo`)
  return `${head} ${loads}${parts.length ? `: ${parts.join(" y ")}` : ""}.`
}
