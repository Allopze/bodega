/**
 * scripts/reconcile-pdtp-fulfillment-events.ts
 *
 * Reprocesa los eventos de cumplimiento PDTP que quedaron `pending` o `error`
 * (ver `lib/services/pdtp/fulfillment.ts`): programa que se activó después del
 * hecho, mapeo que se corrigió, o un fallo transitorio de base. Idempotente
 * por `idempotency_key` — reintentar un evento que en el fondo ya se resolvió
 * no duplica nada.
 *
 * No acredita hechos anteriores a `activatedAt` por su cuenta: sólo reintenta
 * eventos que YA están en el libro porque el propio hecho operacional los
 * escribió cuando ocurrió. Una carga histórica retroactiva es una decisión
 * aparte, con motivo y aprobación explícitos — no algo que este script deba
 * decidir solo.
 *
 *   npm run pdtp:reconcile-fulfillment-events
 *   PDTP_RECONCILE_LIMIT=500 npm run pdtp:reconcile-fulfillment-events
 *
 * Corre en cada deploy de producción, después de que el programa quedó
 * activado/actualizado: es el paso que le da una segunda oportunidad a los
 * eventos que se perdieron mientras el programa estaba en `draft`.
 */

import { reconcilePdtpFulfillmentEvents } from "@/lib/services/pdtp/fulfillment"

async function main() {
  const limit = process.env.PDTP_RECONCILE_LIMIT ? Number(process.env.PDTP_RECONCILE_LIMIT) : undefined
  console.log("Reconciliando eventos de cumplimiento PDTP…")
  const summary = await reconcilePdtpFulfillmentEvents({ limit })
  console.log(`  Procesados: ${summary.processed}`)
  console.log(`  Acreditados/revocados ahora: ${summary.accredited}`)
  console.log(`  Siguen pendientes: ${summary.stillPending}`)
  console.log(`  Con error: ${summary.errored}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
