/**
 * scripts/apply-epp-catalog-decisions-2026-10.ts
 *
 * Aplica las decisiones de catálogo EPP tomadas el 2026-10-01 sobre la revisión
 * de producción (variantes repetidas, stock varado en SKU dados de baja, rangos
 * de talla). Igual que `apply-epp-duplicate-unification-2026-10`, es un plan
 * escrito SKU por SKU: lo que es «el mismo producto» lo decidió una persona.
 *
 * Cada acción comprueba antes el estado esperado y se salta si no coincide, así
 * que reejecutar es seguro y lo que alguien ya corrigió a mano no se pisa. Todo
 * queda en `audit_log`; el stock se mueve sólo con documentos de ajuste (AJU)
 * a través de `registerStockDocumentTx`, nunca escribiendo `worksite_stock`.
 *
 * Una baja se rechaza si el SKU tiene saldo **o compras en curso** (una línea de
 * solicitud viva o una línea de OC emitida sin recibir completa): lo que llegue
 * de esa OC entraría a un producto oculto. El historial cerrado no bloquea.
 *
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10.ts --user=correo@dominio            # dry-run
 *   npx tsx scripts/apply-epp-catalog-decisions-2026-10.ts --user=correo@dominio --apply    # escribe
 *
 * `--user` es quien firma los ajustes de stock (`performed_by` exige un usuario);
 * sin él, el primer administrador. Se aplica una vez, a mano; no forma parte
 * del deploy. Reejecutarlo es seguro: lo ya aplicado sale como «ya estaba».
 */
