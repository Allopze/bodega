/**
 * Conciliación de variantes que representan la **misma talla física** dentro de
 * una familia.
 *
 * El importador XLSX nombraba `Talla` a cualquier eje y no canonizaba el valor,
 * así que el catálogo acumuló `N41` junto a `T41` y `L` junto a `T/L` —la misma
 * talla como dos productos con saldos separados— y pares idénticos en nombre,
 * talla, color y modelo que sólo se distinguen por el SKU. Para el bodeguero son
 * dos filas indistinguibles; para `getSizeVariantPicker` son motivo para no
 * mostrar selector de talla, porque no puede ofrecer dos opciones iguales.
 *
 * **Se da de baja, no se borra.** `is_active = false` alcanza para que la
 * variante salga del catálogo —Solicitudes filtra por `is_active`, así que el
 * picker deja de ver dos etiquetas iguales— y deja la fila y su historial
 * intactos. Un error se revierte con un UPDATE, no con un restore.
 *
 * **Sólo se dan de baja variantes sin stock ni referencias.** Desactivar una
 * variante con stock esconde inventario real, y repuntar una guía de despacho o
 * una línea de OC a otro producto tiene consecuencias contables que no puede
 * decidir un backfill. Esos grupos se informan y se saltan.
 */
import { inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { products } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { normalizeSizeLabel, resolveProductSize } from "@/lib/products/product-size"

/**
 * Tablas que referencian `products.id` con `ON DELETE NO ACTION`. Una variante
 * con filas en cualquiera de ellas participó en una operación real, así que no
 * se da de baja sin decisión humana.
 */
const BLOCKING_REFERENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "delivery_items", column: "product_id" },
  { table: "delivery_items", column: "return_product_id" },
  { table: "dispatch_guide_items", column: "product_id" },
  { table: "epp_import_matches", column: "product_id" },
  { table: "epp_import_rows", column: "target_product_id" },
  { table: "inventory_movements", column: "product_id" },
  { table: "physical_inventory_count_items", column: "product_id" },
  { table: "prevention_emergency_resource_types", column: "service_product_id" },
  { table: "purchase_order_items", column: "product_id" },
  { table: "purchase_request_items", column: "product_id" },
  { table: "stock_adjustments", column: "product_id" },
  { table: "stock_returns", column: "product_id" },
]

export interface DuplicateVariantFacts {
  productId: string
  sku: string
  stock: number
  referenceTotal: number
  references: Record<string, number>
}

export interface DuplicateSizeGroup {
  familyId: string
  familyName: string
  /** Talla ya canonizada que comparten las variantes del grupo. */
  sizeLabel: string
  survivor: DuplicateVariantFacts
  absorbed: DuplicateVariantFacts[]
  /** `true` cuando toda variante a retirar está libre de stock e historial. */
  retirable: boolean
  skipReason: string | null
}

export interface DuplicateSizeReconciliationSummary {
  groupsFound: number
  variantsRetired: number
  groupsSkipped: number
  dryRun: boolean
  groups: DuplicateSizeGroup[]
}

function readFirst<T>(result: unknown): T | undefined {
  const rows = (result as { rows?: T[] }).rows ?? (result as T[])
  return Array.isArray(rows) ? rows[0] : undefined
}

