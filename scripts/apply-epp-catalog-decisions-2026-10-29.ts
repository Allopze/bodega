/**
 * scripts/apply-epp-catalog-decisions-2026-10-29.ts
 *
 * Decisiones de catálogo EPP tomadas el 2026-10-29 sobre la revisión de
 * variantes de producción, cuando Solicitudes pasó a ofrecer un selector por
 * cada atributo que varía dentro de la familia (`getVariantAxes`). Igual que
 * `apply-epp-catalog-decisions-2026-10`, es un plan escrito SKU por SKU.
 *
 * - **Atributos que faltaban.** Una variante sin un atributo que sus hermanas
 *   declaran aparece como «Sin especificar» en Solicitudes. Se completan donde
 *   el valor es inequívoco: el Modelo V15 del Botín Thinsulate, el Género del
 *   Pantalón H3200 hombre y el del Botín Evalight.
 * - **Botín Evalight.** El gris es de mujer y el negro de hombre. La primera
 *   corrida de este plan (2026-10-29) marcó todo «Mujer»; la sección de
 *   correcciones de valor deja los negros en «Hombre». Cada SKU llevaba además
 *   su talla y color en el nombre («… Evalight 38 Negro»).
 * - **SOL-0062 (Cholguán).** Pedía el Evalight gris talla 42 porque el selector
 *   sólo ofrecía talla; era el negro. Se cambia la variante con las mismas
 *   reglas que la edición de un ítem pendiente en la app
 *   (`updatePendingRequestItem`): sin decisión de aprobación, OC ni entrega, y
 *   la solicitud sigue pendiente de aprobación.
 * - **Color Piedra de la Polera Dryfresh Smooth M/Larga.** La conciliación
 *   del deploy lo dio de baja el 2026-10-14 como «duplicado» del Azul Marino:
 *   agrupaba sólo por talla (corregido en 051c28fd). Se reactiva.
 *
 * Cada acción comprueba antes el estado esperado y se salta si no coincide, así
 * que reejecutar es seguro y lo que alguien ya corrigió a mano no se pisa. Nada
 * mueve stock ni toca solicitudes ya decididas; todo queda en `audit_log`.
 *
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10-29.ts            # dry-run
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10-29.ts --apply    # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  approvalDecisions, deliveryItems, productAttributes, products,
  purchaseOrderItems, purchaseRequestItems, purchaseRequests, requestItemAttributes,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { parseSizeOptions } from "@/lib/products/product-size"

const REASON = "Decisiones de catálogo EPP (2026-10-29)"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

const EVALIGHT_FAMILY = "Botin VFlex V81 Evalight"
const EVALIGHT_NAME = "Botín VFlex V81 Evalight"
const EVALIGHT_SKUS = Array.from({ length: 22 }, (_, index) => `EPP-${312 + index}`)
/** EPP-312 es gris y EPP-313 negro, y así alternando hasta EPP-333. */
const EVALIGHT_GRIS = EVALIGHT_SKUS.filter((_, index) => index % 2 === 0)
const EVALIGHT_NEGRO = EVALIGHT_SKUS.filter((_, index) => index % 2 === 1)

/** Cómo se reconoce el producto que el plan espera encontrar en cada SKU. */
type Identity = { name: string } | { family: string }

/** Atributo de un solo valor que se renombra (`Genero` → `Género`). */
const ATTRIBUTE_RENAMES: ReadonlyArray<{ sku: string; identity: Identity; from: string; to: string }> = [
  { sku: "EPP-332", identity: { family: EVALIGHT_FAMILY }, from: "Genero", to: "Género" },
]

/** Valor que la variante tiene que declarar para que la acción aplique (el color, p. ej.). */
type Requirement = { attribute: string; value: string }