import { and, eq, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { productAttributes, products, roles, userRoles, users, worksiteStock, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isSizeAttributeName, normalizeSizeLabel, parseSizeOptions, resolveProductSize } from "@/lib/products/product-size"
import { variantGroupKey } from "@/lib/products/variant-grouping"
import { insertSizeVariantFromTemplate } from "@/lib/services/epp-size-variant-clone"
import { registerStockDocumentTx } from "@/lib/services/stock-movement"

const REASON = "Decisiones de catálogo EPP (2026-10-01)"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

/** Todo el saldo de `from`, faena por faena, pasa a `to`. */
const TRANSFERS: ReadonlyArray<{ from: string; to: string; why: string }> = [
  { from: "EPP-072", to: "EPP-071", why: "EPP-072 está dado de baja con saldo; es el mismo guante que la talla L de la familia" },
]

/** Corrige un saldo a un valor exacto sólo si está a menos de `tolerance` de él. */
const STOCK_FIXES: ReadonlyArray<{ sku: string; worksite: string; target: number; tolerance: number; why: string }> = [
  { sku: "EPP-060", worksite: "Biodiversa", target: 1, tolerance: 0.001, why: "residuo de redondeo (0.99999714)" },
]

const MARK_AS_EPP: readonly string[] = ["EPP-045"]

/** `size: null` = la variante no tiene talla. */
const RETIREMENTS: ReadonlyArray<{ sku: string; size: string | null; why: string }> = [
  { sku: "EPP-078", size: "T/L", why: "duplicado de la talla L de «Guante Nitrilo Texturizado» (EPP-071)" },
  { sku: "EPP-089", size: null, why: "idéntico a EPP-088 (Lente FX III sellado, claro)" },
  { sku: "EPP-121", size: null, why: "duplicado con nombre truncado de EPP-122 (Visor Activex policarbonato)" },
  { sku: "EPP-144", size: "42", why: "el Botín V-Flex Mujer va de 34 a 41" },
  { sku: "EPP-145", size: "43", why: "el Botín V-Flex Mujer va de 34 a 41" },
  { sku: "EPP-146", size: "44", why: "el Botín V-Flex Mujer va de 34 a 41" },
  { sku: "EPP-147", size: "45", why: "el Botín V-Flex Mujer va de 34 a 41" },
  { sku: "EPP-148", size: "46", why: "el Botín V-Flex Mujer va de 34 a 41" },
]

const RENAMES: ReadonlyArray<{ sku: string; from: string; to: string }> = [
  { sku: "EPP-091", from: "Lente Activex sellado", to: "Lente Activex FX III sellado" },
]

/**
 * Variantes nuevas clonadas de `template`, una por valor de `attribute`. Un
 * valor que el grupo ya tenga —activo o dado de baja— se salta.
 */
const NEW_VARIANTS: ReadonlyArray<{ template: string; attribute: string; values: string[]; sizeFamily: string | null }> = [
  { template: "EPP-016", attribute: "Talla", values: ["34", "35", "36"], sizeFamily: "calzado" },
  { template: "EPP-053", attribute: "Talla", values: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"], sizeFamily: "ropa" },
  { template: "EPP-088", attribute: "Color", values: ["Gris"], sizeFamily: null },
]

/** Precio de referencia único para todas las variantes activas de un nombre. */
const GROUP_PRICES: ReadonlyArray<{ name: string; price: string }> = [
  { name: "Buzo Tyvek 500 Xpert TY198S", price: "4100.00" },
  { name: "Guante Cabritilla Activex sin forro gris", price: "930.00" },
]

/** Valor único de un atributo en todas las variantes activas de un nombre. */
const ATTRIBUTE_VALUES: ReadonlyArray<{ name: string; attribute: string; value: string }> = [
  { name: "Buzo Tyvek 500 Xpert TY198S", attribute: "Modelo", value: "TY198S" },
  { name: "Botín V-Flex V73 Microfiber", attribute: "Modelo", value: "V73" },
  { name: "Pantalón Lightwind H3200 nylon spandex hombre", attribute: "Modelo", value: "H3200" },
  { name: "Mascarilla plegable KN95 sin válvula", attribute: "Presentación", value: "Pack 10 unidades" },
]

/** Los guantes se cuentan por par; los que vienen en caja siguen en caja. */
const GLOVE_UNIT = { from: "unidad", to: "par" } as const

/* ── Infraestructura ──────────────────────────────────────────────────────── */

type Result = "aplicado" | "ya estaba" | "omitido" | "rechazado" | "dry-run"
type Outcome = { sku: string; action: string; result: Result; detail?: string }

const apply = process.argv.includes("--apply")
const outcomes: Outcome[] = []
const report = (o: Outcome) => outcomes.push(o)

function rows<T>(result: unknown): T[] {
  const list = (result as { rows?: T[] }).rows ?? (result as T[])
  return Array.isArray(list) ? list : []
}

async function loadBySku(sku: string) {
  return db.query.products.findFirst({
    where: (p, { eq: equals }) => equals(p.sku, sku),
    with: { productAttributes: true, productSuppliers: true },
  })
}

async function loadEppByName(name: string) {
  return db.query.products.findMany({
    where: (p, { and: all, eq: equals }) => all(equals(p.name, name), equals(p.isEpp, true)),
    with: { productAttributes: true },
  })
}

async function stockByWorksite(productId: string) {
  return db
    .select({ worksiteId: worksiteStock.worksiteId, worksite: worksites.name, quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksites.id, worksiteStock.worksiteId))
    .where(and(eq(worksiteStock.productId, productId), sql`${worksiteStock.quantity} <> 0`))
}

/**
 * Compras que todavía pueden traer unidades a este SKU. El historial cerrado
 * (solicitudes recibidas o rechazadas, OC canceladas o recibidas) no cuenta.
 */
async function openProcurement(productId: string): Promise<string[]> {
  const requestLines = rows<{ code: string; status: string }>(await db.execute(sql`
    select pr.code, ri.status from purchase_request_items ri
    join purchase_requests pr on pr.id = ri.request_id
    where ri.product_id = ${productId}
      and pr.status not in ('rejected', 'closed', 'cancelled')
      and ri.status not in ('rejected', 'received', 'delivered')`))
  const orderLines = rows<{ code: string; pending: number }>(await db.execute(sql`
    select po.code, (poi.quantity - poi.quantity_received)::float as pending from purchase_order_items poi
    join purchase_orders po on po.id = poi.purchase_order_id
    where poi.product_id = ${productId} and poi.status = 'issued'
      and po.status not in ('received', 'closed', 'cancelled')
      and poi.quantity_received < poi.quantity`))
  return [
    ...requestLines.map((l) => `${l.code} (${l.status})`),
    ...orderLines.map((l) => `${l.code} (faltan ${l.pending})`),
  ]
}

async function audit(tx: Tx, product: { id: string; sku: string }, oldState: object, newState: object, why: string) {
  await recordAudit({
    userId: null, action: "update", entityType: "product", entityId: product.id, entityCode: product.sku,
    oldState, newState, reason: `${REASON}: ${why}`,
  }, tx)
}

/* ── Acciones ─────────────────────────────────────────────────────────────── */

async function runTransfers(userId: string, userEmail: string) {
  for (const t of TRANSFERS) {
    const action = `traspasar saldo → ${t.to}`
    const [from, to] = [await loadBySku(t.from), await loadBySku(t.to)]
    if (!from || !to) { report({ sku: t.from, action, result: "omitido", detail: "falta uno de los SKU" }); continue }
    if (from.unitOfMeasure !== to.unitOfMeasure) {
      report({ sku: t.from, action, result: "rechazado", detail: `unidades distintas (${from.unitOfMeasure} / ${to.unitOfMeasure})` })
      continue
    }
    const balances = await stockByWorksite(from.id)
    if (balances.length === 0) { report({ sku: t.from, action, result: "ya estaba", detail: "sin saldo" }); continue }
    const detail = balances.map((b) => `${b.worksite} ${b.quantity}`).join(", ")
    if (!apply) { report({ sku: t.from, action, result: "dry-run", detail }); continue }
    await db.transaction(async (tx) => {
      for (const b of balances) {
        const reason = `${REASON}: traspaso ${t.from} → ${t.to}. ${t.why}.`
        await registerStockDocumentTx(tx, { kind: "ajuste", type: "ajuste", worksiteId: b.worksiteId, productId: from.id, quantity: -b.quantity, performedBy: userId, userEmail, reason })
        await registerStockDocumentTx(tx, { kind: "ajuste", type: "ajuste", worksiteId: b.worksiteId, productId: to.id, quantity: b.quantity, performedBy: userId, userEmail, reason })
      }
    })
    report({ sku: t.from, action, result: "aplicado", detail })
  }
}

async function runStockFixes(userId: string, userEmail: string) {
  for (const fix of STOCK_FIXES) {
    const action = `saldo en ${fix.worksite} → ${fix.target}`
    const product = await loadBySku(fix.sku)
    if (!product) { report({ sku: fix.sku, action, result: "omitido", detail: "no existe" }); continue }
    const balance = (await stockByWorksite(product.id)).find((b) => b.worksite === fix.worksite)
    const current = balance?.quantity ?? 0
    if (current === fix.target) { report({ sku: fix.sku, action, result: "ya estaba" }); continue }
    if (!balance || Math.abs(current - fix.target) > fix.tolerance) {
      report({ sku: fix.sku, action, result: "omitido", detail: `saldo actual ${current}, fuera de tolerancia` })
      continue
    }
    if (!apply) { report({ sku: fix.sku, action, result: "dry-run", detail: `actual ${current}` }); continue }
    await db.transaction((tx) => registerStockDocumentTx(tx, {
      kind: "ajuste", type: "ajuste", worksiteId: balance.worksiteId, productId: product.id,
      quantity: fix.target - current, performedBy: userId, userEmail, reason: `${REASON}: ${fix.why}.`,
    }))
    report({ sku: fix.sku, action, result: "aplicado", detail: `era ${current}` })
  }
}

async function runMarkAsEpp() {
  for (const sku of MARK_AS_EPP) {
    const action = "marcar como EPP"
    const product = await loadBySku(sku)
    if (!product) { report({ sku, action, result: "omitido", detail: "no existe" }); continue }
    if (product.isEpp) { report({ sku, action, result: "ya estaba" }); continue }
    if (!apply) { report({ sku, action, result: "dry-run" }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ isEpp: true }).where(eq(products.id, product.id))
      await audit(tx, product, { isEpp: false }, { isEpp: true }, "estaba en la categoría EPP sin marcar como EPP")
    })
    report({ sku, action, result: "aplicado" })
  }
}

