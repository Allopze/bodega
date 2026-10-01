/**
 * Backfill: completa el rango de tallas de toda familia de calzado (38..46) y de
 * ropa o pantalón (S..3XL), para que Solicitudes pueda ofrecerlas.
 *
 * En esta plataforma la variante es el producto: el selector de talla de
 * Solicitudes (`getSizeVariantPicker`) sólo puede ofrecer las tallas que ya
 * existen como fila de `products`. El catálogo importado dejó cada ítem con la
 * talla o las tallas que traía la planilla —el chaleco geólogo con S y L, la
 * Bota PVC Segusa sólo con 41—, así que pedir otra era imposible aunque
 * `size_catalog` declarara la escala completa.
 *
 * **Agrupa como Solicitudes** (`variantGroupKey`: `family_id`, y el nombre
 * normalizado cuando no hay familia) y no recorriendo `epp_product_families`
 * como el backfill de ropa: el catálogo histórico casi no tiene familia
 * asignada, y completar un grupo distinto del que ve el selector no habilitaría
 * ninguna talla.
 *
 * **Qué escala tiene un grupo.** El backfill de ropa aprendió que el nombre del
 * atributo (`Talla`) no distingue una escala de otra, y exige `size_family`
 * declarado. Acá eso dejaría el backfill inerte —en producción ningún chaleco
 * ni botín lo declara—, así que se aceptan dos señales:
 *
 *  - el atributo de talla declara la familia; o
 *  - el nombre del producto es de un tipo de ítem de esa familia
 *    (`inferEppItemType` + `EPP_TYPE_TO_SIZE_FAMILY`, el vocabulario del
 *    importador) **y** todas sus tallas pertenecen a la escala: numéricas para
 *    calzado, códigos de letra de la familia para ropa y pantalón.
 *
 * Las dos juntas excluyen lo que dañó al de ropa: un guante `N-9` no es calzado
 * ni ropa por nombre, un botín con `Talla: L` no tiene escala numérica, y un
 * chaleco `Única` no está en la escala de letras.
 *
 * Una talla que exista en el grupo —activa **o dada de baja**— cuenta como
 * presente: una variante desactivada a mano es una decisión que este backfill
 * no revierte, igual que `syncSizeCatalog` no reactiva tallas.
 *
 * **Variantes sin talla dentro de un grupo con tallas.** El catálogo importado
 * dejó filas como «Chaleco Geologo Activex» con sólo Color junto a sus hermanas
 * T/L y T/S. `getSizeVariantPicker` no puede ofrecer «Talla» si una variante no
 * tiene, y cae a la lista genérica «Variante». Esas filas se dan de baja
 * (`is_active = false`, nunca DELETE) **sólo si no tienen stock ni historial**,
 * el mismo criterio que `retireDuplicateSizeVariants`; las que sí tienen se
 * informan, porque trasladar stock es una decisión contable.
 *
 * Un grupo entero sin talla (`Botin V-Flex Microfiber` con sólo Modelo y Color)
 * se informa como `unsized` y no se toca: sin saber qué talla es la fila
 * existente, cualquier talla nueva podría duplicarla.
 */
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { products } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { EPP_TYPE_TO_SIZE_FAMILY, inferEppItemType } from "@/lib/products/epp-item-type"
import { normalizeSizeLabel, resolveProductSize } from "@/lib/products/product-size"
import { SIZE_FAMILIES, defaultSizeCodes } from "@/lib/products/size-catalog"
import { variantGroupKey } from "@/lib/products/variant-grouping"
import { countReferences, stockOf } from "./epp-duplicate-size-reconciliation"
import { insertSizeVariantFromTemplate, type SizeVariantTemplate } from "./epp-size-variant-clone"

/** Familias de `size_catalog` cuyo rango completa este backfill. */
export const RANGE_SIZE_FAMILIES = ["calzado", "ropa", "pantalon"] as const
type RangeFamily = (typeof RANGE_SIZE_FAMILIES)[number]

/** Rango que el backfill garantiza por familia: `defaultSizeCodes` del catálogo. */
export function targetSizesFor(family: RangeFamily): readonly string[] {
  const definition = SIZE_FAMILIES.find((candidate) => candidate.family === family)!
  return defaultSizeCodes(definition)
}

