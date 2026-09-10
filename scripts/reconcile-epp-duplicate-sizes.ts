/**
 * Da de baja las variantes que representan la misma talla física dentro de una
 * familia (`N41` junto a `T41`, `L` junto a `T/L`, pares idénticos que sólo se
 * distinguen por el SKU). Ver lib/services/epp-duplicate-size-reconciliation.ts
 * para por qué se desactiva en vez de borrar y qué grupos se saltan.
 *
 * Por omisión **no escribe**: informa el plan y sale.
 *
 *   npx tsx scripts/reconcile-epp-duplicate-sizes.ts            # informa (dry-run)
 *   npx tsx scripts/reconcile-epp-duplicate-sizes.ts --apply    # da de baja
 */
import { retireDuplicateSizeVariants } from "@/lib/services/epp-duplicate-size-reconciliation"

async function main() {
  const apply = process.argv.includes("--apply")
  const summary = await retireDuplicateSizeVariants({ dryRun: !apply })

  console.log(JSON.stringify({
    gruposDuplicados: summary.groupsFound,
    variantesDadasDeBaja: summary.variantsRetired,
    gruposSaltados: summary.groupsSkipped,
    modo: summary.dryRun ? "dry-run (no escribe)" : "aplicado",
  }, null, 2))

  console.log()
  for (const group of summary.groups) {
    const marca = group.retirable ? "BAJA    " : "SALTADO "
    console.log(`[${marca}] ${group.familyName} · talla ${group.sizeLabel}`)
    console.log(`            sobrevive ${group.survivor.sku} (stock ${group.survivor.stock}, refs ${group.survivor.referenceTotal})`)
    for (const fact of group.absorbed) {
      console.log(`            se retira ${fact.sku} (stock ${fact.stock}, refs ${fact.referenceTotal})`)
    }
    if (group.skipReason) console.log(`            motivo: ${group.skipReason}`)
  }

  if (summary.dryRun && summary.variantsRetired > 0) {
    console.log(`\nDry-run: no se escribió nada. Con --apply se dan de baja ${summary.variantsRetired} variantes.`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