async function runRetirements() {
  for (const r of RETIREMENTS) {
    const action = "dar de baja"
    const product = await loadBySku(r.sku)
    if (!product) { report({ sku: r.sku, action, result: "omitido", detail: "no existe" }); continue }
    if (!product.isActive) { report({ sku: r.sku, action, result: "ya estaba" }); continue }
    const size = resolveProductSize(product.productAttributes)?.label ?? null
    if (size !== r.size) {
      report({ sku: r.sku, action, result: "omitido", detail: `se esperaba talla ${r.size ?? "(ninguna)"}, tiene ${size ?? "(ninguna)"}` })
      continue
    }
    const balances = await stockByWorksite(product.id)
    const open = await openProcurement(product.id)
    if (balances.length > 0 || open.length > 0) {
      const detail = [
        ...balances.map((b) => `saldo ${b.worksite} ${b.quantity}`),
        ...open.map((o) => `compra en curso ${o}`),
      ].join("; ")
      report({ sku: r.sku, action, result: "rechazado", detail })
      continue
    }
    if (!apply) { report({ sku: r.sku, action, result: "dry-run", detail: r.why }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ isActive: false }).where(eq(products.id, product.id))
      await audit(tx, product, { isActive: true }, { isActive: false }, `${r.why}. Sin saldo ni compras en curso.`)
    })
    report({ sku: r.sku, action, result: "aplicado" })
  }
}

