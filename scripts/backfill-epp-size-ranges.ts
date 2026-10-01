/**
 * Completa el rango de tallas de todo calzado (38..46) y de toda ropa o
 * pantalón (S..3XL), y da de baja las variantes sin talla —sin stock ni
 * historial— que impedían elegir talla en Solicitudes. Ver
 * lib/services/epp-size-ranges.ts para cómo se decide la escala de cada grupo.
 *
 * Este script **inventa variantes de catálogo** con SKU y proveedor propios, así
 * que por omisión no escribe: informa lo que haría y sale.
 *
 *   npx tsx scripts/backfill-epp-size-ranges.ts             # informa (dry-run)
 *   npx tsx scripts/backfill-epp-size-ranges.ts --apply      # escribe
 */
import { completeSizeRanges } from "@/lib/services/epp-size-ranges"

async function main() {
  const apply = process.argv.includes("--apply")
  const summary = await completeSizeRanges({ dryRun: !apply })
  console.log(JSON.stringify(summary, null, 2))

  const unsized = summary.results.filter((result) => result.status === "unsized")
  if (unsized.length > 0) {
    console.log(`\n${unsized.length} grupo(s) sin talla en ninguna variante; revisarlos a mano:`)
    for (const result of unsized) console.log(`  - ${result.productName}`)
  }
  const kept = summary.results.flatMap((result) => result.keptUnsized.map((k) => `${k.sku} (${result.productName}): ${k.reason}`))
  if (kept.length > 0) {
    console.log(`\n${kept.length} variante(s) sin talla con stock o historial; no se dieron de baja:`)
    for (const line of kept) console.log(`  - ${line}`)
  }
  if (!apply) {
    console.log(
      summary.variantsCreated === 0 && summary.variantsRetired === 0
        ? "\nNada por hacer. (dry-run)"
        : `\nDry-run: no se escribió nada. Con --apply se crearían ${summary.variantsCreated} variantes y se darían de baja ${summary.variantsRetired}.`,
    )
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