function isRangeFamily(family: string | null | undefined): family is RangeFamily {
  return !!family && (RANGE_SIZE_FAMILIES as readonly string[]).includes(family)
}

const NUMERIC_LABEL = /^\d+(\.\d+)?$/

/** ¿La etiqueta (ya normalizada) pertenece a la escala de la familia? */
function fitsScale(family: RangeFamily, normalized: string): boolean {
  if (family === "calzado") return NUMERIC_LABEL.test(normalized)
  const definition = SIZE_FAMILIES.find((candidate) => candidate.family === family)!
  return definition.codes.some((code) => normalizeSizeLabel(code) === normalized)
}

export interface SizeRangeGroupResult {
  /** `family_id`, o el nombre normalizado para el ítem sin familia. */
  groupKey: string
  productName: string
  sizeFamily: RangeFamily
  /**
   * - `created`: se crearon (o, en dry-run, se crearían) las tallas faltantes.
   * - `already_complete`: el grupo ya tiene el rango.
   * - `unsized`: ninguna variante activa declara talla; requiere revisión.
   */
  status: "created" | "already_complete" | "unsized"
  existingSizes: string[]
  createdSizes: string[]
  /** Variantes sin talla del grupo que se dan de baja (sin stock ni historial). */
  retiredUnsized: string[]
  /** Variantes sin talla que se dejan activas porque tienen stock o historial. */
  keptUnsized: Array<{ sku: string; reason: string }>
}

export interface SizeRangeSyncSummary {
  groupsScanned: number
  variantsCreated: number
  variantsRetired: number
  dryRun: boolean
  results: SizeRangeGroupResult[]
}

export interface SizeRangeSyncOptions {
  /** Calcula e informa sin escribir nada. */
  dryRun?: boolean
  /** Quién figura en la auditoría de las bajas. */
  userId?: string | null
}

/**
 * Escribe la talla nueva como ya las escribe el grupo. Si todas las existentes
 * llevan el mismo prefijo delante del código (`N41`, `N42` → `N38`; `T/L`,
 * `T/S` → `T/M`), la nueva lo hereda: el selector muestra la etiqueta guardada
 * y una lista `38 · 39 · N41 · N42` se lee como dos escalas. Con prefijos
 * mezclados o sin prefijo, la forma canónica.
 */
export function labelInGroupStyle(size: string, existingLabels: readonly string[]): string {
  const prefixes = new Set(existingLabels.map((label) => {
    const trimmed = label.trim()
    const canonical = normalizeSizeLabel(trimmed)
    if (!canonical || !trimmed.toUpperCase().endsWith(canonical.toUpperCase())) return null
    return trimmed.slice(0, trimmed.length - canonical.length)
  }))
  if (prefixes.size !== 1) return size
  const [prefix] = prefixes
  return prefix ? `${prefix}${size}` : size
}

type Variant = SizeVariantTemplate

/** Familia de rango del grupo, o `null` si no es un grupo que este backfill complete. */
function classifyGroup(variants: readonly Variant[]): RangeFamily | null {
  const sized = variants.flatMap((variant) => {
    const size = resolveProductSize(variant.productAttributes)
    return size ? [size] : []
  })

  const declared = new Set(sized.map((size) => size.sizeFamily).filter(Boolean))
  let family: RangeFamily | null = null
  if (declared.size > 0) {
    if (declared.size !== 1) return null
    const [only] = declared
    if (!isRangeFamily(only)) return null
    family = only
  } else {
    const type = inferEppItemType(variants[0]!.name)
    const byName = type ? (EPP_TYPE_TO_SIZE_FAMILY as Record<string, string | undefined>)[type] : undefined
    if (!isRangeFamily(byName)) return null
    family = byName
  }

  return sized.every((size) => fitsScale(family, normalizeSizeLabel(size.label))) ? family : null
}

/**
 * Idempotente: volver a correrlo no duplica variantes ni vuelve a dar de baja.
 * Con `dryRun` (el modo del script por omisión) informa exactamente lo que
 * haría: este backfill inventa variantes con SKU y proveedor propios.
 */
