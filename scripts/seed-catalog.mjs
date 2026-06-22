// Standalone EPP catalog seeder for the production image.
//
// Loads ONLY the EPP catalog (category + suppliers + products, with their
// attributes and per-supplier prices) from db/seed/epp-catalog.json — the same
// data the full `db/seed.ts` uses. It deliberately does NOT create admin users,
// worksites or workers (those are handled via /registro and the app flows).
//
// Like scripts/migrate.mjs it uses runtime-only deps (`postgres`) and raw SQL,
// so it runs with plain `node` inside the prod container (no tsx / drizzle-kit).
// Idempotent: every row is upserted, so re-running is safe.
import { readFile } from "node:fs/promises"
import postgres from "postgres"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("[seed-catalog] DATABASE_URL is required")
  process.exit(1)
}

const catalog = JSON.parse(await readFile("./db/seed/epp-catalog.json", "utf8"))
const { category, suppliers, items } = catalog

function sourceNote(item) {
  const parts = [
    "Fuente: EPP PROVEEDORES.xlsx.",
    `Proveedor original: ${item.supplierId === "sup-treck" ? "TRECK" : "APRO"}.`,
  ]
  if (item.originalName) parts.push(`Nombre original: ${item.originalName}.`)
  if (item.detail) parts.push(`Detalle / Nota: ${item.detail}`)
  return parts.join(" ")
}

const RETRIES = 10
const DELAY_MS = 3000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const isConnRefused = (err) =>
  err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED"

async function run(sql) {
  await sql.begin(async (sql) => {
    // Category
    await sql`
      insert into product_categories (id, name, slug, is_epp, requires_prevencion, sort_order)
      values (${category.id}, ${category.name}, ${category.slug}, ${category.isEpp}, ${category.requiresPrevencion}, ${category.sortOrder})
      on conflict (id) do update set
        name = excluded.name, slug = excluded.slug, is_epp = excluded.is_epp,
        requires_prevencion = excluded.requires_prevencion, sort_order = excluded.sort_order
    `

    // Suppliers
    for (const s of suppliers) {
      await sql`
        insert into suppliers (id, name, rut, business_activity, address, commune, city, payment_terms, notes, is_active)
        values (${s.id}, ${s.name}, ${s.rut ?? null}, ${s.businessActivity ?? null}, ${s.address ?? null}, ${s.commune ?? null}, ${s.city ?? null}, ${s.paymentTerms ?? null}, ${s.notes ?? null}, ${s.isActive ?? true})
        on conflict (id) do update set
          name = excluded.name, rut = excluded.rut, business_activity = excluded.business_activity,
          address = excluded.address, commune = excluded.commune, city = excluded.city,
          payment_terms = excluded.payment_terms, notes = excluded.notes,
          is_active = excluded.is_active, updated_at = now()
      `
    }

    // Products (+ attributes + product↔supplier price)
    for (const item of items) {
      await sql`
        insert into products (id, sku, name, description, category_id, unit_of_measure, is_epp, requires_prevencion, reference_price, is_active, notes)
        values (${item.id}, ${item.sku}, ${item.name}, ${item.detail ?? null}, ${category.id}, 'unidad', true, true, ${item.price ?? null}, true, ${sourceNote(item)})
        on conflict (id) do update set
          sku = excluded.sku, name = excluded.name, description = excluded.description,
          category_id = excluded.category_id, unit_of_measure = excluded.unit_of_measure,
          is_epp = excluded.is_epp, requires_prevencion = excluded.requires_prevencion,
          reference_price = excluded.reference_price, is_active = excluded.is_active,
          notes = excluded.notes, updated_at = now()
      `

      // Rewrite attributes: clear referencing request_item_attributes (FK), then
      // the product's attributes, then reinsert. Harmless on a fresh DB.
      const existing = await sql`select id from product_attributes where product_id = ${item.id}`
      const attrIds = existing.map((r) => r.id)
      if (attrIds.length > 0) {
        await sql`delete from request_item_attributes where attribute_id in ${sql(attrIds)}`
        await sql`delete from product_attributes where product_id = ${item.id}`
      }

      const attrs = item.attributes ?? []
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i]
        await sql`
          insert into product_attributes (id, product_id, category_id, name, type, is_required, options, sort_order)
          values (${`pa-${item.id}-${i + 1}`}, ${item.id}, null, ${a.name}, 'select', true, ${JSON.stringify([a.value])}, ${i})
        `
      }

      await sql`
        insert into product_suppliers (id, product_id, supplier_id, unit_price, is_preferred, notes)
        values (${`ps-${item.id}`}, ${item.id}, ${item.supplierId}, ${item.price ?? null}, true, ${item.detail ?? null})
        on conflict (id) do update set
          product_id = excluded.product_id, supplier_id = excluded.supplier_id,
          unit_price = excluded.unit_price, is_preferred = excluded.is_preferred,
          notes = excluded.notes, last_updated = now()
      `
    }
  })
}

for (let attempt = 1; attempt <= RETRIES; attempt++) {
  const sql = postgres(url, { max: 1 })
  try {
    console.log(`[seed-catalog] loading ${suppliers.length} suppliers, ${items.length} products… (attempt ${attempt}/${RETRIES})`)
    await run(sql)
    console.log("[seed-catalog] done")
    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => {})
    if (attempt < RETRIES && isConnRefused(err)) {
      console.warn(`[seed-catalog] db not ready, retrying in ${DELAY_MS}ms…`)
      await sleep(DELAY_MS)
      continue
    }
    console.error("[seed-catalog] failed:", err)
    process.exit(1)
  }
}
