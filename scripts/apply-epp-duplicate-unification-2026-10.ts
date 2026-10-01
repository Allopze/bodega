/**
 * scripts/apply-epp-duplicate-unification-2026-10.ts
 *
 * Unifica los duplicados de EPP de ropa y calzado que el importador dejó como
 * productos separados, decididos el 2026-10-01 sobre la evidencia de producción
 * (stock y referencias por SKU). Es un plan escrito SKU por SKU, no una
 * heurística: la decisión de qué es «el mismo producto» la tomó una persona.
 *
 * Dos operaciones, ninguna borra ni mueve stock:
 *
 *  - **Renombrar** al nombre del grupo canónico, para que Solicitudes agrupe
 *    las variantes (`variantGroupKey` cae al nombre normalizado cuando no hay
 *    familia) y ofrezca un solo selector de talla.
 *  - **Dar de baja** (`is_active = false`) la variante que repite una talla del
 *    grupo o que no tiene talla, **sólo si no tiene stock ni historial**. Se
 *    vuelve a comprobar en el momento de escribir: si desde el plan entró stock
 *    o una referencia operativa, esa baja se rechaza y se informa.
 *
 * Cada acción comprueba antes el estado esperado (nombre, talla) y se salta si
 * no coincide, así que reejecutar es seguro y un SKU que alguien ya corrigió a
 * mano no se pisa. Todo queda en `audit_log`.
 *
 *   npx tsx scripts/apply-epp-duplicate-unification-2026-10.ts            # informa (dry-run)
 *   npx tsx scripts/apply-epp-duplicate-unification-2026-10.ts --apply    # escribe
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { products } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { resolveProductSize } from "@/lib/products/product-size"
import { countReferences, stockOf } from "@/lib/services/epp-duplicate-size-reconciliation"

const TYVEK = "Buzo Tyvek 500 Xpert TY198S"
const TRAJE_PU = "Traje PU Verde Activex"

const RENAMES: ReadonlyArray<{ sku: string; from: string; to: string }> = [
  { sku: "EPP-111", from: "Traje PU Activex Pantalón", to: TRAJE_PU },
  { sku: "EPP-034", from: "Camisa Absolute Zero Lightwind Poliéster", to: "Camisa Absolute Zero Lightwind H2600" },
  { sku: "EPP-099", from: "Pantalón Lightwind nylon spandex hombre UV", to: "Pantalón Lightwind H3200 nylon spandex hombre" },
  // EPP-027 concentra el uso real del buzo (stock, entregas) pero no tiene
  // talla: en el grupo, Solicitudes lo deja fuera de las opciones y Entregas lo
  // sigue mostrando como «sin talla» para despachar su stock.
  { sku: "EPP-027", from: "Buzo Dupont Tyvek", to: TYVEK },
  { sku: "EPP-029", from: "Buzo Tyvek Dupont", to: TYVEK },
  { sku: "EPP-030", from: "Buzo Tyvek Xpert", to: TYVEK },
  { sku: "EPP-102", from: "Pantalón slack cargo gabardina con logo", to: "Pantalón Slack Cargo gabardina gris/naranjo" },
  { sku: "EPP-015", from: "Botin V-Flex Microfiber", to: "Botín V-Flex V73 Microfiber" },
]

/** `size: null` = la variante no tiene talla. */
const RETIREMENTS: ReadonlyArray<{ sku: string; size: string | null; reason: string }> = [
  { sku: "EPP-111", size: "L", reason: `Talla L repetida en «${TRAJE_PU}»; sobrevive EPP-116 (tiene stock).` },
  { sku: "EPP-112", size: "T/L", reason: `Talla L repetida en «${TRAJE_PU}»; sobrevive EPP-116 (tiene stock).` },
  { sku: "EPP-115", size: "T/XL", reason: `Talla XL repetida en «${TRAJE_PU}»; sobrevive EPP-114.` },
  { sku: "EPP-118", size: "T/M", reason: `Talla M repetida en «${TRAJE_PU}»; sobrevive EPP-117.` },
  { sku: "EPP-119", size: "T/XXL", reason: `Talla 2XL repetida (XXL) en «${TRAJE_PU}»; sobrevive EPP-113.` },
  { sku: "EPP-030", size: "XL", reason: `Talla XL repetida en «${TYVEK}»; sobrevive EPP-029 (tiene stock).` },
  { sku: "EPP-042", size: null, reason: "Duplicado sin talla de «Chaqueta Activex micropolar negro manga larga» (EPP-043)." },
  { sku: "EPP-103", size: null, reason: "Duplicado sin talla de «Polera Polo Dryfresh dama» (EPP-105)." },
  { sku: "EPP-104", size: null, reason: "Duplicado sin talla de «Polera Polo Dryfresh hombre» (EPP-106)." },
  { sku: "EPP-021", size: "T41", reason: "Talla 41 repetida (T41/N41) en «Botín V-Flex Thinsulate V15»; sobrevive EPP-022." },
]