async function countReferences(productId: string): Promise<{ total: number; detail: Record<string, number> }> {
  const detail: Record<string, number> = {}
  let total = 0

  for (const ref of BLOCKING_REFERENCES) {
    const result = await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(ref.table)} where ${sql.identifier(ref.column)} = ${productId}`,
    )
    const n = Number(readFirst<{ n: number }>(result)?.n ?? 0)
    if (n > 0) {
      detail[`${ref.table}.${ref.column}`] = n
      total += n
    }
  }

  return { total, detail }
}

async function stockOf(productId: string): Promise<number> {
  const result = await db.execute(
    sql`select coalesce(sum(quantity), 0)::float as q from worksite_stock where product_id = ${productId}`,
  )
  return Number(readFirst<{ q: number }>(result)?.q ?? 0)
}

/**
 * Sobrevive la variante con más historial; a igual historial, la que tiene
 * stock; a igual stock, el SKU menor, para que el resultado sea estable entre
 * corridas y el preflight coincida con lo que después se aplica.
 */
function pickSurvivor(variants: DuplicateVariantFacts[]): DuplicateVariantFacts {
  return [...variants].sort((left, right) =>
    right.referenceTotal - left.referenceTotal
    || right.stock - left.stock
    || left.sku.localeCompare(right.sku, "es-CL"),
  )[0]!
}

/** Grupos de variantes activas que comparten familia y talla canónica. */
export async function findDuplicateSizeGroups(): Promise<DuplicateSizeGroup[]> {
  const result = await db.execute(sql`
    select p.id as product_id, p.sku, f.id as family_id, f.canonical_name as family_name,
           coalesce(json_agg(json_build_object('name', pa.name, 'options', pa.options)
                    order by pa.sort_order) filter (where pa.id is not null), '[]') as attrs
    from products p
    join epp_product_families f on f.id = p.family_id
    left join product_attributes pa on pa.product_id = p.id
    where p.is_active = true
    group by p.id, p.sku, f.id, f.canonical_name
  `)
  const rows = (((result as { rows?: unknown[] }).rows ?? result) as Array<Record<string, unknown>>)

  const buckets = new Map<string, {
    familyId: string
    familyName: string
    sizeLabel: string
    members: Array<{ productId: string; sku: string }>
  }>()

  for (const raw of rows) {
    const attrs = raw.attrs as Array<{ name: string; options: string | null }>
    const size = resolveProductSize(attrs)
    if (!size) continue
    const sizeLabel = normalizeSizeLabel(size.label)
    const familyId = String(raw.family_id)
    const key = `${familyId}::${sizeLabel}`
    const member = { productId: String(raw.product_id), sku: String(raw.sku) }
    const bucket = buckets.get(key)
    if (bucket) bucket.members.push(member)
    else buckets.set(key, { familyId, familyName: String(raw.family_name), sizeLabel, members: [member] })
  }

  const groups: DuplicateSizeGroup[] = []
  for (const bucket of buckets.values()) {
    if (bucket.members.length < 2) continue

    const facts: DuplicateVariantFacts[] = []
    for (const member of bucket.members) {
      const references = await countReferences(member.productId)
      facts.push({
        productId: member.productId,
        sku: member.sku,
        stock: await stockOf(member.productId),
        referenceTotal: references.total,
        references: references.detail,
      })
    }

    const survivor = pickSurvivor(facts)
    const absorbed = facts.filter((fact) => fact.productId !== survivor.productId)
    const withHistory = absorbed.filter((fact) => fact.referenceTotal > 0 || fact.stock !== 0)

    groups.push({
      familyId: bucket.familyId,
      familyName: bucket.familyName,
      sizeLabel: bucket.sizeLabel,
      survivor,
      absorbed,
      retirable: withHistory.length === 0,
      skipReason: withHistory.length === 0
        ? null
        : `${withHistory.map((fact) => fact.sku).join(", ")} tiene stock o historial: trasladar el stock y repuntar las referencias es una decisión contable, no un backfill.`,
    })
  }

  return groups.sort((left, right) =>
    left.familyName.localeCompare(right.familyName, "es-CL")
    || left.sizeLabel.localeCompare(right.sizeLabel, "es-CL"),
  )
}

/**
 * Da de baja las variantes duplicadas que no tienen stock ni historial.
 *
 * `dryRun` es el valor por omisión: informa exactamente lo mismo sin escribir.
 * Nunca borra filas ni toca las variantes con historial.
 */
export async function retireDuplicateSizeVariants(
  options: { dryRun?: boolean; userId?: string | null } = {},
): Promise<DuplicateSizeReconciliationSummary> {
  const dryRun = options.dryRun ?? true
  const groups = await findDuplicateSizeGroups()

  let variantsRetired = 0
  let groupsSkipped = 0

  for (const group of groups) {
    if (!group.retirable) {
      groupsSkipped++
      continue
    }
    const ids = group.absorbed.map((fact) => fact.productId)
    if (ids.length === 0) continue
    variantsRetired += ids.length
    if (dryRun) continue

    await db.transaction(async (tx) => {
      await tx.update(products).set({ isActive: false }).where(inArray(products.id, ids))
      for (const fact of group.absorbed) {
        await recordAudit({
          userId: options.userId ?? null,
          action: "update",
          entityType: "product",
          entityId: fact.productId,
          entityCode: fact.sku,
          oldState: { isActive: true },
          newState: { isActive: false },
          reason: `Variante duplicada: misma talla ${group.sizeLabel} que ${group.survivor.sku} en la familia «${group.familyName}»`,
        }, tx)
      }
    })
  }

  return { groupsFound: groups.length, variantsRetired, groupsSkipped, dryRun, groups }
}
