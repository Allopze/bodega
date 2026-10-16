/**
 * Backfill: deja `Logo: Con logo` en toda prenda EPP que lo lleva y en sus
 * solicitudes todavía abiertas. Diseño: docs/superpowers/specs/2026-10-15-epp-con-logo-design.md §4.5.
 *
 * Hasta ahora el logo se anotaba de forma dispareja: `Modelo: Con logo` (72
 * productos), `Modelo: Con logo Chome` (7) o nada. La regla de elegibilidad y
 * de normalización es **una sola** (`requiresLogo` / `applyLogoRule`); este
 * servicio sólo persiste su resultado.
 *
 * **Catálogo.** Una fila existente que cambia se renombra en el lugar (UPDATE
 * por id): `request_item_attributes.attribute_id` apunta a ella sin cascada, así
 * que borrar y recrear dejaría huérfanas las solicitudes que la usan.
 *
 * **Ítems de solicitud.** Sólo los que aún no tienen OC (`requested`,
 * `approved`, `pending_purchase`). Desde `in_purchase_order` el ítem es la
 * instantánea de un documento emitido y no se toca. Hay un índice único
 * `(request_item_id, attribute_name)`: un `Modelo` se convierte en `Logo` sólo si
 * el ítem no tiene ya uno.
 *
 * **Duplicados por talla.** Anotar el logo hace coincidir variantes que antes se
 * distinguían (camisa H2600 «Con logo» frente a «H2600»). No se unifican aquí:
 * se informan para pasarlos por la herramienta de unificación existente.
 *
 * Idempotente. Con `dryRun` calcula exactamente lo mismo y no escribe nada.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { productAttributes, products, purchaseRequestItems, requestItemAttributes } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import {
  LOGO_ATTRIBUTE_NAME, LOGO_VALUE, applyLogoRule, requiresLogo,
} from "@/lib/products/epp-logo"
import { normalizeSizeLabel, resolveProductSize } from "@/lib/products/product-size"
import { variantGroupKey } from "@/lib/products/variant-grouping"

/** Estados de ítem que todavía no tienen OC. */
export const OPEN_ITEM_STATUSES = ["requested", "approved", "pending_purchase"] as const

export interface LogoBackfillOptions {
  /** Calcula e informa sin escribir nada. */
  dryRun?: boolean
  /** Quién figura en la auditoría. */
  userId?: string | null
}

export type LogoProductAction = "renamed" | "inserted" | "normalized"

export interface LogoProductResult {
  sku: string
  name: string
  action: LogoProductAction
}

export interface LogoDuplicateSize {
  /** `family_id`, o el nombre normalizado para el producto sin familia. */
  groupKey: string
  productName: string
  size: string
  skus: string[]
}

export interface LogoBackfillSummary {
  dryRun: boolean
  catalog: {
    eligibleProducts: number
    renamed: number
    inserted: number
    /** Ya tenían exactamente `Logo: Con logo`. */
    alreadyOk: number
  }
  requestItems: {
    updated: number
    inserted: number
    alreadyOk: number
  }
  products: LogoProductResult[]
  /** Variantes que quedan con la misma talla dentro del mismo grupo. Para unificar a mano. */
  duplicateSizes: LogoDuplicateSize[]
}

type AttributeRow = typeof productAttributes.$inferSelect

const isNamed = (rowName: string, name: string) => normalizeAttributeName(rowName) === normalizeAttributeName(name)
const isConLogo = (value: string) => /^con logo\b/.test(normalizeAttributeName(value))