/** Atributo que la variante no declara y sus hermanas sí. */
const MISSING_ATTRIBUTES: ReadonlyArray<{ skus: readonly string[]; identity: Identity; requires?: Requirement; attribute: string; value: string; why: string }> = [
  {
    skus: ["EPP-157", "EPP-158", "EPP-159", "EPP-160", "EPP-161", "EPP-162", "EPP-163", "EPP-164"],
    identity: { name: "Botín V-Flex Thinsulate V15" },
    attribute: "Modelo", value: "V15",
    why: "la talla 41 (EPP-022) ya declara Modelo V15",
  },
  {
    skus: ["EPP-096", "EPP-097", "EPP-098", "EPP-196", "EPP-197"],
    identity: { name: "Pantalón Lightwind H3200 nylon spandex hombre" },
    attribute: "Género", value: "Hombre",
    why: "la talla 2XL (EPP-099) ya declara Género Hombre",
  },
  {
    skus: EVALIGHT_GRIS.filter((sku) => sku !== "EPP-332"),
    identity: { family: EVALIGHT_FAMILY },
    requires: { attribute: "Color", value: "Gris" },
    attribute: "Género", value: "Mujer",
    why: "el Evalight gris es de mujer; la talla 36 (EPP-332) ya lo declaraba",
  },
  {
    skus: EVALIGHT_NEGRO,
    identity: { family: EVALIGHT_FAMILY },
    requires: { attribute: "Color", value: "Negro" },
    attribute: "Género", value: "Hombre",
    why: "el Evalight negro es de hombre",
  },
]

/** Valor de atributo que se corrige, sólo si todavía tiene el valor equivocado. */
const ATTRIBUTE_VALUE_CORRECTIONS: ReadonlyArray<{ skus: readonly string[]; identity: Identity; requires: Requirement; attribute: string; from: string; to: string; why: string }> = [
  {
    skus: EVALIGHT_NEGRO,
    identity: { family: EVALIGHT_FAMILY },
    requires: { attribute: "Color", value: "Negro" },
    attribute: "Género", from: "Mujer", to: "Hombre",
    why: "el Evalight negro es de hombre; la primera corrida de este plan lo marcó «Mujer»",
  },
]

/** Nombre de producto que llevaba talla y color, ya presentes como atributos. */
const PRODUCT_RENAMES: ReadonlyArray<{ skus: readonly string[]; identity: Identity; fromPrefix: string; to: string }> = [
  { skus: EVALIGHT_SKUS, identity: { family: EVALIGHT_FAMILY }, fromPrefix: "Botin VFlex V81 Evalight", to: EVALIGHT_NAME },
]

/** Variantes dadas de baja por error que vuelven al catálogo. */
const REACTIVATIONS: ReadonlyArray<{ skus: readonly string[]; identity: Identity; attribute: string; value: string; why: string }> = [
  {
    skus: ["EPP-276", "EPP-277", "EPP-278", "EPP-279", "EPP-280", "EPP-281"],
    identity: { name: "Polera Dryfresh Smooth M/Larga" },
    attribute: "Color", value: "Piedra",
    why: "la conciliación del deploy (2026-10-14) la tomó por duplicada del Azul Marino de la misma talla",
  },
]

/** Ítem pendiente de aprobación que pidió la variante equivocada de la misma familia. */
const REQUEST_ITEM_SWAPS: ReadonlyArray<{ requestCode: string; fromSku: string; toSku: string; why: string }> = [
  {
    requestCode: "SOL-0062", fromSku: "EPP-320", toSku: "EPP-321",
    why: "el botín talla 42 de Cholguán es el Evalight negro de hombre, no el gris de mujer; el selector sólo ofrecía talla",
  },
]

/** Mismos estados que acepta `updatePendingRequestItem`. */
const EDITABLE_REQUEST_STATUSES = ["submitted", "in_review", "partially_approved"]

/* ── Infraestructura ──────────────────────────────────────────────────────── */

export type Result = "aplicado" | "ya estaba" | "omitido" | "dry-run"
export type Outcome = { sku: string; action: string; result: Result; detail?: string }

