import { z } from "zod"
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

export const PROVIDER_MAPPINGS = ["none", "copec_tct", "copec_tae", "aramco"] as const
export type ProviderMapping = (typeof PROVIDER_MAPPINGS)[number]

export const PROVIDER_MAPPING_LABELS: Record<ProviderMapping, string> = {
  none: "Sin lectura automática",
  copec_tct: "Copec · tarjeta TCT",
  copec_tae: "Copec · TAE",
  aramco: "Aramco",
}

export function providerMappingToColumns(mapping: ProviderMapping): { providerCode: "copec" | "aramco" | null; providerChannel: "TCT" | "TAE" | null } {
  switch (mapping) {
    case "copec_tct": return { providerCode: "copec", providerChannel: "TCT" }
    case "copec_tae": return { providerCode: "copec", providerChannel: "TAE" }
    case "aramco": return { providerCode: "aramco", providerChannel: null }
    default: return { providerCode: null, providerChannel: null }
  }
}

export function providerMappingFromColumns(providerCode: string | null | undefined, providerChannel: string | null | undefined): ProviderMapping {
  if (providerCode === "aramco") return "aramco"
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

/** Texto de progreso: «50 de 130 equipos». */
export function recomputeProgressLabel(processed: number, total: number): string {
  return `${processed} de ${total} ${total === 1 ? "equipo" : "equipos"}`
}
