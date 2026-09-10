import { backfillPurchaseOrderInvoiceReconciliations } from "@/lib/services/purchasing-module/invoice-reconciliation-service"

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL es requerido para recalcular la proyección de conciliación")
  }

  const result = await backfillPurchaseOrderInvoiceReconciliations()
  console.log(JSON.stringify(result, null, 2))
}

// Sin `await` de nivel superior: el runner transpila a CJS y ahí el top-level
// await es un error de transformación, así que el script fallaba antes de
// abrir la conexión.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