type LoadedProduct = NonNullable<Awaited<ReturnType<typeof loadBySku>>>

async function loadBySku(sku: string) {
  return db.query.products.findFirst({
    where: (p, { eq: equals }) => equals(p.sku, sku),
    with: { productAttributes: true, family: true },
  })
}

/** Por qué el SKU no es el producto que el plan espera, o `null` si lo es. */
function identityMismatch(product: LoadedProduct, identity: Identity): string | null {
  if ("name" in identity) {
    return product.name === identity.name ? null : `se esperaba «${identity.name}», está «${product.name}»`
  }
  const family = product.family?.canonicalName ?? null
  return family === identity.family ? null : `se esperaba la familia «${identity.family}», está ${family ? `«${family}»` : "sin familia"}`
}

function findAttribute(product: LoadedProduct, name: string) {
  const key = normalizeAttributeName(name)
  return product.productAttributes.find((attribute) => normalizeAttributeName(attribute.name) === key)
}

function singleValue(options: string | null): string | null {
  const values = parseSizeOptions(options)
  return values.length === 1 ? values[0]! : null
}

/** Por qué la variante no declara el valor que la acción exige, o `null` si lo declara. */
function requirementMismatch(product: LoadedProduct, requires: Requirement | undefined): string | null {
  if (!requires) return null
  const value = singleValue(findAttribute(product, requires.attribute)?.options ?? null)
  return value != null && normalizeAttributeName(value) === normalizeAttributeName(requires.value)
    ? null
    : `${requires.attribute} es ${value ?? "—"}, se esperaba ${requires.value}`
}

async function audit(tx: Tx, product: { id: string; sku: string }, oldState: Record<string, unknown>, newState: Record<string, unknown>, why: string) {
  await recordAudit({
    userId: null, action: "update", entityType: "product", entityId: product.id, entityCode: product.sku,
    oldState, newState, reason: `${REASON}: ${why}`,
  }, tx)
}

/* ── Acciones ─────────────────────────────────────────────────────────────── */

async function runAttributeRenames(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of ATTRIBUTE_RENAMES) {
    const action = `atributo «${plan.from}» → «${plan.to}»`
    const product = await loadBySku(plan.sku)
    if (!product) { report({ sku: plan.sku, action, result: "omitido", detail: "no existe" }); continue }
    const mismatch = identityMismatch(product, plan.identity)
    if (mismatch) { report({ sku: plan.sku, action, result: "omitido", detail: mismatch }); continue }
    const attribute = findAttribute(product, plan.from)
    if (!attribute) { report({ sku: plan.sku, action, result: "omitido", detail: `no declara «${plan.from}»` }); continue }
    if (attribute.name === plan.to) { report({ sku: plan.sku, action, result: "ya estaba" }); continue }
    if (!apply) { report({ sku: plan.sku, action, result: "dry-run" }); continue }
    await db.transaction(async (tx) => {
      await tx.update(productAttributes).set({ name: plan.to }).where(eq(productAttributes.id, attribute.id))
      await audit(tx, product, { attribute: attribute.name }, { attribute: plan.to }, "mismo atributo escrito como en el resto del catálogo")
    })
    report({ sku: plan.sku, action, result: "aplicado" })
  }
}