export async function backfillEppLogo(options: LogoBackfillOptions = {}): Promise<LogoBackfillSummary> {
  const dryRun = options.dryRun ?? false
  const userId = options.userId ?? null

  return db.transaction(async (tx) => {
    const eppProducts = await tx.query.products.findMany({
      where: eq(products.isEpp, true),
      with: { productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] } },
      orderBy: (p, { asc }) => [asc(p.sku)],
    })
    const eligible = eppProducts.filter((product) => requiresLogo(product))

    const summary: LogoBackfillSummary = {
      dryRun,
      catalog: { eligibleProducts: eligible.length, renamed: 0, inserted: 0, alreadyOk: 0 },
      requestItems: { updated: 0, inserted: 0, alreadyOk: 0 },
      products: [],
      duplicateSizes: [],
    }

    // ── 1. Catálogo ────────────────────────────────────────────────────────
    /** Atributos de cada producto elegible después de aplicar la regla. */
    const attributesAfter = new Map<string, AttributeRow[]>()
    /** `id` del atributo Logo de cada producto elegible (el existente o el nuevo). */
    const logoIdOf = new Map<string, string>()

    for (const product of eligible) {
      const before = product.productAttributes
      const after = applyLogoRule(product, before, (seed) => ({
        id: nanoid(), productId: product.id, categoryId: null, sizeFamily: null, drivesQuantity: false, ...seed,
      }))
      attributesAfter.set(product.id, after)

      const beforeById = new Map(before.map((row) => [row.id, row]))
      let action: LogoProductAction | null = null
      for (const row of after) {
        const previous = beforeById.get(row.id)
        if (!previous) {
          action = "inserted"
          if (!dryRun) await tx.insert(productAttributes).values(row)
        } else if (previous.name !== row.name || previous.type !== row.type || previous.options !== row.options) {
          // Renombrar y no borrar: la FK de `request_item_attributes` apunta a esta fila.
          action ??= isNamed(previous.name, LOGO_ATTRIBUTE_NAME) ? "normalized" : "renamed"
          if (!dryRun) {
            await tx.update(productAttributes)
              .set({ name: row.name, type: row.type, options: row.options })
              .where(eq(productAttributes.id, row.id))
          }
        }
        if (isNamed(row.name, LOGO_ATTRIBUTE_NAME)) logoIdOf.set(product.id, row.id)
      }

      if (!action) {
        summary.catalog.alreadyOk++
        continue
      }
      if (action === "inserted") summary.catalog.inserted++
      else summary.catalog.renamed++
      summary.products.push({ sku: product.sku, name: product.name, action })
      if (!dryRun) {
        await recordAudit({
          userId, action: "update", entityType: "product", entityId: product.id, entityCode: product.sku,
          oldState: { attributes: before.map((row) => `${row.name}: ${row.options ?? ""}`) },
          newState: { attributes: after.map((row) => `${row.name}: ${row.options ?? ""}`) },
          reason: `Backfill «Con logo»: las prendas EPP llevan logo siempre (${action}).`,
        }, tx)
      }
    }

    // ── 2. Ítems de solicitud abiertos ─────────────────────────────────────
    const eligibleIds = eligible.map((product) => product.id)
    const items = eligibleIds.length === 0 ? [] : await tx
      .select({ id: purchaseRequestItems.id, productId: purchaseRequestItems.productId })
      .from(purchaseRequestItems)
      .where(and(
        inArray(purchaseRequestItems.productId, eligibleIds),
        inArray(purchaseRequestItems.status, [...OPEN_ITEM_STATUSES]),
      ))
    const itemAttributes = items.length === 0 ? [] : await tx
      .select().from(requestItemAttributes)
      .where(inArray(requestItemAttributes.requestItemId, items.map((item) => item.id)))

    for (const item of items) {
      const logoId = logoIdOf.get(item.productId!)
      if (!logoId) continue
      const own = itemAttributes.filter((attribute) => attribute.requestItemId === item.id)
      const logo = own.find((attribute) => isNamed(attribute.attributeName, LOGO_ATTRIBUTE_NAME))
      const legacy = own.find((attribute) => isNamed(attribute.attributeName, "modelo") && isConLogo(attribute.value))

      if (logo) {
        if (logo.value === LOGO_VALUE && logo.attributeName === LOGO_ATTRIBUTE_NAME) {
          summary.requestItems.alreadyOk++
          continue
        }
        summary.requestItems.updated++
        if (!dryRun) {
          await tx.update(requestItemAttributes)
            .set({ attributeName: LOGO_ATTRIBUTE_NAME, value: LOGO_VALUE })
            .where(eq(requestItemAttributes.id, logo.id))
        }
      } else if (legacy) {
        summary.requestItems.updated++
        if (!dryRun) {
          await tx.update(requestItemAttributes)
            .set({ attributeName: LOGO_ATTRIBUTE_NAME, value: LOGO_VALUE, attributeId: logoId })
            .where(eq(requestItemAttributes.id, legacy.id))
        }
      } else {
        summary.requestItems.inserted++
        if (!dryRun) {
          await tx.insert(requestItemAttributes).values({
            id: nanoid(), requestItemId: item.id, attributeId: logoId,
            attributeName: LOGO_ATTRIBUTE_NAME, value: LOGO_VALUE,
          })
        }
      }
    }

    // ── 3. Duplicados por talla que quedan a la vista ──────────────────────
    const groups = new Map<string, typeof eligible>()
    for (const product of eligible.filter((p) => p.isActive)) {
      const key = variantGroupKey(product)
      groups.set(key, [...(groups.get(key) ?? []), product])
    }
    for (const [groupKey, variants] of groups) {
      const bySize = new Map<string, { label: string; skus: string[] }>()
      for (const variant of variants) {
        const size = resolveProductSize(attributesAfter.get(variant.id) ?? [])
        if (!size) continue
        const key = normalizeSizeLabel(size.label)
        const entry = bySize.get(key) ?? { label: size.label, skus: [] }
        entry.skus.push(variant.sku)
        bySize.set(key, entry)
      }
      for (const { label, skus } of bySize.values()) {
        if (skus.length > 1) summary.duplicateSizes.push({ groupKey, productName: variants[0]!.name, size: label, skus })
      }
    }

    return summary
  })
}
