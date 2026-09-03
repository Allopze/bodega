/**
 * Reporta las tallas del padrón que no están en forma canónica.
 *
 * Desde ahora `workerSchema` normaliza al guardar (`T42` → `42`, `Mediana` → `M`,
 * `XXL` → `2XL`), pero las filas escritas antes siguen como estaban. Este script
 * **no escribe nada**: dice cuántas hay, cuáles son y en qué se convertirían, y
 * marca las que además no existen en `size_catalog`.
 *
 * Se reporta en vez de corregir en silencio porque una talla del padrón es un
 * dato declarado por una persona: reescribirla sin que nadie lo mire es cómo se
 * pierde el registro de que decía otra cosa. Con `--apply` sí normaliza, y sólo
 * los valores cuya forma canónica ya existe en el catálogo.
 */
import { db } from "@/db"
import { workers } from "@/db/schema"
import { sizeCatalog } from "@/db/schema/sizes"
import { normalizeSizeLabel } from "@/lib/products/product-size"
import { eq } from "drizzle-orm"

const SIZE_FIELDS = {
  sizeTop:    "ropa",
  sizeBottom: "pantalon",
  sizeShoe:   "calzado",
  sizeGloves: "guantes",
  sizeHelmet: "casco",
} as const

type SizeField = keyof typeof SIZE_FIELDS

async function main() {
  const apply = process.argv.includes("--apply")

  const [rows, catalogRows] = await Promise.all([
    db.select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      sizeTop: workers.sizeTop,
      sizeBottom: workers.sizeBottom,
      sizeShoe: workers.sizeShoe,
      sizeGloves: workers.sizeGloves,
      sizeHelmet: workers.sizeHelmet,
    }).from(workers),
    db.select({ family: sizeCatalog.family, code: sizeCatalog.code })
      .from(sizeCatalog)
      .where(eq(sizeCatalog.isActive, true)),
  ])

  const catalog = new Set(catalogRows.map((row) => `${row.family}:${normalizeSizeLabel(row.code)}`))

  const needsNormalizing: Array<{
    workerId: string; worker: string; field: SizeField
    actual: string; canonico: string; enCatalogo: boolean
  }> = []
  const outsideCatalog: Array<{ worker: string; field: SizeField; valor: string }> = []

  for (const row of rows) {
    for (const field of Object.keys(SIZE_FIELDS) as SizeField[]) {
      const actual = row[field]
      if (!actual) continue
      const canonico = normalizeSizeLabel(actual)
      const enCatalogo = catalog.has(`${SIZE_FIELDS[field]}:${canonico}`)
      const worker = `${row.firstName} ${row.lastName}`.trim()

      if (canonico !== actual) {
        needsNormalizing.push({ workerId: row.id, worker, field, actual, canonico, enCatalogo })
      } else if (!enCatalogo) {
        outsideCatalog.push({ worker, field, valor: actual })
      }
    }
  }

  // Sólo se toca lo que aterriza en una talla que el catálogo reconoce. Un valor
  // que no cruza con nada se deja intacto y se reporta: puede ser una talla real
  // que al catálogo le falta, y borrarla sería peor que dejarla rara.
  const applicable = needsNormalizing.filter((entry) => entry.enCatalogo)

  console.log(JSON.stringify({
    trabajadores: rows.length,
    tallasNoCanonicas: needsNormalizing.length,
    normalizables: applicable.length,
    sinEquivalenteEnCatalogo: needsNormalizing.filter((e) => !e.enCatalogo),
    yaCanonicasPeroFueraDelCatalogo: outsideCatalog,
    detalle: needsNormalizing,
    modo: apply ? "apply" : "preflight (no escribe)",
  }, null, 2))

  if (!apply || applicable.length === 0) return

  const byWorker = new Map<string, Partial<Record<SizeField, string>>>()
  for (const entry of applicable) {
    const patch = byWorker.get(entry.workerId) ?? {}
    patch[entry.field] = entry.canonico
    byWorker.set(entry.workerId, patch)
  }
  for (const [workerId, patch] of byWorker) {
    await db.update(workers).set(patch).where(eq(workers.id, workerId))
  }
  console.log(`Normalizadas ${applicable.length} tallas en ${byWorker.size} trabajadores.`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
