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
 *   Pantalón H3200 hombre y el del Botín Evalight (de mujer, confirmado).
 * - **Botín Evalight.** Cada SKU llevaba su talla y color en el nombre
 *   («… Evalight 38 Negro»), repetidos en la OC junto a los atributos.
 * - **Color Piedra de la Polera Dryfresh Smooth M/Larga.** La conciliación
 *   del deploy lo dio de baja el 2026-10-14 como «duplicado» del Azul Marino:
 *   agrupaba sólo por talla (corregido en 051c28fd). Se reactiva.
 *
 * Cada acción comprueba antes el estado esperado y se salta si no coincide, así
 * que reejecutar es seguro y lo que alguien ya corrigió a mano no se pisa. Nada
 * mueve stock ni toca historial; todo queda en `audit_log`.
 *
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10-29.ts            # dry-run
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10-29.ts --apply    # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { productAttributes, products } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { parseSizeOptions } from "@/lib/products/product-size"

const REASON = "Decisiones de catálogo EPP (2026-10-29)"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

const EVALIGHT_FAMILY = "Botin VFlex V81 Evalight"
const EVALIGHT_NAME = "Botín VFlex V81 Evalight"
const EVALIGHT_SKUS = Array.from({ length: 22 }, (_, index) => `EPP-${312 + index}`)

/** Cómo se reconoce el producto que el plan espera encontrar en cada SKU. */
type Identity = { name: string } | { family: string }

/** Atributo de un solo valor que se renombra (`Genero` → `Género`). */
const ATTRIBUTE_RENAMES: ReadonlyArray<{ sku: string; identity: Identity; from: string; to: string }> = [
  { sku: "EPP-332", identity: { family: EVALIGHT_FAMILY }, from: "Genero", to: "Género" },
]

/** Atributo que la variante no declara y sus hermanas sí. */
const MISSING_ATTRIBUTES: ReadonlyArray<{ skus: readonly string[]; identity: Identity; attribute: string; value: string; why: string }> = [
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
    skus: EVALIGHT_SKUS.filter((sku) => sku !== "EPP-332"),
    identity: { family: EVALIGHT_FAMILY },
    attribute: "Género", value: "Mujer",
    why: "calzado de mujer; la talla 36 gris (EPP-332) ya lo declaraba",
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
  await runProductRenames(apply, report)
  await runReactivations(apply, report)
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
