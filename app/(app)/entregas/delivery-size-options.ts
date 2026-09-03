import {
  compareSizeLabels,
  normalizeSizeLabel,
  suggestedWorkerSize,
  type WorkerSizes,
} from "@/lib/products/product-size"
import { variantGroupKey } from "@/lib/products/variant-grouping"
import type { DeliveryStockProductOption } from "./delivery-form.types"

/**
 * Agrupa el stock de una bodega en familia → talla, que es la decisión que toma
 * el bodeguero: primero *qué* entrega, después *cuál* de las tallas que hay.
 *
 * El stock sigue siendo por variante (`productId`) y el formulario sigue
 * enviando `productId`: esto sólo reorganiza para elegir. Se separó del
 * componente porque el orden de las tallas y el cruce con la talla habitual son
 * las dos partes que tienen que estar probadas.
 */

export interface DeliverySizeChoice {
  productId: string
  /** `null` en una variante sin talla: no se inventa una etiqueta. */
  sizeLabel: string | null
  stockQuantity: number
  unitOfMeasure: string
  isEpp: boolean
  productName: string
  productSku: string | null
  /** Coincide con la talla habitual del trabajador. Sugiere, no restringe. */
  isHabitual: boolean
}

export interface DeliveryStockGroup {
  key: string
  /** Nombre de la familia, o del producto cuando el catálogo no la declara. */
  label: string
  totalStock: number
  unitOfMeasure: string
  /**
   * Nombre del atributo de talla («Talla calzado»), o `null` cuando ninguna
   * variante del grupo usa talla: entonces no se pide talla.
   */
  sizeAttributeName: string | null
  choices: DeliverySizeChoice[]
  /** Talla habitual del trabajador para este atributo, si el padrón la tiene. */
  habitualSize: string | null
  /** La talla habitual no está entre las que tienen stock en esta bodega. */
  habitualSizeMissing: boolean
}

function compareChoices(left: DeliverySizeChoice, right: DeliverySizeChoice): number {
  // Una variante sin talla dentro de un grupo con tallas es una anomalía de
  // catálogo. Va al final, pero se muestra: esconderla ocultaría stock real.
  if (left.sizeLabel == null) return right.sizeLabel == null ? 0 : 1
  if (right.sizeLabel == null) return -1
  return compareSizeLabels(left.sizeLabel, right.sizeLabel)
}

export function buildDeliveryStockGroups(
  products: readonly DeliveryStockProductOption[],
  worker?: WorkerSizes | null,
): DeliveryStockGroup[] {
  const groups = new Map<string, DeliveryStockGroup>()

  for (const product of products) {
    const key = variantGroupKey({ name: product.productName, familyId: product.familyId })
    const choice: DeliverySizeChoice = {
      productId: product.productId,
      sizeLabel: product.sizeLabel,
      stockQuantity: product.stockQuantity,
      unitOfMeasure: product.unitOfMeasure,
      isEpp: product.isEpp,
      productName: product.productName,
      productSku: product.productSku,
      isHabitual: false,
    }

    const existing = groups.get(key)
    if (existing) {
      existing.choices.push(choice)
      existing.totalStock += product.stockQuantity
      existing.sizeAttributeName ??= product.sizeAttributeName
      continue
    }

    groups.set(key, {
      key,
      // El nombre de la familia es el mismo para todas las variantes; el del
      // producto sólo se usa cuando el catálogo no declara familia, y en ese
      // caso las variantes se agruparon justamente por compartirlo.
      label: product.familyName ?? product.productName,
      totalStock: product.stockQuantity,
      unitOfMeasure: product.unitOfMeasure,
      sizeAttributeName: product.sizeAttributeName,
      choices: [choice],
      habitualSize: null,
      habitualSizeMissing: false,
    })
  }

  const result = [...groups.values()]
  for (const group of result) {
    group.choices.sort(compareChoices)

    if (!group.sizeAttributeName) continue
    const habitual = suggestedWorkerSize(group.sizeAttributeName, worker)
    if (!habitual) continue

    group.habitualSize = habitual
    let matched = false
    for (const choice of group.choices) {
      if (choice.sizeLabel && normalizeSizeLabel(choice.sizeLabel) === habitual) {
        choice.isHabitual = true
        matched = true
      }
    }
    group.habitualSizeMissing = !matched
  }

  return result.sort((left, right) => left.label.localeCompare(right.label, "es-CL"))
}

/** Un grupo pide talla sólo si alguna de sus variantes la declara. */
export function requiresSizeChoice(group: DeliveryStockGroup | undefined): boolean {
  return Boolean(group?.sizeAttributeName)
}
