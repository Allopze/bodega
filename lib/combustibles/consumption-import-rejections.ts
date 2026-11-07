import { asc, count, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelConsumptionImportRejections, fuelImportBatches } from "@/db/schema"
import { isGlobalRole } from "@/lib/auth/scope"

export interface ConsumptionImportRejection {
  rowIndex: number
  patente: string | null
  field: string
  message: string
}

/**
 * Una importación en modo «todas las faenas» crea un lote por faena, pero los
 * rechazos son del archivo completo. Un usuario acotado a una faena puede abrir
 * su lote y, si se consultara por hash sin más, vería patentes de otras faenas.
 * Sólo un rol global ve los rechazos de una importación multi-faena; en una de
 * una sola faena, el dueño del lote ve los suyos.
 */
export async function getImportRejectionAccess(
  session: Session,
  hashArchivo: string,
): Promise<{ visible: boolean; multiWorksite: boolean }> {
  const [row] = await db.select({ batches: count() })
    .from(fuelImportBatches)
    .where(eq(fuelImportBatches.hashArchivo, hashArchivo))
  const batches = Number(row?.batches ?? 0)
  return {
    visible: isGlobalRole(session) || batches <= 1,
    multiWorksite: batches > 1,
  }
}

/**
 * Rechazos de una importación TCT, por hash del archivo. Se consultan por hash
 * y no por `batchId` porque una importación en modo «todas las faenas» crea un
 * lote por faena: el rechazo pertenece al archivo completo.
 */
export async function getConsumptionImportRejections(hashArchivo: string): Promise<ConsumptionImportRejection[]> {
  const rows = await db.select({
    rowIndex: fuelConsumptionImportRejections.rowIndex,
    patente: fuelConsumptionImportRejections.patente,
    field: fuelConsumptionImportRejections.field,
    message: fuelConsumptionImportRejections.message,
  })
    .from(fuelConsumptionImportRejections)
    .where(eq(fuelConsumptionImportRejections.hashArchivo, hashArchivo))
    .orderBy(asc(fuelConsumptionImportRejections.rowIndex), asc(fuelConsumptionImportRejections.id))

  return rows
}