export async function completeSizeRanges(
  options: SizeRangeSyncOptions = {},
): Promise<SizeRangeSyncSummary> {
  const dryRun = options.dryRun ?? false

  const catalog = await db.query.products.findMany({
    where: (p, { eq }) => eq(p.isService, false),
    with: {
      productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
      productSuppliers: { orderBy: (ps, { desc }) => [desc(ps.isPreferred)] },
    },
    orderBy: (p, { asc }) => [asc(p.sku)],
  })

  const groups = new Map<string, Variant[]>()
  for (const product of catalog) {
    const key = variantGroupKey(product)
    const bucket = groups.get(key)
    if (bucket) bucket.push(product)
    else groups.set(key, [product])
  }

  const results: SizeRangeGroupResult[] = []
  for (const [groupKey, variants] of groups) {
    // Un grupo dado de baja entero no se pide en Solicitudes: no hay nada que habilitar.
    const active = variants.filter((variant) => variant.isActive)
    if (active.length === 0) continue

    const sizeFamily = classifyGroup(variants)
    if (!sizeFamily) continue

    const sizeOf = (variant: Variant) => resolveProductSize(variant.productAttributes)
    const sizedActive = active.filter((variant) => sizeOf(variant))
    const unsizedActive = active.filter((variant) => !sizeOf(variant))
    const allLabels = variants.flatMap((variant) => sizeOf(variant)?.label ?? [])
    const productName = active[0]!.name
    const base = { groupKey, productName, sizeFamily, existingSizes: [...new Set(allLabels)] }

    const template = sizedActive[0]
    if (!template) {
      results.push({ ...base, status: "unsized", createdSizes: [], retiredUnsized: [], keptUnsized: [] })
      continue
    }

    // Variantes sin talla junto a hermanas con talla: rompen el selector.
    const retiredUnsized: Variant[] = []
    const keptUnsized: SizeRangeGroupResult["keptUnsized"] = []
    for (const variant of unsizedActive) {
      const [stock, references] = [await stockOf(variant.id), await countReferences(variant.id)]
      if (stock === 0 && references.total === 0) retiredUnsized.push(variant)
      else {
        const parts = [
          stock !== 0 ? `stock ${stock}` : null,
          ...Object.entries(references.detail).map(([ref, n]) => `${ref}: ${n}`),
        ].filter(Boolean)
        keptUnsized.push({ sku: variant.sku, reason: parts.join(", ") })
      }
    }

    const present = new Set(allLabels.map((label) => normalizeSizeLabel(label)))
    const missing = targetSizesFor(sizeFamily).filter((size) => !present.has(normalizeSizeLabel(size)))
    const activeLabels = sizedActive.map((variant) => sizeOf(variant)!.label)
    const createdSizes = missing.map((size) => labelInGroupStyle(size, activeLabels))

    if (!dryRun && (createdSizes.length > 0 || retiredUnsized.length > 0)) {
      const templateSize = sizeOf(template)!
      const templateSizeAttr = template.productAttributes.find(
        (attr) => normalizeAttributeName(attr.name) === normalizeAttributeName(templateSize.attributeName),
      )!
      await db.transaction(async (tx) => {
        for (const size of createdSizes) {
          await insertSizeVariantFromTemplate(tx, {
            template,
            templateSizeAttr,
            size,
            sizeFamily,
            isActive: true,
          })
        }
        if (retiredUnsized.length > 0) {
          await tx.update(products).set({ isActive: false }).where(inArray(products.id, retiredUnsized.map((v) => v.id)))
          for (const variant of retiredUnsized) {
            await recordAudit({
              userId: options.userId ?? null,
              action: "update",
              entityType: "product",
              entityId: variant.id,
              entityCode: variant.sku,
              oldState: { isActive: true },
              newState: { isActive: false },
              reason: `Variante sin talla en «${productName}», cuyas hermanas sí la tienen: impedía elegir talla en Solicitudes. Sin stock ni historial.`,
            }, tx)
          }
        }
      })
    }

    results.push({
      ...base,
      status: createdSizes.length > 0 ? "created" : "already_complete",
      createdSizes,
      retiredUnsized: retiredUnsized.map((variant) => variant.sku),
      keptUnsized,
    })
  }

  return {
    groupsScanned: groups.size,
    variantsCreated: results.reduce((sum, result) => sum + result.createdSizes.length, 0),
    variantsRetired: results.reduce((sum, result) => sum + result.retiredUnsized.length, 0),
    dryRun,
    results,
  }
}
