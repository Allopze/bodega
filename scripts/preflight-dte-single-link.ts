import { and, isNotNull } from "drizzle-orm"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"

export type DteSingleBusinessLinkConflict = {
  id: string
  purchaseOrderInvoiceId: string | null
  fuelLoadId: string | null
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
  if (conflicts.length > 0) {
    throw new Error(
      "No se puede aplicar la migración de vínculo único DTE: hay documentos " +
      `conciliados tanto con factura de OC como con carga de combustible. ${JSON.stringify(conflicts)}. ` +
      "Revise cada DTE y conserve solo el vínculo que corresponda antes de reintentar.",
    )
  }
  return conflicts
}

function getErrorCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code)
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code)
  return ""
}

async function main() {
  const conflicts = await assertNoDteSingleBusinessLinkConflicts()
  console.log(JSON.stringify({ ok: true, dteSingleBusinessLinkConflicts: conflicts.length }, null, 2))
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