async function runRenames() {
  for (const rename of RENAMES) {
    const action = `renombrar → «${rename.to}»`
    const product = await loadBySku(rename.sku)
    if (!product) { report({ sku: rename.sku, action, result: "omitido", detail: "no existe" }); continue }
    if (product.name === rename.to) { report({ sku: rename.sku, action, result: "ya estaba" }); continue }
    if (product.name !== rename.from) {
      report({ sku: rename.sku, action, result: "omitido", detail: `se esperaba «${rename.from}», está «${product.name}»` })
      continue
    }
    if (!apply) { report({ sku: rename.sku, action, result: "dry-run" }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ name: rename.to }).where(eq(products.id, product.id))
      await audit(tx, product, { name: product.name }, { name: rename.to }, "mismo producto escrito distinto")
    })
    report({ sku: rename.sku, action, result: "aplicado" })
  }
}

async function runNewVariants() {
  for (const plan of NEW_VARIANTS) {
    const template = await loadBySku(plan.template)
    if (!template) { report({ sku: plan.template, action: "plantilla de variantes", result: "omitido", detail: "no existe" }); continue }
    const templateAttr = template.productAttributes.find((a) => a.name === plan.attribute)
    if (!templateAttr) {
      report({ sku: plan.template, action: "plantilla de variantes", result: "omitido", detail: `no tiene atributo ${plan.attribute}` })
      continue
    }
    const key = variantGroupKey(template)
    const siblings = (await loadEppByName(template.name)).filter((p) => variantGroupKey(p) === key)
    const compare = (value: string) => (isSizeAttributeName(plan.attribute) ? normalizeSizeLabel(value) : value.trim().toLocaleLowerCase("es-CL"))
    const present = new Set(siblings.flatMap((p) => p.productAttributes
      .filter((a) => a.name === plan.attribute)
      .flatMap((a) => parseSizeOptions(a.options))
      .map(compare)))

    for (const value of plan.values) {
      const action = `crear variante ${plan.attribute}=${value} de «${template.name}»`
      if (present.has(compare(value))) { report({ sku: plan.template, action, result: "ya estaba" }); continue }
      if (!apply) { report({ sku: plan.template, action, result: "dry-run" }); continue }
      const sku = await db.transaction(async (tx) => {
        const productId = await insertSizeVariantFromTemplate(tx, {
          template, templateSizeAttr: templateAttr, size: value, sizeFamily: plan.sizeFamily, isActive: true,
        })
        const [created] = await tx.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.id, productId))
        await recordAudit({
          userId: null, action: "create", entityType: "product", entityId: productId, entityCode: created!.sku,
          newState: { name: template.name, [plan.attribute]: value, clonedFrom: template.sku },
          reason: `${REASON}: variante ${plan.attribute}=${value} pedida para el grupo.`,
        }, tx)
        return created!.sku
      })
      present.add(compare(value))
      report({ sku, action, result: "aplicado" })
    }
  }
}

async function runGroupPrices() {
  for (const plan of GROUP_PRICES) {
    for (const product of (await loadEppByName(plan.name)).filter((p) => p.isActive)) {
      const action = `precio de referencia → ${plan.price}`
      // `numeric` vuelve como texto sin ceros a la derecha («930», no «930.00»).
      if (product.referencePrice != null && Number(product.referencePrice) === Number(plan.price)) continue
      if (!apply) { report({ sku: product.sku, action, result: "dry-run", detail: `era ${product.referencePrice}` }); continue }
      await db.transaction(async (tx) => {
        await tx.update(products).set({ referencePrice: plan.price }).where(eq(products.id, product.id))
        await audit(tx, product, { referencePrice: product.referencePrice }, { referencePrice: plan.price }, "un precio por producto")
      })
      report({ sku: product.sku, action, result: "aplicado", detail: `era ${product.referencePrice}` })
    }
  }
}