async function runMissingAttributes(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of MISSING_ATTRIBUTES) {
    for (const sku of plan.skus) {
      const action = `agregar ${plan.attribute}: ${plan.value}`
      const product = await loadBySku(sku)
      if (!product) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
      const mismatch = identityMismatch(product, plan.identity)
      if (mismatch) { report({ sku, action, result: "omitido", detail: mismatch }); continue }
      if (!product.isActive) { report({ sku, action, result: "omitido", detail: "dado de baja" }); continue }
      const unmet = requirementMismatch(product, plan.requires)
      if (unmet) { report({ sku, action, result: "omitido", detail: unmet }); continue }
      const existing = findAttribute(product, plan.attribute)
      if (existing) {
        const current = singleValue(existing.options)
        const same = current != null && normalizeAttributeName(current) === normalizeAttributeName(plan.value)
        report(same
          ? { sku, action, result: "ya estaba" }
          : { sku, action, result: "omitido", detail: `ya declara ${existing.name} ${existing.options}` })
        continue
      }
      if (!apply) { report({ sku, action, result: "dry-run" }); continue }
      const sortOrder = Math.max(-1, ...product.productAttributes.map((attribute) => attribute.sortOrder)) + 1
      await db.transaction(async (tx) => {
        await tx.insert(productAttributes).values({
          id: nanoid(), productId: product.id, categoryId: null, name: plan.attribute, type: "select",
          isRequired: true, options: JSON.stringify([plan.value]), sizeFamily: null, sortOrder,
        })
        await audit(tx, product, { [plan.attribute]: null }, { [plan.attribute]: plan.value }, plan.why)
      })
      report({ sku, action, result: "aplicado" })
    }
  }
}

async function runAttributeValueCorrections(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of ATTRIBUTE_VALUE_CORRECTIONS) {
    for (const sku of plan.skus) {
      const action = `${plan.attribute}: ${plan.from} → ${plan.to}`
      const product = await loadBySku(sku)
      if (!product) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
      const mismatch = identityMismatch(product, plan.identity) ?? requirementMismatch(product, plan.requires)
      if (mismatch) { report({ sku, action, result: "omitido", detail: mismatch }); continue }
      const attribute = findAttribute(product, plan.attribute)
      const current = singleValue(attribute?.options ?? null)
      if (!attribute || current == null) { report({ sku, action, result: "omitido", detail: `no declara ${plan.attribute}` }); continue }
      if (normalizeAttributeName(current) === normalizeAttributeName(plan.to)) { report({ sku, action, result: "ya estaba" }); continue }
      if (normalizeAttributeName(current) !== normalizeAttributeName(plan.from)) {
        report({ sku, action, result: "omitido", detail: `${plan.attribute} es ${current}` })
        continue
      }
      if (!apply) { report({ sku, action, result: "dry-run" }); continue }
      const target = JSON.stringify([plan.to])
      await db.transaction(async (tx) => {
        await tx.update(productAttributes).set({ options: target }).where(eq(productAttributes.id, attribute.id))
        await audit(tx, product, { [plan.attribute]: attribute.options }, { [plan.attribute]: target }, plan.why)
      })
      report({ sku, action, result: "aplicado" })
    }
  }
}

async function runProductRenames(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of PRODUCT_RENAMES) {
    for (const sku of plan.skus) {
      const action = `renombrar → «${plan.to}»`
      const product = await loadBySku(sku)
      if (!product) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
      const mismatch = identityMismatch(product, plan.identity)
      if (mismatch) { report({ sku, action, result: "omitido", detail: mismatch }); continue }
      if (product.name === plan.to) { report({ sku, action, result: "ya estaba" }); continue }
      if (!product.name.startsWith(plan.fromPrefix)) {
        report({ sku, action, result: "omitido", detail: `se esperaba «${plan.fromPrefix}…», está «${product.name}»` })
        continue
      }
      if (!apply) { report({ sku, action, result: "dry-run", detail: `era «${product.name}»` }); continue }
      await db.transaction(async (tx) => {
        await tx.update(products).set({ name: plan.to }).where(eq(products.id, product.id))
        await audit(tx, product, { name: product.name }, { name: plan.to }, "la talla y el color ya son atributos de la variante")
      })
      report({ sku, action, result: "aplicado", detail: `era «${product.name}»` })
    }
  }
}

