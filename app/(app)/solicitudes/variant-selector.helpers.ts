import type { ProductOption } from "./request-form.types"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import {
  compareSizeLabels,
  isSizeAttributeName,
  normalizeSizeLabel,
  resolveProductSize,
} from "@/lib/products/product-size"
import { resolveVariantAttributes } from "@/lib/products/variant-grouping"

export interface VariantAxisChoice {
  /** Valor normalizado: dos escrituras de lo mismo (`42` y `42.0`) son uno. */
  value: string
  label: string
}

/** Una decisión de quien pide: la talla, el color, el modelo… */
export interface VariantAxis {
  key: string
  attributeName: string
  choices: VariantAxisChoice[]
  /** Valor de la variante elegida, o `null` si no está entre las opciones. */
  selected: string | null
}

export const SIZE_AXIS_KEY = "talla"

/**
 * Valor de una variante que no declara el atributo que sí declaran sus
 * hermanas. No puede ser `""`: Radix no acepta un `SelectItem` con valor vacío.
 */
const UNSPECIFIED_VALUE = "__sin-especificar__"
const UNSPECIFIED_LABEL = "Sin especificar"

interface AxisValue { key: string; label: string }

interface VariantFacts {
  variant: ProductOption
  size: (AxisValue & { attributeName: string }) | null
  /** Atributos de un solo valor que no son talla, por nombre normalizado. */
  values: Map<string, AxisValue & { attributeName: string }>
}

interface AxisDefinition {
  key: string
  attributeName: string
  valueOf: (facts: VariantFacts) => AxisValue | null
}

interface VariantModel {
  facts: VariantFacts[]
  /** Variantes que se pueden ofrecer: con talla, si la familia usa talla. */
  eligible: VariantFacts[]
  axes: AxisDefinition[]
}

function factsOf(variant: ProductOption): VariantFacts {
  const size = resolveProductSize(variant.attributes)
  const values = new Map<string, AxisValue & { attributeName: string }>()
  for (const attribute of resolveVariantAttributes(variant.attributes)) {
    if (isSizeAttributeName(attribute.name)) continue
    const key = normalizeAttributeName(attribute.name)
    if (!key || values.has(key)) continue
    values.set(key, { key: normalizeAttributeName(attribute.value), label: attribute.value.trim(), attributeName: attribute.name.trim() })
  }
  return {
    variant,
    size: size ? { key: normalizeSizeLabel(size.label), label: size.label, attributeName: size.attributeName } : null,
    values,
  }
}

/**
 * Una familia se guarda como una fila de catálogo por combinación (talla ×
 * color × …). Esto la convierte en las decisiones que toma quien pide: un eje
 * por atributo que de verdad varía dentro de la familia.
 *
 * Antes sólo existía el eje de talla, y dos variantes de la misma talla se
 * trataban como un duplicado de catálogo. El importador quita el color del
 * nombre y la familia se identifica sin él, así que «Botín negro 42» y «Botín
 * café 42» son la misma familia: la talla 42 apuntaba a la de SKU menor y el
 * otro color no se podía pedir.
 */
function buildVariantModel(variants: ProductOption[]): VariantModel | null {
  if (variants.length < 2) return null
  const facts = variants.map(factsOf)

  // Una variante sin talla dentro de una familia con tallas es una fila
  // histórica del importador («Chaleco Geologo» con sólo Color junto a sus
  // hermanas T/L y T/S). No se le puede ofrecer una talla que no tiene, y no se
  // da de baja desde acá porque suele tener historial (ver `epp-size-ranges`).
  const sized = facts.filter((fact) => fact.size)
  const eligible = sized.length > 0 ? sized : facts
  const axes: AxisDefinition[] = []

  if (sized.length > 0) {
    // `resolveProductSize` sólo devuelve atributos para los que
    // `isSizeAttributeName` es verdadero, así que todos comparten el eje de
    // talla aunque el nombre difiera: una familia re-importada fila por fila
    // queda con `Talla guantes` en la variante nueva y `Talla` (legacy) en el
    // resto. Se muestra el nombre más específico cuando hay uno.
    const attributeName = sized.find((fact) => normalizeAttributeName(fact.size!.attributeName) !== "talla")?.size!.attributeName
      ?? sized[0]!.size!.attributeName
    // La talla se ofrece aunque sea una sola: es la decisión que quien pide
    // espera tomar, y la familia ya se presentaba así.
    axes.push({ key: SIZE_AXIS_KEY, attributeName, valueOf: (fact) => fact.size })
  }

  // Nombre normalizado → nombre como lo escribe la primera variante que lo trae.
  const otherAttributes = new Map<string, string>()
  for (const fact of eligible) {
    for (const [key, value] of fact.values) if (!otherAttributes.has(key)) otherAttributes.set(key, value.attributeName)
  }
  for (const [key, attributeName] of otherAttributes) {
    const valueOf = (fact: VariantFacts): AxisValue =>
      fact.values.get(key) ?? { key: UNSPECIFIED_VALUE, label: UNSPECIFIED_LABEL }
    // Un atributo igual en todas (`Logo: Con logo`) no es una decisión.
    if (new Set(eligible.map((fact) => valueOf(fact).key)).size < 2) continue
    axes.push({ key, attributeName, valueOf })
  }

  return axes.length > 0 ? { facts, eligible, axes } : null
}

