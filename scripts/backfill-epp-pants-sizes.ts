/**
 * Completa las tallas S, M, L, XL y 2XL en toda familia de pantalones del
 * catálogo EPP que ya use la escala de ropa ("Talla"). Ver
 * lib/services/epp-pants-sizes.ts para el detalle y qué familias se dejan
 * intactas (y por qué).
 *
 * Ejecutar con: npx tsx scripts/backfill-epp-pants-sizes.ts
 */
import { addMissingPantsSizeVariants } from "@/lib/services/epp-pants-sizes"

async function main() {
  const summary = await addMissingPantsSizeVariants()
  console.log(JSON.stringify(summary, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