async function runReactivations(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of REACTIVATIONS) {
    for (const sku of plan.skus) {
      const action = `reactivar (${plan.attribute} ${plan.value})`
      const product = await loadBySku(sku)
      if (!product) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
      const mismatch = identityMismatch(product, plan.identity)
      if (mismatch) { report({ sku, action, result: "omitido", detail: mismatch }); continue }
      const value = singleValue(findAttribute(product, plan.attribute)?.options ?? null)
      if (value == null || normalizeAttributeName(value) !== normalizeAttributeName(plan.value)) {
        report({ sku, action, result: "omitido", detail: `${plan.attribute} es ${value ?? "—"}` })
        continue
      }
      if (product.isActive) { report({ sku, action, result: "ya estaba" }); continue }
      if (!apply) { report({ sku, action, result: "dry-run" }); continue }
      await db.transaction(async (tx) => {
        await tx.update(products).set({ isActive: true }).where(eq(products.id, product.id))
        await audit(tx, product, { isActive: false }, { isActive: true }, plan.why)
      })
      report({ sku, action, result: "aplicado" })
    }
  }
}

/** Atributos de un solo valor del catálogo de la variante, por nombre normalizado. */
function catalogValues(product: LoadedProduct) {
  const values = new Map<string, { attributeId: string; attributeName: string; value: string }>()
  for (const attribute of product.productAttributes) {
    const value = attribute.type === "select" ? singleValue(attribute.options) : null
    if (value != null) values.set(normalizeAttributeName(attribute.name), { attributeId: attribute.id, attributeName: attribute.name, value })
  }
  return values
}

