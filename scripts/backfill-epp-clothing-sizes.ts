/**
 * Completa las tallas XS, S, M, L, XL y 2XL en toda familia EPP que ya use la
 * escala de ropa ("Talla"): pantalones, buzos, chaquetas, chalecos, trajes,
 * etc. Ver lib/services/epp-clothing-sizes.ts para el detalle y qué familias
 * se dejan intactas (y por qué).
 *
 * Ejecutar con: npx tsx scripts/backfill-epp-clothing-sizes.ts
 */
import { addMissingClothingSizeVariants } from "@/lib/services/epp-clothing-sizes"

async function main() {
  const summary = await addMissingClothingSizeVariants()
  console.log(JSON.stringify(summary, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
