/**
 * Deja `Logo: Con logo` en toda prenda EPP que lleva logo (chaleco, polera,
 * camisa, blusa, pantalón, chaqueta, primera capa) y en sus solicitudes aún sin
 * OC. Los ítems ya en OC o posteriores no se tocan. Ver
 * lib/services/epp-logo-backfill.ts.
 *
 * Reescribe atributos de catálogo y de solicitudes, así que por omisión no
 * escribe: informa lo que haría y sale.
 *
 *   npx tsx scripts/backfill-epp-logo.ts             # informa (dry-run)
 *   npx tsx scripts/backfill-epp-logo.ts --apply      # escribe
 */
import { backfillEppLogo } from "@/lib/services/epp-logo-backfill"

async function main() {
  const apply = process.argv.includes("--apply")
  const summary = await backfillEppLogo({ dryRun: !apply })
  console.log(JSON.stringify(summary, null, 2))

  if (summary.duplicateSizes.length > 0) {
    console.log(`\n${summary.duplicateSizes.length} talla(s) duplicada(s) dentro de una familia; unificarlas a mano:`)
    for (const dup of summary.duplicateSizes) console.log(`  - ${dup.productName} · ${dup.size}: ${dup.skus.join(", ")}`)
  }
  if (!apply) {
    const { catalog, requestItems } = summary
    const changes = catalog.renamed + catalog.inserted + requestItems.updated + requestItems.inserted
    console.log(
      changes === 0
        ? "\nNada por hacer. (dry-run)"
        : `\nDry-run: no se escribió nada. Con --apply: ${catalog.renamed} atributos renombrados, ${catalog.inserted} insertados, ${requestItems.updated} ítems actualizados y ${requestItems.inserted} con Logo nuevo.`,
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
