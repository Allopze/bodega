/**
 * Bootstrap seed — Plataforma Chome
 * Creates only workers/worksites and the base EPP catalog.
 * Operational/test data should be entered through the app flows.
 * Run with: npx tsx db/seed.ts
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { loadEnvConfig } from "@next/env"
import * as schema from "./schema"
import { eq, inArray } from "drizzle-orm"
import { loadSeedWorkerData } from "./seed/workers"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const eppCatalog = JSON.parse(
  readFileSync(resolve(__dirname, "seed", "epp-catalog.json"), "utf-8")
)

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required (postgres://...)")
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })

const EPP_CATEGORY = eppCatalog.category as typeof schema.productCategories.$inferInsert
const EPP_SUPPLIERS = eppCatalog.suppliers as (typeof schema.suppliers.$inferInsert)[]
const EPP_CATALOG_ITEMS = eppCatalog.items as EppCatalogItem[]

interface EppCatalogItem {
  id: string
  supplierId: string
  sku: string
  name: string
  originalName?: string
  detail: string | null
  price: number | null
  attributes?: { name: string; value: string }[]
}

function sourceNote(item: EppCatalogItem) {
  const parts = [
    "Fuente: EPP PROVEEDORES.xlsx.",
    `Proveedor original: ${item.supplierId === "sup-treck" ? "TRECK" : "APRO"}.`,
  ]
  if (item.originalName) parts.push(`Nombre original: ${item.originalName}.`)
  if (item.detail) parts.push(`Detalle / Nota: ${item.detail}`)
  return parts.join(" ")
}

async function main() {
  console.log("Inicializando datos base de Plataforma Chome...")

  // A-16: SEED_DRY_RUN valida todas las entradas del seed (config, parsing del
  // markdown de trabajadores, catálogo EPP, política de contraseña) y reporta
  // lo que se insertaría, SIN tocar la base de datos. Útil en CI/pre-deploy.
  if (process.env.SEED_DRY_RUN === "true") {
    const workerData = loadSeedWorkerData()
    console.log("\n[DRY RUN] No se escribirá nada en la base de datos.")
    console.log(`  Faenas: ${workerData.worksites.length} · Trabajadores: ${workerData.workers.length} (${workerData.skippedDuplicateRuts} RUT duplicado omitido)`)
    console.log(`  Catálogo EPP: ${EPP_CATALOG_ITEMS.length} productos · ${EPP_SUPPLIERS.length} proveedores`)
    console.log("\n[DRY RUN] Validación completada sin errores.")
    return
  }

  /* ── Faenas y trabajadores desde libros de remuneraciones ───────────── */
  const seedWorkerData = loadSeedWorkerData()
  for (const worksite of seedWorkerData.worksites) {
    await db.insert(schema.worksites).values({
      ...worksite,
      isActive: true,
    }).onConflictDoUpdate({
      target: schema.worksites.id,
      set: {
        name: worksite.name,
        code: worksite.code,
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  for (const worker of seedWorkerData.workers) {
    await db.insert(schema.workers).values({
      id: worker.id,
      rut: worker.rut,
      firstName: worker.firstName,
      lastName: worker.lastName,
      position: null,
      worksiteId: worker.worksiteId,
      isActive: true,
    }).onConflictDoUpdate({
      target: schema.workers.rut,
      set: {
        firstName: worker.firstName,
        lastName: worker.lastName,
        position: null,
        worksiteId: worker.worksiteId,
        isActive: true,
      },
    })
  }

  /* ── EPP catalog from supplier spreadsheet ───────────────────────────── */
  await db.insert(schema.productCategories).values(EPP_CATEGORY).onConflictDoUpdate({
    target: schema.productCategories.id,
    set: {
      name: EPP_CATEGORY.name,
      slug: EPP_CATEGORY.slug,
      isEpp: EPP_CATEGORY.isEpp,
      requiresPrevencion: EPP_CATEGORY.requiresPrevencion,
      sortOrder: EPP_CATEGORY.sortOrder,
    },
  })

  for (const supplier of EPP_SUPPLIERS) {
    await db.insert(schema.suppliers).values(supplier).onConflictDoUpdate({
      target: schema.suppliers.id,
      set: {
        name: supplier.name,
        rut: supplier.rut ?? null,
        businessActivity: supplier.businessActivity ?? null,
        address: supplier.address ?? null,
        commune: supplier.commune ?? null,
        city: supplier.city ?? null,
        paymentTerms: supplier.paymentTerms ?? null,
        notes: supplier.notes ?? null,
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  for (const item of EPP_CATALOG_ITEMS) {
    const attributeRows = item.attributes?.map((a, i) => ({
      id: `pa-${item.id}-${i + 1}`,
      productId: item.id,
      categoryId: null,
      name: a.name,
      type: "select",
      isRequired: true,
      options: JSON.stringify([a.value]),
      sortOrder: i,
    })) ?? []

    await db.insert(schema.products).values({
      id: item.id,
      sku: item.sku,
      name: item.name,
      description: item.detail,
      categoryId: EPP_CATEGORY.id,
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: item.price,
      isActive: true,
      notes: sourceNote(item),
    }).onConflictDoUpdate({
      target: schema.products.id,
      set: {
        sku: item.sku,
        name: item.name,
        description: item.detail,
        categoryId: EPP_CATEGORY.id,
        unitOfMeasure: "unidad",
        isEpp: true,
        requiresPrevencion: true,
        referencePrice: item.price,
        isActive: true,
        notes: sourceNote(item),
        updatedAt: new Date().toISOString(),
      },
    })

    // Delete referencing request_item_attributes first (FK ON DELETE NO ACTION)
    const attrIds = (
      await db
        .select({ id: schema.productAttributes.id })
        .from(schema.productAttributes)
        .where(eq(schema.productAttributes.productId, item.id))
    ).map((a) => a.id)
    if (attrIds.length > 0) {
      await db.delete(schema.requestItemAttributes).where(inArray(schema.requestItemAttributes.attributeId, attrIds))
    }
    await db.delete(schema.productAttributes).where(eq(schema.productAttributes.productId, item.id))
    if (attributeRows.length > 0) {
      await db.insert(schema.productAttributes).values(attributeRows)
    }

    await db.insert(schema.productSuppliers).values({
      id: `ps-${item.id}`,
      productId: item.id,
      supplierId: item.supplierId,
      unitPrice: item.price,
      isPreferred: true,
      notes: item.detail,
    }).onConflictDoUpdate({
      target: schema.productSuppliers.id,
      set: {
        productId: item.id,
        supplierId: item.supplierId,
        unitPrice: item.price,
        isPreferred: true,
        notes: item.detail,
        lastUpdated: new Date().toISOString(),
      },
    })
  }

  console.log("")
  console.log("Seed base completado.")
  console.log(`  Faenas cargadas: ${seedWorkerData.worksites.length}.`)
  console.log(`  Trabajadores cargados: ${seedWorkerData.workers.length} (${seedWorkerData.skippedDuplicateRuts} RUT duplicado omitido).`)
  console.log(`  Catálogo EPP cargado: ${EPP_CATALOG_ITEMS.length} productos, ${EPP_SUPPLIERS.length} proveedores.`)
  console.log("  No se cargaron usuarios, roles, permisos, stock, solicitudes ni programas demo.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => client.end())
