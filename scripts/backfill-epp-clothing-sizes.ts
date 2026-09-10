/**
 * Completa las tallas XS, S, M, L, XL y 2XL en toda familia EPP que **declare**
 * la familia de tallas `ropa` en su atributo de talla
 * (`product_attributes.size_family = 'ropa'`). Ver
 * lib/services/epp-clothing-sizes.ts para el detalle y por qué el criterio no
 * puede ser el nombre del atributo.
 *
 * Este script **inventa variantes de catálogo** con SKU y proveedor propios, así
 * que por omisión no escribe: informa lo que crearía y sale.
 *
 *   npx tsx scripts/backfill-epp-clothing-sizes.ts             # informa (dry-run)
 *   npx tsx scripts/backfill-epp-clothing-sizes.ts --dry-run   # idem, explícito
 *   npx tsx scripts/backfill-epp-clothing-sizes.ts --apply      # escribe
 */
import { addMissingClothingSizeVariants } from "@/lib/services/epp-clothing-sizes"

async function main() {
  const apply = process.argv.includes("--apply")
  const summary = await addMissingClothingSizeVariants({ dryRun: !apply })
  console.log(JSON.stringify(summary, null, 2))
  if (!apply) {
    console.log(
      summary.variantsCreated === 0
        ? "\nNada por crear. (dry-run; ninguna familia declara size_family = 'ropa')"
        : `\nDry-run: no se escribió nada. Volvé a correrlo con --apply para crear ${summary.variantsCreated} variantes.`,
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
