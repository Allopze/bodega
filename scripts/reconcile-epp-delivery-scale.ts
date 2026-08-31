import { reconcileEppDeliveryScale } from "@/lib/services/epp-delivery-scale-reconciliation"

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("La conciliación automática exige --apply")
  }

  const result = await reconcileEppDeliveryScale()

  console.log(JSON.stringify({
    reconciliation: "epp-delivery-scale",
    correctedDeliveries: result.correctedDeliveries,
    totalOriginalQuantity: result.totalOriginalQuantity,
    totalCorrectedQuantity: result.totalCorrectedQuantity,
    totalStockAdjustment: result.totalStockAdjustment,
    adjustmentsCreated: result.adjustmentCodes.length,
  }, null, 2))
  // `db` mantiene un pool reutilizable para Next. En este one-shot todo quedó
  // confirmado al volver de la transacción, así que no esperamos su timeout.
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error("[reconcile-epp-delivery-scale]", error)
  process.exit(1)
})