async function runAttributeValues() {
  for (const plan of ATTRIBUTE_VALUES) {
    const target = JSON.stringify([plan.value])
    for (const product of (await loadEppByName(plan.name)).filter((p) => p.isActive)) {
      const attribute = product.productAttributes.find((a) => a.name === plan.attribute)
      if (!attribute || attribute.options === target) continue
      const action = `${plan.attribute} → ${plan.value}`
      if (!apply) { report({ sku: product.sku, action, result: "dry-run", detail: `era ${attribute.options}` }); continue }
      await db.transaction(async (tx) => {
        await tx.update(productAttributes).set({ options: target }).where(eq(productAttributes.id, attribute.id))
        await audit(tx, product, { [plan.attribute]: attribute.options }, { [plan.attribute]: target }, "mismo valor en todo el grupo")
      })
      report({ sku: product.sku, action, result: "aplicado", detail: `era ${attribute.options}` })
    }
  }
}

async function runGloveUnits() {
  const gloves = await db.query.products.findMany({
    where: (p, { and: all, eq: equals, ilike }) => all(equals(p.isEpp, true), ilike(p.name, "guante%"), equals(p.unitOfMeasure, GLOVE_UNIT.from)),
  })
  for (const product of gloves) {
    const action = `unidad ${GLOVE_UNIT.from} → ${GLOVE_UNIT.to}`
    if (!apply) { report({ sku: product.sku, action, result: "dry-run", detail: product.name }); continue }
    await db.transaction(async (tx) => {
      await tx.update(products).set({ unitOfMeasure: GLOVE_UNIT.to }).where(eq(products.id, product.id))
      await audit(tx, product, { unitOfMeasure: GLOVE_UNIT.from }, { unitOfMeasure: GLOVE_UNIT.to }, "los guantes se cuentan por par")
    })
    report({ sku: product.sku, action, result: "aplicado", detail: product.name })
  }
}

type GroupVariant = Awaited<ReturnType<typeof loadEppByName>>[number]

/** Grupos de variantes activas tal como los arma Solicitudes. */
async function activeEppGroups(): Promise<GroupVariant[][]> {
  const all = await db.query.products.findMany({
    where: (p, { and: both, eq: equals }) => both(equals(p.isEpp, true), equals(p.isActive, true)),
    with: { productAttributes: true },
  })
  const groups = new Map<string, GroupVariant[]>()
  for (const product of all) {
    const key = variantGroupKey(product)
    groups.set(key, [...(groups.get(key) ?? []), product])
  }
  return [...groups.values()]
}

/** El atributo de talla de valor único de una variante, si lo tiene. */
function sizeAttributeOf(product: GroupVariant) {
  return product.productAttributes.find((a) => isSizeAttributeName(a.name) && parseSizeOptions(a.options).length === 1) ?? null
}

/**
 * Talla sin `size_family` en un grupo cuyas otras tallas declaran una sola:
 * hereda esa. Un grupo sin ninguna declarada, o con dos, se deja como está.
 */
async function runSizeFamilies() {
  for (const group of await activeEppGroups()) {
    const sized = group.flatMap((p) => { const a = sizeAttributeOf(p); return a ? [{ product: p, attribute: a }] : [] })
    const declared = new Set(sized.map((s) => s.attribute.sizeFamily).filter((f): f is string => Boolean(f)))
    if (declared.size !== 1) continue
    const [family] = declared
    for (const { product, attribute } of sized.filter((s) => !s.attribute.sizeFamily)) {
      const action = `familia de talla → ${family}`
      if (!apply) { report({ sku: product.sku, action, result: "dry-run", detail: product.name }); continue }
      await db.transaction(async (tx) => {
        await tx.update(productAttributes).set({ sizeFamily: family }).where(eq(productAttributes.id, attribute.id))
        await audit(tx, product, { sizeFamily: null }, { sizeFamily: family }, "misma familia de talla que el resto del grupo")
      })
      report({ sku: product.sku, action, result: "aplicado", detail: product.name })
    }
  }
}