async function runRequestItemSwaps(apply: boolean, report: (o: Outcome) => void) {
  for (const plan of REQUEST_ITEM_SWAPS) {
    const sku = plan.requestCode
    const action = `ítem ${plan.fromSku} → ${plan.toSku}`
    const [request] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.code, plan.requestCode))
    if (!request) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
    const [from, to] = [await loadBySku(plan.fromSku), await loadBySku(plan.toSku)]
    if (!from || !to) { report({ sku, action, result: "omitido", detail: "no existe alguno de los SKU" }); continue }
    if (!to.isActive) { report({ sku, action, result: "omitido", detail: `${plan.toSku} está dado de baja` }); continue }
    if (from.familyId == null || from.familyId !== to.familyId) {
      report({ sku, action, result: "omitido", detail: "los SKU no son variantes de la misma familia" })
      continue
    }

    const items = await db.select().from(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, request.id))
    const matching = items.filter((item) => item.productId === from.id)
    if (matching.length === 0) {
      const done = items.some((item) => item.productId === to.id)
      report({ sku, action, result: done ? "ya estaba" : "omitido", detail: done ? undefined : `no tiene un ítem ${plan.fromSku}` })
      continue
    }
    if (matching.length > 1) { report({ sku, action, result: "omitido", detail: `tiene ${matching.length} ítems ${plan.fromSku}` }); continue }
    const item = matching[0]!

    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      report({ sku, action, result: "omitido", detail: `la solicitud está ${request.status}` })
      continue
    }
    if (item.status !== "requested") { report({ sku, action, result: "omitido", detail: `el ítem está ${item.status}` }); continue }
    const [decision] = await db.select({ id: approvalDecisions.id }).from(approvalDecisions).where(eq(approvalDecisions.requestItemId, item.id)).limit(1)
    const [orderLine] = await db.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems).where(eq(purchaseOrderItems.requestItemId, item.id)).limit(1)
    const [deliveryLine] = await db.select({ id: deliveryItems.id }).from(deliveryItems).where(eq(deliveryItems.requestItemId, item.id)).limit(1)
    if (decision || orderLine || deliveryLine) {
      report({ sku, action, result: "omitido", detail: decision ? "el ítem ya tiene una decisión de aprobación" : "el ítem ya está en una OC o entrega" })
      continue
    }

    // Los atributos del ítem que el catálogo fija toman el valor de la variante
    // nueva; los que no (observaciones libres) se conservan, y los que la nueva
    // declara y el ítem no tenía (el Género) se agregan.
    const oldAttributes = await db
      .select({ attributeId: requestItemAttributes.attributeId, attributeName: requestItemAttributes.attributeName, value: requestItemAttributes.value })
      .from(requestItemAttributes)
      .where(eq(requestItemAttributes.requestItemId, item.id))
    const target = catalogValues(to)
    const nextAttributes = oldAttributes.map((attribute) => {
      const fixed = target.get(normalizeAttributeName(attribute.attributeName))
      return fixed ? { attributeId: fixed.attributeId, attributeName: attribute.attributeName, value: fixed.value } : attribute
    })
    const present = new Set(nextAttributes.map((attribute) => normalizeAttributeName(attribute.attributeName)))
    for (const [key, fixed] of target) if (!present.has(key)) nextAttributes.push(fixed)

    if (!apply) { report({ sku, action, result: "dry-run" }); continue }
    const now = new Date().toISOString()
    const applied = await db.transaction(async (tx) => {
      const [updated] = await tx.update(purchaseRequestItems)
        .set({ productId: to.id, updatedAt: now })
        .where(and(
          eq(purchaseRequestItems.id, item.id),
          eq(purchaseRequestItems.status, "requested"),
          eq(purchaseRequestItems.productId, from.id),
          eq(purchaseRequestItems.updatedAt, item.updatedAt),
        ))
        .returning({ id: purchaseRequestItems.id })
      if (!updated) return false
      await tx.delete(requestItemAttributes).where(eq(requestItemAttributes.requestItemId, item.id))
      await tx.insert(requestItemAttributes).values(nextAttributes.map((attribute) => ({
        id: nanoid(), requestItemId: item.id, attributeId: attribute.attributeId ?? null,
        attributeName: attribute.attributeName, value: attribute.value,
      })))
      await tx.update(purchaseRequests).set({ updatedAt: now }).where(eq(purchaseRequests.id, request.id))
      await recordAudit({
        userId: null, action: "update", entityType: "request_item", entityId: item.id,
        entityCode: request.code, worksiteId: request.worksiteId,
        oldState: { productId: from.id, sku: from.sku, attributes: oldAttributes },
        newState: { productId: to.id, sku: to.sku, attributes: nextAttributes, status: "requested" },
        reason: `${REASON}: ${plan.why}`,
      }, tx)
      return true
    })
    report(applied
      ? { sku, action, result: "aplicado" }
      : { sku, action, result: "omitido", detail: "el ítem cambió mientras se aplicaba; volver a correr" })
  }
}

/**
 * Aplica el plan completo (o sólo informa, sin `apply`). El renombre del
 * atributo va antes de agregarlo a las hermanas, para que todas queden con la
 * misma escritura.
 */
export async function applyCatalogDecisions20261029(options: { apply?: boolean } = {}): Promise<Outcome[]> {
  const apply = options.apply ?? false
  const outcomes: Outcome[] = []
  const report = (outcome: Outcome) => { outcomes.push(outcome) }
  await runAttributeRenames(apply, report)
  await runMissingAttributes(apply, report)
  await runAttributeValueCorrections(apply, report)
  await runProductRenames(apply, report)
  await runReactivations(apply, report)
  // Al final: el ítem copia los atributos del catálogo ya corregido.
  await runRequestItemSwaps(apply, report)
  return outcomes
}

async function main() {
  const apply = process.argv.includes("--apply")
  console.log(`Decisiones de catálogo EPP 2026-10-29 — ${apply ? "escribiendo" : "dry-run"}\n`)
  const outcomes = await applyCatalogDecisions20261029({ apply })
  for (const o of outcomes) {
    console.log(`${o.sku.padEnd(8)} ${o.action.padEnd(48)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  }
  const count = (result: Result) => outcomes.filter((o) => o.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, ` +
    `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s).`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
