/**
 * Historia facturada de un cliente y de un contrato.
 *
 * `CLI-001` (auditoría 2026-09-14), instancia del patrón P1. Las facturas de
 * venta apuntan al cliente y al contrato por clave foránea
 * (`billing_invoices.client_id`, `contract_id`), de modo que la historia
 * tributaria sigue al registro editado: cambiar el RUT de un cliente no corrige
 * un error de tipeo, **reasigna el titular de todo lo ya emitido**, y reapuntar
 * un contrato a otro cliente mueve allá su facturación.
 */

import { eq, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  billingInvoiceLinks,
  billingProposals,
  clients,
  contracts,
} from "@/db/schema"

/**
 * ¿Este cliente ya tiene algo emitido a su nombre? Facturas, propuestas o
 * contratos: los tres cuelgan de su identidad tributaria.
 */
export async function clientHasBillingHistory(
  clientId: string,
  client: typeof db | Tx = db,
): Promise<boolean> {
  const [row] = await client.select({
    used: sql<boolean>`
      exists(select 1 from ${billingInvoiceLinks} where ${billingInvoiceLinks.clientId} = ${clientId})
      or exists(select 1 from ${billingProposals} where ${billingProposals.clientId} = ${clientId})
      or exists(select 1 from ${contracts} where ${contracts.clientId} = ${clientId})
    `,
  }).from(clients).where(eq(clients.id, clientId))
  return Boolean(row?.used)
}

/** Lo mismo para un contrato: facturas o propuestas ya colgadas de él. */
export async function contractHasBillingHistory(
  contractId: string,
  client: typeof db | Tx = db,
): Promise<boolean> {
  const [row] = await client.select({
    used: sql<boolean>`
      exists(select 1 from ${billingInvoiceLinks} where ${billingInvoiceLinks.contractId} = ${contractId})
      or exists(select 1 from ${billingProposals} where ${billingProposals.contractId} = ${contractId})
    `,
  }).from(contracts).where(eq(contracts.id, contractId))
  return Boolean(row?.used)
}
