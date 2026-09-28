import type { ChecklistDefinition, ChecklistItem, FieldKind } from "@/lib/sst/types"
import { EPP_USE_SECTION_ID, eppMatrixRow } from "@/lib/sst/definitions/inspeccion-epp-sections"

/**
 * Un EPP que alguna vez pasó por la bodega de la faena, tenga o no stock hoy.
 *
 * La fila es la **familia** (el EPP sin su talla): el inspector mira si el
 * trabajador usa el casco y en qué estado está, no si es talla M. Un producto
 * sin familia es su propia fila.
 */
export interface WorksiteEppRow {
  /** `fam:<familyId>` o `prd:<productId>`: estable mientras exista el registro. */
  key: string
  label: string
  /** `epp_types.code` (zona corporal) cuando la familia está clasificada. */
  eppTypeCode: string | null
}

/**
 * Casco y arnés protegen de lo que mata (golpe en la cabeza, caída de altura);
 * es la misma gravedad que la plantilla fija daba a casco y chaleco
 * reflectante. El resto queda en `grave`, el piso que ya tenían.
 */
const FATAL_EPP_TYPES = new Set(["cabeza", "caidas"])

function danoPotencialFor(row: WorksiteEppRow): NonNullable<ChecklistItem["danoPotencial"]> {
  return row.eppTypeCode && FATAL_EPP_TYPES.has(row.eppTypeCode) ? "fatal" : "grave"
}

/** Id de fila seguro para `itemId`: los ids de familia/producto pueden traer guiones. */
export function eppRowId(key: string): string {
  return `epp_${key.replace(/[^A-Za-z0-9]+/g, "_")}`
}

export function isEppUseDefinition(definition: ChecklistDefinition | null | undefined): boolean {
  return Array.isArray(definition?.sections) && definition.sections.some((section) => section.id === EPP_USE_SECTION_ID)
}

const USE_SUFFIX = "_uso"
const STATE_SUFFIX = "_estado"

/**
 * Filas respondidas cuyo EPP ya no figura en el historial (producto borrado o
 * reclasificado): se reconstruyen desde la etiqueta guardada en la respuesta
 * para que lo registrado siga visible y siga validando al guardar.
 */
function orphanAnsweredItems(answered: ReadonlyMap<string, string>): ChecklistItem[] {
  const labels = new Map<string, string>()
  for (const [itemId, itemLabel] of answered) {
    if (!itemId.startsWith("epp_")) continue
    const suffix = itemId.endsWith(USE_SUFFIX) ? USE_SUFFIX : itemId.endsWith(STATE_SUFFIX) ? STATE_SUFFIX : null
    if (!suffix) continue
    const rowId = itemId.slice(0, -suffix.length)
    if (!labels.has(rowId)) labels.set(rowId, itemLabel.replace(/: (usa|estado)$/, ""))
  }
  return [...labels].flatMap(([rowId, label]) => eppMatrixRow(rowId, label, "grave"))
}

/**
 * Escala de un ítem de la matriz armado desde la bodega, a partir de su id.
 * La usa quien sólo tiene el snapshot de la plantilla (la exportación), donde
 * esas filas no existen.
 */
export function eppInspectionItemKind(sectionId: string, itemId: string): FieldKind | undefined {
  if (sectionId !== EPP_USE_SECTION_ID || !itemId.startsWith("epp_")) return undefined
  if (itemId.endsWith(USE_SUFFIX)) return "si_no_na_obs"
  if (itemId.endsWith(STATE_SUFFIX)) return "bueno_regular_malo_obs"
  return undefined
}

/** Estados en que el run ya no suma filas nuevas: lo respondido es lo que se firmó. */
const FROZEN_STATUSES = new Set(["completed", "reviewed", "cancelled"])

/**
 * Reemplaza las filas fijas de la matriz de EPP por los EPP que alguna vez
 * estuvieron en la bodega de la faena de la ejecución.
 *
 * - Una fila ya respondida nunca desaparece: si la inspección se respondió con
 *   la lista fija anterior, o el producto dejó de figurar, su respuesta sigue a
 *   la vista y sigue siendo válida al guardar.
 * - Un run ejecutado, revisado o cancelado no gana filas: mostraría como
 *   "sin responder" un EPP que llegó a la bodega después de firmado.
 * - Sin historial de EPP en la faena se conserva la lista fija: una
 *   inspección sin filas no se puede ejecutar.
 */
export function resolveEppInspectionDefinition(
  definition: ChecklistDefinition,
  args: {
    rows: readonly WorksiteEppRow[]
    /** `itemId` → `itemLabel` de las respuestas ya guardadas del run. */
    answered: ReadonlyMap<string, string>
    runStatus: string
  },
): ChecklistDefinition {
  if (!isEppUseDefinition(definition)) return definition
  return {
    ...definition,
    sections: definition.sections.map((section) => {
      if (section.id !== EPP_USE_SECTION_ID) return section
      const answered = args.answered
      const frozen = FROZEN_STATUSES.has(args.runStatus)
      // Sin historial la base es la lista fija completa; con historial, los EPP
      // de la bodega más las filas fijas que el run ya había respondido.
      const base = args.rows.length === 0
        ? section.items
        : [
            ...args.rows.flatMap((row) => eppMatrixRow(eppRowId(row.key), row.label, danoPotencialFor(row))),
            ...section.items.filter((item) => answered.has(item.id)),
          ]
      const seen = new Set<string>()
      const items: ChecklistItem[] = []
      for (const item of [...base, ...orphanAnsweredItems(answered)]) {
        if (seen.has(item.id)) continue
        if (frozen && !answered.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
      }
      // Un run cerrado sin ninguna respuesta en la matriz (p. ej. cancelado
      // antes de empezar) muestra la definición tal cual en vez de quedar vacío.
      if (items.length === 0) return section
      return { ...section, items }
    }),
  }
}