function compareChoices(axisKey: string, left: VariantAxisChoice, right: VariantAxisChoice): number {
  if (axisKey === SIZE_AXIS_KEY) return compareSizeLabels(left.label, right.label)
  if ((left.value === UNSPECIFIED_VALUE) !== (right.value === UNSPECIFIED_VALUE)) {
    return left.value === UNSPECIFIED_VALUE ? 1 : -1
  }
  return left.label.localeCompare(right.label, "es-CL")
}

const bySku = (left: VariantFacts, right: VariantFacts) => left.variant.sku.localeCompare(right.variant.sku, "es-CL")

/**
 * La candidata que más conserva de la variante actual, dando prioridad a los
 * primeros ejes: cambiar la talla no debe cambiar el color si el color existe
 * en la talla nueva. Entre candidatas indistinguibles (un duplicado de catálogo
 * como `42` y `42.0`) se queda en la actual y si no, en la de SKU menor: estable
 * entre cargas, y la limpieza del duplicado sigue siendo de catálogo
 * (`retireDuplicateSizeVariants`, unificaciones con historial).
 */
function rankCandidates(model: VariantModel, current: VariantFacts | undefined, candidates: VariantFacts[]) {
  const score = (fact: VariantFacts) => model.axes.map((axis) =>
    current != null && axis.valueOf(fact)?.key === axis.valueOf(current)?.key)
  return [...candidates].sort((left, right) => {
    const leftScore = score(left)
    const rightScore = score(right)
    for (let index = 0; index < leftScore.length; index++) {
      if (leftScore[index] !== rightScore[index]) return leftScore[index] ? -1 : 1
    }
    if ((left.variant.id === current?.variant.id) !== (right.variant.id === current?.variant.id)) {
      return left.variant.id === current?.variant.id ? -1 : 1
    }
    return bySku(left, right)
  })
}

/**
 * Ejes de la familia con las opciones de cada uno. Las opciones de un eje son
 * las que existen dado lo elegido en los anteriores: sólo se ofrecen los
 * colores que hay en la talla elegida. `null` cuando ningún atributo distingue
 * las variantes; el selector cae entonces a la lista por SKU.
 */
export function getVariantAxes(variants: ProductOption[], selectedId: string): VariantAxis[] | null {
  const model = buildVariantModel(variants)
  if (!model) return null
  const current = model.facts.find((fact) => fact.variant.id === selectedId)

  let pool = model.eligible
  return model.axes.map((axis) => {
    const labels = new Map<string, string>()
    for (const fact of [...pool].sort(bySku)) {
      const value = axis.valueOf(fact)
      if (value && !labels.has(value.key)) labels.set(value.key, value.label)
    }
    const choices = [...labels]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compareChoices(axis.key, left, right))

    const currentValue = current ? axis.valueOf(current)?.key ?? null : null
    const selected = currentValue != null && labels.has(currentValue) ? currentValue : null
    if (selected != null) pool = pool.filter((fact) => axis.valueOf(fact)?.key === selected)

    return { key: axis.key, attributeName: axis.attributeName, choices, selected }
  })
}

/** Variante que resulta de elegir `value` en el eje `axisKey`. */
export function resolveVariantForChoice(
  variants: ProductOption[],
  selectedId: string,
  axisKey: string,
  value: string,
): string | null {
  const model = buildVariantModel(variants)
  const axis = model?.axes.find((candidate) => candidate.key === axisKey)
  if (!model || !axis) return null
  const current = model.facts.find((fact) => fact.variant.id === selectedId)
  const candidates = model.eligible.filter((fact) => axis.valueOf(fact)?.key === value)
  return rankCandidates(model, current, candidates)[0]?.variant.id ?? null
}

/**
 * Entre `candidates` (p. ej. las variantes en la talla habitual del
 * colaborador), la que conserva lo que ya estaba elegido en los demás ejes.
 */
export function closestVariant(
  variants: ProductOption[],
  currentId: string,
  candidates: ProductOption[],
): ProductOption | null {
  if (candidates.length === 0) return null
  const model = buildVariantModel(variants)
  if (!model) return candidates[0]!
  const ids = new Set(candidates.map((candidate) => candidate.id))
  const current = model.facts.find((fact) => fact.variant.id === currentId)
  return rankCandidates(model, current, model.facts.filter((fact) => ids.has(fact.variant.id)))[0]?.variant ?? null
}
