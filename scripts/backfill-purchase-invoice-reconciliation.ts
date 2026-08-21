import { backfillPurchaseOrderInvoiceReconciliations } from "@/lib/services/purchasing-module/invoice-reconciliation-service"

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL es requerido para recalcular la proyección de conciliación")
}

const result = await backfillPurchaseOrderInvoiceReconciliations()
console.log(JSON.stringify(result, null, 2))