type Outcome = { sku: string; action: string; result: "aplicado" | "ya estaba" | "omitido" | "rechazado" | "dry-run"; detail?: string }

async function loadBySku(sku: string) {
  return db.query.products.findFirst({
    where: (p, { eq: equals }) => equals(p.sku, sku),
    with: { productAttributes: true },
  })
}

async function main() {
  const apply = process.argv.includes("--apply")
  const outcomes: Outcome[] = []

  for (const rename of RENAMES) {
    const product = await loadBySku(rename.sku)
    const action = `renombrar → «${rename.to}»`
    if (!product) { outcomes.push({ sku: rename.sku, action, result: "omitido", detail: "no existe" }); continue }
    if (product.name === rename.to) { outcomes.push({ sku: rename.sku, action, result: "ya estaba" }); continue }
    if (product.name !== rename.from) {
      outcomes.push({ sku: rename.sku, action, result: "omitido", detail: `se esperaba «${rename.from}», está «${product.name}»` })
      continue
    }
    if (!apply) { outcomes.push({ sku: rename.sku, action, result: "dry-run" }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ name: rename.to }).where(eq(products.id, product.id))
      await recordAudit({
        userId: null, action: "update", entityType: "product", entityId: product.id, entityCode: product.sku,
        oldState: { name: product.name }, newState: { name: rename.to },
        reason: "Unificación de duplicados EPP (2026-10-01): mismo producto escrito distinto.",
      }, tx)
    })
    outcomes.push({ sku: rename.sku, action, result: "aplicado" })
  }

  for (const retirement of RETIREMENTS) {
    const product = await loadBySku(retirement.sku)
    const action = "dar de baja"
    if (!product) { outcomes.push({ sku: retirement.sku, action, result: "omitido", detail: "no existe" }); continue }
    if (!product.isActive) { outcomes.push({ sku: retirement.sku, action, result: "ya estaba" }); continue }
    const size = resolveProductSize(product.productAttributes)?.label ?? null
    if (size !== retirement.size) {
      outcomes.push({ sku: retirement.sku, action, result: "omitido", detail: `se esperaba talla ${retirement.size ?? "(ninguna)"}, tiene ${size ?? "(ninguna)"}` })
      continue
    }
    const [stock, references] = [await stockOf(product.id), await countReferences(product.id)]
    // La traza del importador (`epp_import_*`) dice de qué planilla salió el
    // producto, no que haya participado de una operación: dar de baja no la
    // toca. Lo que sí bloquea es lo operativo —solicitudes, OC, entregas,
    // movimientos, guías, conteos— y el stock.
    const operational = Object.fromEntries(Object.entries(references.detail).filter(([ref]) => !ref.startsWith("epp_import_")))
    if (stock !== 0 || Object.keys(operational).length > 0) {
      outcomes.push({ sku: retirement.sku, action, result: "rechazado", detail: `stock ${stock}, referencias ${JSON.stringify(operational)}` })
      continue
    }
    if (!apply) { outcomes.push({ sku: retirement.sku, action, result: "dry-run" }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ isActive: false }).where(eq(products.id, product.id))
      await recordAudit({
        userId: null, action: "update", entityType: "product", entityId: product.id, entityCode: product.sku,
        oldState: { isActive: true }, newState: { isActive: false },
        reason: `Unificación de duplicados EPP (2026-10-01): ${retirement.reason} Sin stock ni historial.`,
      }, tx)
    })
    outcomes.push({ sku: retirement.sku, action, result: "aplicado" })
  }

  for (const outcome of outcomes) {
    console.log(`${outcome.sku.padEnd(8)} ${outcome.action.padEnd(62)} ${outcome.result}${outcome.detail ? ` — ${outcome.detail}` : ""}`)
  }
  const pending = outcomes.filter((o) => o.result === "dry-run").length
  if (!apply) console.log(`\nDry-run: ${pending} acción(es) por aplicar. Volvé a correrlo con --apply.`)
  if (outcomes.some((o) => o.result === "rechazado" || o.result === "omitido")) process.exitCode = 2
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