/** Códigos de escala que la forma canónica escribe bien (`41`, `L`, `2XL`). */
const SCALE_CODE = /^(\d+(\.\d+)?|\d*X[SL]|[SML])$/

/**
 * En un grupo que escribe la talla de dos formas (`T/L` junto a `XL`, `N41`
 * junto a `38`), todas pasan a la forma canónica: es la regla de
 * `labelInGroupStyle` para prefijos mezclados. Un grupo con un solo prefijo
 * (`T/S`, `T/M`, `T/L`) ya es parejo y no se toca.
 */
async function runSizeLabels() {
  for (const group of await activeEppGroups()) {
    const sized = group.flatMap((p) => {
      const a = sizeAttributeOf(p)
      return a ? [{ product: p, attribute: a, label: parseSizeOptions(a.options)[0]! }] : []
    })
    const prefixes = new Set(sized.map(({ label }) => {
      const canonical = normalizeSizeLabel(label)
      return label.toUpperCase().endsWith(canonical.toUpperCase()) ? label.slice(0, label.length - canonical.length) : null
    }))
    if (prefixes.size < 2) continue
    for (const { product, attribute, label } of sized) {
      const canonical = normalizeSizeLabel(label)
      if (canonical === label || !SCALE_CODE.test(canonical)) continue
      const action = `talla ${label} → ${canonical}`
      if (!apply) { report({ sku: product.sku, action, result: "dry-run", detail: product.name }); continue }
      const options = JSON.stringify([canonical])
      await db.transaction(async (tx) => {
        await tx.update(productAttributes).set({ options }).where(eq(productAttributes.id, attribute.id))
        await audit(tx, product, { [attribute.name]: attribute.options }, { [attribute.name]: options }, "una sola forma de escribir la talla en el grupo")
      })
      report({ sku: product.sku, action, result: "aplicado", detail: product.name })
    }
  }
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

/**
 * Quién firma los ajustes de stock: `--user=<correo>`, o el primer
 * administrador como en `seed-pdtp-inspection-templates` (el audit log dice
 * cuál fue).
 */
async function resolveActor(): Promise<{ id: string; email: string }> {
  const email = process.argv.find((arg) => arg.startsWith("--user="))?.slice("--user=".length)
  if (email) {
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email))
    if (!user) throw new Error(`No existe un usuario con correo ${email}`)
    return user
  }
  const [admin] = await db.select({ id: users.id, email: users.email })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(eq(roles.name, "administrador"))
    .orderBy(users.createdAt)
    .limit(1)
  if (!admin) throw new Error("No hay ningún usuario con rol `administrador`. Pasa --user=<correo>.")
  return admin
}

async function main() {
  const actor = await resolveActor()
  console.log(`Decisiones de catálogo EPP 2026-10 — ${apply ? "escribiendo" : "dry-run"} · firma ${actor.email}\n`)

  // Orden: el stock antes que las bajas (un traspaso puede dejar un SKU sin
  // saldo y retirable), las variantes nuevas antes que los atributos de grupo.
  // Un error inesperado corta su sección y se informa, sin detener las demás.
  // Como todo es idempotente, una segunda corrida retoma lo que quedó pendiente.
  const sections: ReadonlyArray<[string, () => Promise<void>]> = [
    ["traspasos de stock", () => runTransfers(actor.id, actor.email)],
    ["correcciones de saldo", () => runStockFixes(actor.id, actor.email)],
    ["marcar como EPP", runMarkAsEpp],
    ["bajas", runRetirements],
    ["renombres", runRenames],
    ["variantes nuevas", runNewVariants],
    ["precios de grupo", runGroupPrices],
    ["atributos de grupo", runAttributeValues],
    ["unidad de los guantes", runGloveUnits],
    ["familias de talla", runSizeFamilies],
    ["formato de talla", runSizeLabels],
  ]
  for (const [label, run] of sections) {
    try {
      await run()
    } catch (error) {
      report({ sku: "—", action: `sección «${label}» interrumpida`, result: "rechazado", detail: error instanceof Error ? error.message : String(error) })
    }
  }

  for (const o of outcomes) {
    console.log(`${o.sku.padEnd(8)} ${o.action.padEnd(64)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  }
  const count = (result: Result) => outcomes.filter((o) => o.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, ` +
    `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s), ${count("rechazado")} rechazada(s).`,
  )
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
