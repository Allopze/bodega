import { and, eq, isNotNull, sql } from "drizzle-orm"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"

export type DteSingleBusinessLinkConflict = {
  id: string
  purchaseOrderInvoiceId: string | null
  fuelLoadId: string | null
}

export type DtePurchaseInvoiceDuplicateConflict = {
  purchaseOrderInvoiceId: string
  dteDocumentIds: string[]
}

/**
 * Detects historical DTE rows that would violate
 * dte_documents_single_business_link. This is deliberately read-only: choosing
 * which business record owns an ambiguous historic DTE requires an auditable
 * business decision, not a migration-side guess.
 */
export async function findDteSingleBusinessLinkConflicts(): Promise<DteSingleBusinessLinkConflict[]> {
  return db.select({
    id: dteDocuments.id,
    purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
    fuelLoadId: dteDocuments.fuelLoadId,
  }).from(dteDocuments).where(and(
    isNotNull(dteDocuments.purchaseOrderInvoiceId),
    isNotNull(dteDocuments.fuelLoadId),
  ))
}

export async function assertNoDteSingleBusinessLinkConflicts(): Promise<DteSingleBusinessLinkConflict[]> {
  const conflicts = await findDteSingleBusinessLinkConflicts()
  const duplicates = await findDtePurchaseInvoiceDuplicateConflicts()
  if (conflicts.length > 0 || duplicates.length > 0) {
    throw new Error(
      "No se puede aplicar la migración de vínculo único DTE: hay conflictos históricos. " +
      JSON.stringify({ singleBusinessLink: conflicts, duplicatePurchaseInvoices: duplicates }) + ". " +
      "Ejecute la reparación explícita con mapping auditado y repita el preflight.",
    )
  }
  return conflicts
}

/** Detecta todas las facturas de OC con más de un DTE vinculado. */
export async function findDtePurchaseInvoiceDuplicateConflicts(): Promise<DtePurchaseInvoiceDuplicateConflict[]> {
  const groups = await db.select({
    purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
  }).from(dteDocuments).where(isNotNull(dteDocuments.purchaseOrderInvoiceId))
    .groupBy(dteDocuments.purchaseOrderInvoiceId)
    .having(sql`count(*) > 1`)

  const result: DtePurchaseInvoiceDuplicateConflict[] = []
  for (const group of groups) {
    if (!group.purchaseOrderInvoiceId) continue
    const rows = await db.select({ id: dteDocuments.id }).from(dteDocuments).where(
      eq(dteDocuments.purchaseOrderInvoiceId, group.purchaseOrderInvoiceId),
    )
    result.push({
      purchaseOrderInvoiceId: group.purchaseOrderInvoiceId,
      dteDocumentIds: rows.map((row) => row.id),
    })
  }
  return result
}

function getErrorCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code)
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code)
  return ""
}

async function main() {
  const conflicts = await findDteSingleBusinessLinkConflicts()
  const duplicates = await findDtePurchaseInvoiceDuplicateConflicts()
  if (conflicts.length > 0 || duplicates.length > 0) {
    throw new Error(JSON.stringify({ ok: false, dteSingleBusinessLinkConflicts: conflicts, duplicatePurchaseInvoices: duplicates }))
  }
  console.log(JSON.stringify({ ok: true, dteSingleBusinessLinkConflicts: 0, duplicatePurchaseInvoices: 0 }, null, 2))
}

const invokedPath = process.argv[1]
const isDirectInvocation = invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().then(
    () => process.exit(0),
    (error) => {
      if (getErrorCode(error) === "42P01") {
        console.log(JSON.stringify({
          ok: true,
          skipped: true,
          reason: "La tabla dte_documents aún no existe; corresponde a una base nueva y drizzle-kit puede crearla.",
        }, null, 2))
        process.exit(0)
      }
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
