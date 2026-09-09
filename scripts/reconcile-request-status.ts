/**
 * Recalcula el estado derivado de las solicitudes que quedaron con el que
 * calculó una regla vieja. Ver lib/services/request-status-reconciliation.ts
 * para por qué el rollup solo no alcanza.
 *
 * Por omisión **no escribe**: informa la deriva y sale.
 *
 *   npx tsx scripts/reconcile-request-status.ts            # informa (dry-run)
 *   npx tsx scripts/reconcile-request-status.ts --apply    # recalcula
 */
import { reconcileRequestStatuses } from "@/lib/services/request-status-reconciliation"

async function main() {
  const apply = process.argv.includes("--apply")
  const summary = await reconcileRequestStatuses({ dryRun: !apply })

  console.log(JSON.stringify({
    solicitudesRevisadas: summary.scanned,
    conDeriva: summary.drifts.length,
    recalculadas: summary.reconciled,
    modo: summary.dryRun ? "dry-run (no escribe)" : "aplicado",
  }, null, 2))

  if (summary.drifts.length > 0) {
    console.log()
    for (const drift of summary.drifts) {
      console.log(`  ${drift.code}  ${drift.current} -> ${drift.expected}   [ítems: ${drift.itemStatuses.join(", ")}]`)
    }
  }

  if (summary.dryRun && summary.drifts.length > 0) {
    console.log(`\nDry-run: no se escribió nada. Con --apply se recalculan ${summary.drifts.length} solicitudes.`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
